-- 보고서 열람/다운로드 추적 (IP 포함) — 환불 분쟁 대응용
create table if not exists public.report_views (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event text not null default 'view',   -- 'view' | 'download'
  name text,
  birth text,                            -- YYYY-MM-DD
  gender text,
  product text default 'myodam',
  is_demo boolean default false,
  ip text,
  user_agent text,
  referer text
);
comment on table public.report_views is '운명 사용설명서 열람·다운로드 로그 (edge function이 service role로 기록)';
create index if not exists report_views_name_idx on public.report_views (name, birth);
alter table public.report_views enable row level security;
-- anon/authenticated 정책 없음 → 쓰기·읽기 모두 service role(엣지 함수/어드민)만
