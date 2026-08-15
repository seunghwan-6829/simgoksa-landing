-- 심곡사 리드/주문 테이블
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event text not null,              -- 'input_complete' | 'cta_click'
  session_id text,                  -- 같은 방문자의 이벤트 묶음용
  name text,
  birth date,
  gender text,
  sals text[],                      -- 진단된 흉살 목록
  year_pillar text,                 -- 년주 (예: 乙亥)
  product text,                     -- 'myodam'
  user_agent text
);

comment on table public.leads is '심곡사 랜딩 리드: 인적사항 입력 완료 및 CTA 클릭 이벤트';

alter table public.leads enable row level security;

-- 웹사이트(anon)는 INSERT만 가능. 조회/수정/삭제 정책 없음 → 대시보드에서만 열람.
create policy "anon_insert_only"
  on public.leads
  for insert
  to anon
  with check (true);
