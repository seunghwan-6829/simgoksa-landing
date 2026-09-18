/* ═══════════════════════════════════════════════════════════════════════
 *  결제한 사람을 랜딩에서 붙잡는 띠 — "다시 결제하라" 사고 방지 장치
 *
 *  왜 필요한가:
 *   그로블 결제 완료 화면에서 「내 서고 가기」를 누르지 않고 닫으면,
 *   구매자는 진입 페이지(= 이 랜딩)로 돌아온다. 랜딩은 아무것도 모르고
 *   처음부터 판매 흐름을 다시 보여 주므로, 구매자 눈에는 "또 결제하라"로 보인다.
 *   (실제 환불 요청 사유가 이것이었다)
 *
 *  무엇을 하나:
 *   1) 결제 직전에 남긴 sgs_sid 로 claim-session(probe) 에 물어본다.
 *      · 이 상품을 방금(12시간 내) 샀다  → 띠를 띄우고 곧장 /library/ 로 보낸다
 *      · 예전 주문이거나 다른 상품이다   → 띠만 띄운다 (스스로 고르게 둔다)
 *      · 아직 웹훅이 안 왔다(pending)   → 6시간 내 결제 시도면 확인 띠 + 조용히 재시도
 *   2) 로그인 상태라면, 최근 주문이 있는지 보고 같은 띠를 띄운다.
 *
 *  랜딩(myodam · hyunwol · hongdan)에서만 읽는다. 결과지·서고는 자기 흐름이 따로 있다.
 * ═══════════════════════════════════════════════════════════════════════ */
(function (w) {
  'use strict';
  var SGS = w.SGS;
  if (!SGS || !SGS.PRODUCTS) return;

  var SID_KEY = 'sgs_sid';
  var LIB = '/library/';
  var AUTO_MS = 12 * 3600e3;      // 이 안에 결제한 건이면 서고로 자동 이동
  var WAIT_MS = 6 * 3600e3;       // 이 안에 결제 시도면 "확인 중" 재시도
  var RETRY = 10, RETRY_MS = 7000;

  function productKey() {
    var attr = document.documentElement.getAttribute('data-product');
    if (attr && SGS.PRODUCTS[attr]) return attr;
    for (var k in SGS.PRODUCTS) {
      var l = SGS.PRODUCTS[k].landing;
      if (l && location.pathname.indexOf(l) === 0) return k;
    }
    return null;
  }

  function sidInfo() {
    try {
      var d = JSON.parse(localStorage.getItem(SID_KEY) || 'null');
      if (d && d.sid && d.t) return d;
    } catch (e) { /* 사파리 시크릿 모드 등 — 조용히 넘어간다 */ }
    return null;
  }

  function client() {
    try {
      if (typeof sb !== 'undefined' && sb) return sb;           // 랜딩이 이미 만든 클라이언트
    } catch (e) { /* 선언 전 */ }
    try { return w.supabase.createClient(SGS.SUPA_URL, SGS.SUPA_KEY); } catch (e) { return null; }
  }

  /* ── 띠 ──────────────────────────────────────────────────────────── */
  var bar = null;
  function style() {
    if (document.getElementById('sgsPaidStyle')) return;
    var s = document.createElement('style');
    s.id = 'sgsPaidStyle';
    s.textContent =
      '#sgsPaidBar{position:fixed;left:0;right:0;top:0;z-index:99999;transform:translateY(-110%);' +
      'transition:transform .5s cubic-bezier(.2,.9,.3,1);' +
      'background:linear-gradient(180deg,#1b0d0b,#120807);border-bottom:1px solid rgba(208,140,58,.55);' +
      'box-shadow:0 10px 30px rgba(0,0,0,.6);font-family:"Nanum Myeongjo","Noto Serif KR",serif}' +
      '#sgsPaidBar.on{transform:translateY(0)}' +
      '#sgsPaidBar .pb-in{max-width:620px;margin:0 auto;padding:13px 16px;display:flex;align-items:center;gap:12px}' +
      '#sgsPaidBar .pb-tx{flex:1;color:#e8ddc7;font-size:13.5px;line-height:1.7;word-break:keep-all}' +
      '#sgsPaidBar .pb-tx b{color:#e8b25e}' +
      '#sgsPaidBar .pb-go{flex:none;background:linear-gradient(160deg,#7a1b16,#4a0d0a);color:#f3e7d3;' +
      'text-decoration:none;font-size:13px;padding:10px 15px;border-radius:6px;border:1px solid rgba(232,178,94,.45);white-space:nowrap}' +
      '#sgsPaidBar .pb-x{flex:none;background:none;border:0;color:#8d7f72;font-size:16px;cursor:pointer;padding:4px 2px}' +
      'body.sgs-paid-bar{padding-top:0}';
    document.head.appendChild(s);
  }
  function showBar(html, linkText, href, closable) {
    style();
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'sgsPaidBar';
      bar.setAttribute('role', 'status');
      bar.innerHTML = '<div class="pb-in"><span class="pb-tx"></span>' +
        '<a class="pb-go" href="' + LIB + '">내 서고</a>' +
        '<button class="pb-x" type="button" aria-label="닫기">✕</button></div>';
      (document.body || document.documentElement).appendChild(bar);
      bar.querySelector('.pb-x').onclick = function () { bar.classList.remove('on'); };
    }
    bar.querySelector('.pb-tx').innerHTML = html;
    var go = bar.querySelector('.pb-go');
    go.textContent = linkText || '내 서고';
    go.href = href || LIB;
    bar.querySelector('.pb-x').style.display = closable === false ? 'none' : '';
    requestAnimationFrame(function () { bar.classList.add('on'); });
  }

  function reportUrl(purchase) {
    var ch = purchase && SGS.PRODUCTS[purchase.product];
    if (purchase && purchase.status === 'delivered' && ch && ch.report) {
      return ch.report + '?p=' + encodeURIComponent(purchase.id);
    }
    return LIB;
  }

  /* ── 1) 결제 기기 표식(sid)으로 확인 ──────────────────────────────── */
  function probe(sid) {
    return fetch(SGS.FN_URL + '/claim-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: sid, probe: true })
    }).then(function (r) { return r.json(); }).catch(function () { return null; });
  }

  function handleSid(d, pkey) {
    var age = Date.now() - d.t;
    var tries = 0;
    (function ask() {
      probe(d.sid).then(function (j) {
        if (j && j.ok && j.purchase) {
          var same = j.purchase.product === pkey;
          if (same && age < AUTO_MS) {
            showBar('결제가 확인되었다. <b>네 서고를 여는 중…</b>', '바로 열기', LIB, false);
            setTimeout(function () { location.replace(LIB); }, 1600);
          } else {
            showBar('이미 받아 둔 풀이가 있다 — <b>다시 결제하지 마라.</b><br>서고에서 그대로 열린다.', '내 서고 열기', LIB, true);
          }
          return;
        }
        if (j && j.error === 'refunded') return;                       // 환불건 — 아무것도 띄우지 않는다
        if (age > WAIT_MS) return;                                     // 오래전 결제 시도 — 조용히 둔다
        showBar('<b>이미 값을 치렀다면</b> — 다시 결제할 것 없다.<br>서고에서 그대로 열린다. (아직이라면 그냥 진행하라)', '내 서고 확인', LIB, true);
        if (++tries < RETRY) setTimeout(ask, RETRY_MS);
      });
    })();
  }

  /* ── 2) 로그인 상태면 최근 주문으로 확인 ──────────────────────────── */
  function handleSession() {
    var c = client();
    if (!c) return;
    c.auth.getSession().then(function (res) {
      var s = res && res.data && res.data.session;
      if (!s) return;
      if (SGS.isAdmin && SGS.isAdmin(s.user.email)) return;            // 관리자는 늘 결제 없이 연다
      var since = new Date(Date.now() - 180 * 24 * 3600e3).toISOString();
      return c.from('purchases')
        .select('id,product,status,created_at')
        .neq('status', 'refunded')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1)
        .then(function (q) {
          var p = q && q.data && q.data[0];
          if (!p) return;
          showBar('이미 받아 둔 풀이가 있다 — <b>다시 결제하지 마라.</b><br>서고에서 그대로 열린다.', '내 서고 열기', reportUrl(p), true);
        });
    }).catch(function () { /* 조회 실패는 무시 */ });
  }

  function init() {
    var pkey = productKey();
    if (!pkey) return;
    var d = sidInfo();
    if (d && Date.now() - d.t < 30 * 24 * 3600e3) handleSid(d, pkey);
    else handleSession();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
