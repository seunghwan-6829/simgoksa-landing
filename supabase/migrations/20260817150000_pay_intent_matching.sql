-- 결제 의향(pay_intent) 매칭: 그로블 계정 이메일과 사이트 계정 이메일이 달라도
-- 구매를 사이트 계정에 연결할 수 있게 한다.
alter table public.leads add column if not exists email text;

alter table public.purchases add column if not exists site_email text;
create index if not exists purchases_site_email_idx on public.purchases (lower(site_email));

-- 조회 정책: 그로블 구매자 이메일 또는 매칭된 사이트 이메일, 어느 쪽이든 본인 것이면 보인다
drop policy if exists "own_purchases_select" on public.purchases;
create policy "own_purchases_select"
  on public.purchases
  for select
  to authenticated
  using (
    lower(buyer_email) = lower(auth.jwt()->>'email')
    or lower(site_email) = lower(auth.jwt()->>'email')
  );
