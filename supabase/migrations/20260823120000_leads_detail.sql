-- 퍼널 계측 보강: 씬 번호 등 이벤트 부가 정보
alter table public.leads add column if not exists detail text;
