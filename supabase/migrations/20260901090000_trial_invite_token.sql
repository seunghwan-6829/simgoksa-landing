-- 체험 계정 영구 초대 토큰 — 링크(?iv=)를 몇 번이든 눌러 로그인할 수 있게 한다.
-- (매직링크 1회용 한계 대체 — 누를 때마다 서버가 새 열쇠를 발급)
alter table public.trial_credits
  add column if not exists invite_token text default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

update public.trial_credits
   set invite_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
 where invite_token is null;

alter table public.trial_credits alter column invite_token set not null;

create unique index if not exists trial_credits_invite_token_key on public.trial_credits (invite_token);
