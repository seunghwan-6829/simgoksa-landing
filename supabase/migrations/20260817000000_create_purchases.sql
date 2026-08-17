-- 그로블 웹훅으로 들어오는 구매 내역
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  buyer_email text,
  buyer_name text,
  buyer_phone text,
  product text default 'myodam',       -- 캐릭터/상품 키
  product_name text,
  amount integer,
  status text default 'paid',          -- paid | preparing | delivered | refunded
  saju_answer text,                    -- 결제창 주관식 답변 (이름/생년월일/성별)
  groble_content_id text,
  groble_purchase_id text,
  payload jsonb                        -- 웹훅 원본 (형식 변동 대비)
);

comment on table public.purchases is '그로블 결제 완료 웹훅 수신 내역 — 서고(library) 표시용';

create index if not exists purchases_email_idx on public.purchases (lower(buyer_email));

alter table public.purchases enable row level security;

-- 로그인한 사용자는 자기 이메일로 결제된 건만 조회 가능
create policy "own_purchases_select"
  on public.purchases
  for select
  to authenticated
  using (lower(buyer_email) = lower(auth.jwt()->>'email'));

-- 쓰기는 웹훅(service role)만 — anon/authenticated insert 정책 없음
