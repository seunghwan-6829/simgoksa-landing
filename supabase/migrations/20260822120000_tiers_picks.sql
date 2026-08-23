-- 부분 구매(1장/5장/전부): 결제 의향과 구매에 선택한 목차를 싣는다
alter table public.leads add column if not exists tier text;      -- 'one' | 'five' | 'all'
alter table public.leads add column if not exists picks text;     -- '2,5' (PART 번호, 1~10)
alter table public.purchases add column if not exists tier text;
alter table public.purchases add column if not exists picks text;
