/* ═══════════════════════════════════════════════════════════════════════
 *  결과지 접근 부트스트랩 — 결과지(report/gyeong)의 본문 스크립트보다 먼저 실행된다.
 *
 *  ?p=<주문 id>          서고에서 온 정상 경로. 서버(report-access)가 주문 주인을 확인하고
 *                        이름·생일·성별·등급·고른 대목을 돌려준다. URL 의 이름값은 믿지 않는다.
 *  ?preview=1 / ?demo=1  맛보기 — URL 이름값으로 앞머리만 (본문은 흐림/짧음).
 *  ?name=… (그 외)       관리자 세션일 때만 허용 (결제 없이 열람). 아니면 서고로 보낸다.
 *
 *  비동기 확인이 끝나면 sessionStorage 에 결과를 두고 새로고침 → 본문 스크립트가 동기적으로 읽는다.
 *  본문 스크립트는 window.SGS_HALT 가 켜져 있으면 아무것도 그리지 않는다.
 * ═══════════════════════════════════════════════════════════════════════ */
(function (w) {
  'use strict';
  var qs = new URLSearchParams(location.search);
  var P = qs.get('p');
  var product = document.documentElement.getAttribute('data-product') || 'myodam';
  var landing = (w.SGS.PRODUCTS[product] || {}).landing || '/';
  w.SGS_ACCESS = null;
  w.SGS_HALT = false;

  function halt(msg) {
    w.SGS_HALT = true;
    document.addEventListener('DOMContentLoaded', function () {
      var el = document.createElement('div');
      el.id = 'sgsGate';
      el.style.cssText = 'position:fixed;inset:0;z-index:999;background:#060404;color:#9a8f85;display:flex;align-items:center;justify-content:center;text-align:center;font-size:13px;letter-spacing:.25em;line-height:2.2;padding:30px';
      el.textContent = msg;
      document.body.appendChild(el);
    });
  }
  function go(to) { location.replace(to); }
  function client() {
    try { return w.supabase.createClient(w.SGS.SUPA_URL, w.SGS.SUPA_KEY); } catch (e) { return null; }
  }

  if (P) {
    var cached = null;
    try { cached = JSON.parse(sessionStorage.getItem('sgs_access_' + P) || 'null'); } catch (e) {}
    if (cached && cached.ok && cached.product === product) { w.SGS_ACCESS = cached; return; }
    halt('서고에서 책을 꺼내는 중…');
    (async function () {
      var sb = client();
      var sess = sb ? (await sb.auth.getSession()).data.session : null;
      if (!sess) { go('/library/?next=' + encodeURIComponent(location.pathname + location.search)); return; }
      try {
        var r = await fetch(w.SGS.FN_URL + '/report-access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sess.access_token },
          body: JSON.stringify({ id: P })
        });
        var j = await r.json();
        if (j && j.ok && j.product === product) {
          sessionStorage.setItem('sgs_access_' + P, JSON.stringify(j));
          location.reload();
        } else {
          go('/library/?err=' + encodeURIComponent((j && j.error) || 'denied'));
        }
      } catch (e) { go('/library/?err=network'); }
    })();
    return;
  }

  if (qs.get('preview') || qs.get('demo')) return;   // 맛보기 — 본문이 URL 값으로 짧게 그린다

  if (qs.get('name')) {
    // 관리자만 이름값으로 직접 열람
    if (sessionStorage.getItem('sgs_admin') === '1') { w.SGS_ADMIN = true; return; }
    halt('확인 중…');
    (async function () {
      var sb = client();
      var sess = sb ? (await sb.auth.getSession()).data.session : null;
      var email = sess && sess.user && sess.user.email;
      if (w.SGS.isAdmin(email)) { sessionStorage.setItem('sgs_admin', '1'); location.reload(); }
      else go('/library/');
    })();
    return;
  }

  go(landing);
})(window);
