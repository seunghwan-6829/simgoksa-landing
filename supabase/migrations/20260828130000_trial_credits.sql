-- 체험 계정(블로거) 열람권 — 어드민이 이메일로 발급, 어떤 상품이든 「전부」 등급으로 n회 열람.
-- 사용 시 trial-redeem 함수가 0원 정식 구매 행을 만들어 기존 서고/결과지 파이프라인을 그대로 탄다.
create table if not exists public.trial_credits (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  total int not null default 2 check (total >= 0 and total <= 100),
  used int not null default 0 check (used >= 0 and used <= total),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trial_credits enable row level security;

-- 본인 행만 읽기 (랜딩이 "남은 체험권 n회" 표시용) — 쓰기는 서비스 롤 전용(정책 없음)
drop policy if exists trial_credits_self_read on public.trial_credits;
create policy trial_credits_self_read on public.trial_credits
  for select using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- 원자적 차감 — 동시 요청이 와도 남은 횟수 이상 못 쓴다 (한 행 UPDATE 의 원자성)
create or replace function public.consume_trial_credit(p_email text)
returns table(remaining int)
language sql
security definer
set search_path = public
as $$
  update public.trial_credits
     set used = used + 1, updated_at = now()
   where lower(email) = lower(p_email) and used < total
  returning (total - used);
$$;

-- 발급 실패 시 되돌림 (구매 행 생성이 실패했을 때 trial-redeem 이 호출)
create or replace function public.refund_trial_credit(p_email text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.trial_credits
     set used = greatest(used - 1, 0), updated_at = now()
   where lower(email) = lower(p_email);
$$;

-- 차감/되돌림은 서버(서비스 롤)만 부른다
revoke all on function public.consume_trial_credit(text) from public, anon, authenticated;
revoke all on function public.refund_trial_credit(text) from public, anon, authenticated;
grant execute on function public.consume_trial_credit(text) to service_role;
grant execute on function public.refund_trial_credit(text) to service_role;
