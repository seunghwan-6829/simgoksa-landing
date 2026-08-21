-- 그로블 웹훅 정합성 보강 (공식 스펙 기준: https://www.groble.im/help/guides/webhook)
--   1) webhook_events  — 수신 원문 보관 + 멱등 처리 게이트
--   2) purchases       — merchantUid 유니크, user_id/sellerReference 연결, 환불 필드
--   3) leads           — session_id 인덱스 + user_id (ref 파라미터로 주문에 신원을 붙이기 위함)

-- ─────────────────────────────────────────────────────────────
-- 1) 수신 원문 보관 테이블
--    서명·인증 헤더(X-Groble-Signature*, Authorization, Cookie)는 저장하지 않는다.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  source text not null default 'groble',
  idempotency_key text,              -- X-Groble-Idempotency-Key (없으면 payload.id로 대체)
  event_id text,                     -- payload.id  (evt_xxx)
  event_type text,                   -- payload.type (payment.completed 등)
  merchant_uid text,                 -- data.object.merchantUid
  status text not null default 'received',   -- received | processed | ignored | failed
  note text,                         -- 무시/실패 사유
  headers jsonb,                     -- 서명·인증 헤더 제외한 수신 헤더
  payload jsonb                      -- 원문 (파싱 실패 시 { raw: "..." })
);

comment on table public.webhook_events is '그로블 웹훅 수신 원문 보관 — 멱등 처리 및 사후 추적용';
comment on column public.webhook_events.headers is '서명/인증 헤더는 제외하고 저장';

-- 멱등 키 유니크: 같은 전송이 재시도돼도 한 줄만 남는다.
-- ⚠️ 부분 인덱스(where ... is not null)로 만들면 안 된다.
--    PostgREST 의 on_conflict upsert 는 ON CONFLICT (cols) 로 인덱스를 추론하는데,
--    부분 인덱스는 술어(predicate)를 함께 줘야 추론되고 PostgREST 는 그걸 줄 수 없다.
--    → "no unique or exclusion constraint matching the ON CONFLICT specification" 로 항상 실패.
--    일반 유니크 인덱스라도 NULL 은 서로 구별되므로 idempotency_key 가 없는 행은 여러 개 남을 수 있다.
drop index if exists public.webhook_events_idem_uidx;
create unique index webhook_events_idem_uidx
  on public.webhook_events (source, idempotency_key);

create index if not exists webhook_events_merchant_idx on public.webhook_events (merchant_uid);
create index if not exists webhook_events_type_idx on public.webhook_events (event_type, received_at desc);

alter table public.webhook_events enable row level security;
-- 정책 없음 → service role(엣지 함수/어드민)만 접근

-- ─────────────────────────────────────────────────────────────
-- 2) purchases 보강
-- ─────────────────────────────────────────────────────────────
alter table public.purchases add column if not exists user_id uuid;
alter table public.purchases add column if not exists seller_reference text;   -- ?ref= 로 넘긴 session_id
alter table public.purchases add column if not exists event_id text;           -- 마지막으로 반영한 이벤트 id
alter table public.purchases add column if not exists event_type text;
alter table public.purchases add column if not exists content_title text;      -- 판매자측 상품명 스냅샷
alter table public.purchases add column if not exists tracking_code text;      -- trackingLink.code (광고 유입 추적)
alter table public.purchases add column if not exists purchased_at timestamptz;
alter table public.purchases add column if not exists refunded_at timestamptz;
alter table public.purchases add column if not exists refund_amount integer;
alter table public.purchases add column if not exists refund_reason text;
alter table public.purchases add column if not exists updated_at timestamptz not null default now();
alter table public.purchases add column if not exists admin_note text;

-- merchantUid 유니크 — 재전송이 와도 한 건만 남는다.
--
-- 유니크 인덱스를 걸려면 과거에 중복 수신으로 쌓인 행이 없어야 한다.
-- 다만 결제 기록은 지우지 않는다(되돌릴 수 없으므로). 대신 가장 오래된 행만 merchantUid 를
-- 유지하고, 나머지는 groble_purchase_id 를 NULL 로 비워 인덱스 충돌에서 빼낸다.
-- NULL 끼리는 충돌하지 않으므로 행은 그대로 남고, admin_note 로 어드민에서 식별된다.
-- (원래 merchantUid 는 payload 안에 그대로 보존된다)
update public.purchases a
set groble_purchase_id = null,
    admin_note = coalesce(a.admin_note || ' | ', '')
                 || '중복 수신본 — 원래 merchantUid=' || a.groble_purchase_id
                 || ' (2026-08-21 유니크 인덱스 도입 시 분리)'
from public.purchases b
where a.groble_purchase_id is not null
  and a.groble_purchase_id = b.groble_purchase_id
  and (a.created_at, a.id) > (b.created_at, b.id);

-- ⚠️ 부분 인덱스로 만들면 웹훅의 on_conflict upsert 가 추론에 실패한다(위 주석 참조).
--    NULL 끼리는 충돌하지 않으므로, merchantUid 가 없는 과거 행이 여러 개 있어도 문제없다.
drop index if exists public.purchases_merchant_uid_uidx;
create unique index purchases_merchant_uid_uidx
  on public.purchases (groble_purchase_id);

create index if not exists purchases_user_id_idx on public.purchases (user_id);
create index if not exists purchases_seller_ref_idx on public.purchases (seller_reference);

-- 조회 정책: user_id(1순위) 또는 이메일(폴백) 중 어느 쪽이든 본인 것이면 보인다.
drop policy if exists "own_purchases_select" on public.purchases;
create policy "own_purchases_select"
  on public.purchases
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or lower(buyer_email) = lower(auth.jwt()->>'email')
    or lower(site_email) = lower(auth.jwt()->>'email')
  );

-- ─────────────────────────────────────────────────────────────
-- 3) leads 보강 — ?ref=<session_id> 로 주문에 신원을 붙이기 위한 조회 경로
-- ─────────────────────────────────────────────────────────────
alter table public.leads add column if not exists user_id uuid;
create index if not exists leads_session_id_idx on public.leads (session_id, created_at desc);
