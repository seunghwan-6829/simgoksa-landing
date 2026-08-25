-- 홍단(인연 사주) 분기: 재회(jae) / 연애(yeon) — 어느 길의 결과지를 줄지 주문에 싣는다
alter table public.leads add column if not exists path text;
alter table public.purchases add column if not exists path text;
