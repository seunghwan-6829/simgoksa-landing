-- Meta 전환 API(CAPI) 전송 로그
--
-- 메타는 "이 주문이 우리한테 도착했나?"를 개별로 조회해주는 API 가 없다.
-- 어떤 토큰을 써도 이벤트 단건 조회는 불가능하다.
-- 따라서 특정 주문이 실제로 전송됐는지 확인할 유일한 수단이 이 표다.
-- 전송이 실패해도 웹훅은 200 을 반환하므로(그로블 재전송 유발 금지), 실패 흔적도 여기에만 남는다.

create table if not exists public.capi_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  event_name text not null default 'Purchase',
  event_id text,                 -- = merchantUid. 주문 ↔ 전송 대조용이자 브라우저 픽셀과의 중복제거 키
  ok boolean not null default false,
  status integer,                -- Graph API HTTP 상태
  matched integer,               -- 응답의 events_received (메타가 받은 건수)
  value numeric,
  currency text,
  fbtrace text,                  -- 메타 문의 시 제시하는 추적번호 (fbtrace_id)
  note text,                     -- 성공: 실린 매칭키 목록 / 실패: 오류 원문 / 미설정: 사유
  payload_meta jsonb             -- { match_keys, has_fbp, has_fbc, test_mode, content_id }
);

comment on table public.capi_events is
  'Meta CAPI 전송 로그 — 메타는 이벤트 단건 조회를 제공하지 않으므로 이것이 유일한 대조 수단';
comment on column public.capi_events.note is
  '⚠️ 해시값도 원문도 넣지 말 것. 어떤 종류의 키를 실었는지만 기록한다';
comment on column public.capi_events.matched is
  '응답의 events_received. 전송 성공 판정은 이 값으로 한다 (테스트 이벤트 탭 노출 여부가 아니라)';

create index if not exists capi_events_event_id_idx on public.capi_events (event_id);
create index if not exists capi_events_created_idx on public.capi_events (created_at desc);
create index if not exists capi_events_failed_idx on public.capi_events (created_at desc) where ok = false;

alter table public.capi_events enable row level security;
-- 정책 없음 → service role(엣지 함수/어드민)만 접근
