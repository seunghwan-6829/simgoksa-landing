-- Meta 픽셀/전환 추적용 컬럼
--
-- 결제가 groble.im(외부 도메인)에서 끝나기 때문에 Purchase 는 브라우저 픽셀로 잡을 수 없고,
-- 웹훅에서 서버로 보내야 한다. 그런데 웹훅 시점에는 방문자의 쿠키를 읽을 방법이 없다.
-- 그래서 이탈 직전에 랜딩이 _fbp/_fbc 를 세션(leads.session_id)과 함께 저장해두고,
-- 웹훅이 sellerReference 로 그 행을 찾아 Purchase 에 실어 보낸다.
-- (Meta 가 가장 강하게 매칭하는 신호가 쿠키라, 이게 없으면 이벤트 일치율이 크게 떨어진다)

alter table public.leads add column if not exists fbp text;   -- _fbp 쿠키 (해시하지 않고 원문 전송)
alter table public.leads add column if not exists fbc text;   -- _fbc 쿠키 또는 fbclid 로 생성한 값

comment on column public.leads.fbp is 'Meta _fbp 쿠키 — CAPI user_data 에 원문 그대로 전송';
comment on column public.leads.fbc is 'Meta _fbc 쿠키(또는 fb.1.{ts}.{fbclid}) — CAPI user_data 에 원문 그대로 전송';

-- CAPI 전송 여부 표시.
-- 그로블은 실패 시 최대 7회 재전송하므로, 중복 전송으로 Purchase 가 여러 번 집계되지 않도록
-- 전송 직전에 이 컬럼을 원자적으로 선점(claim)한다.
alter table public.purchases add column if not exists capi_sent_at timestamptz;
comment on column public.purchases.capi_sent_at is 'Meta CAPI Purchase 전송 시각 — 재전송 중복 집계 방지용 선점 플래그';
