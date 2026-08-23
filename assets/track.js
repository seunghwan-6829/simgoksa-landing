/* ════════════════════════════════════════════════════════════════════════════
 *  심곡사 추적 스크립트 — Meta Pixel + 전환 준비
 *
 *  공개 페이지는 <head> 에 이 한 줄만 넣는다:
 *      <script src="/assets/track.js"></script>
 *
 *  ★ 관리자 페이지(/admin/)에는 넣지 않는다 ★
 *    우리 접속이 광고 데이터·리타게팅 모수를 오염시킨다.
 *
 *  픽셀 ID 교체는 이 파일의 PIXEL_ID 한 줄만 고치면 된다.
 *
 *  ┌──────────────────────────────────────────────────────────────────────┐
 *  │ 새 랜딩을 만드는 사람이 알아야 할 것은 이것뿐이다                      │
 *  │                                                                      │
 *  │  1) <head> 에 <script src="/assets/track.js"></script>               │
 *  │  2) 전환 지점 버튼에 속성만 달면 된다 (fbq 를 몰라도 된다):           │
 *  │       <button data-track="InitiateCheckout" data-product="myodam">   │
 *  │  3) 코드에서 직접 쏠 때는:  metaTrack('Lead')                        │
 *  └──────────────────────────────────────────────────────────────────────┘
 *
 *  [noscript 픽셀을 넣지 않는 이유]
 *  이 사이트는 JS 없이는 화면 자체가 동작하지 않는다(입력·진단·결제 전부 JS).
 *  JS 가 꺼진 방문자는 어차피 퍼널에 진입하지 못하므로 noscript 이미지는 의미가 없고,
 *  넣으면 픽셀 ID 가 페이지 수만큼 흩어져 "한 파일만 고치면 되는" 성질이 깨진다.
 * ════════════════════════════════════════════════════════════════════════════ */
(function (window, document) {
  'use strict';

  /* ── 픽셀 ID (공개값 — HTML/JS 에 노출되어도 되는 값) ────────────────── */
  var PIXEL_ID = '1230171529252220';

  /* ── 상품 정보는 여기 한 곳에만 둔다 ──────────────────────────────────
   *  랜딩·픽셀·웹훅이 같은 값을 봐야 한다.
   *  id 는 그로블 결제링크 코드(= data.object.content.id)이고,
   *  웹훅(supabase/functions/groble-webhook/index.ts)의 PRODUCTS 표와 일치시킨다.
   *  새 상품 추가 시 두 곳을 함께 고칠 것.                                 */
  var PRODUCTS = {
    myodam:  { id: 'kAAJFx', name: '무녀 묘담 · 운명 사용설명서 아흔아홉 장', value: 38900,
      /* 찢어가기 등급 — 결제창이 셋이라 content_id 와 금액이 등급마다 다르다 */
      tiers: {
        one:  { id: 'xiXpcK', name: '무녀 묘담 · 살풀이 한 대목 찢어가기',   value: 3900 },
        five: { id: 'e7Ntiv', name: '무녀 묘담 · 살풀이 다섯 대목 찢어가기', value: 14900 },
        all:  { id: 'kAAJFx', name: '무녀 묘담 · 운명 사용설명서 아흔아홉 장', value: 38900 }
      } },
    hyunwol: { id: '5xeDtU', name: '스님 현월 · 재물의 경 여든여덟 장',       value: 49000,
      tiers: {
        one:  { id: 'vuzWHN', name: '스님 현월 · 재물의 경 한 권 찢어가기',   value: 6900 },
        five: { id: 'RpxRzG', name: '스님 현월 · 재물의 경 다섯 권 찢어가기', value: 24900 },
        all:  { id: '5xeDtU', name: '스님 현월 · 재물의 경 여든여덟 장',       value: 49000 }
      } }
  };
  /* 결제창 코드 → 상품/등급 역조회 (서고의 Purchase 처럼 결제 코드만 아는 곳에서 쓴다) */
  function productByContentId(cid) {
    for (var k in PRODUCTS) {
      if (!Object.prototype.hasOwnProperty.call(PRODUCTS, k)) continue;
      var p = PRODUCTS[k];
      if (p.id === cid) return p.tiers && p.tiers.all ? p.tiers.all : p;
      if (p.tiers) for (var t in p.tiers) if (p.tiers[t].id === cid) return p.tiers[t];
    }
    return null;
  }
  var CURRENCY = 'KRW';

  /* 현재 페이지의 상품 추정 — /myodam/ → myodam, /gyeong/ → hyunwol(현월 결과지) */
  function currentProduct() {
    var p = location.pathname;
    if (p.indexOf('/myodam') === 0 || p.indexOf('/report') === 0) return 'myodam';
    if (p.indexOf('/hyunwol') === 0 || p.indexOf('/gyeong') === 0) return 'hyunwol';
    return null;
  }

  /* ── 쿠키 읽기 ────────────────────────────────────────────────────────── */
  function cookie(name) {
    var m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return m ? decodeURIComponent(m[2]) : null;
  }

  /* ── fbclid → _fbc 직접 생성 ──────────────────────────────────────────
   *  광고 클릭 직후에는 픽셀이 _fbc 쿠키를 아직 안 심었을 수 있다.
   *  형식: fb.1.{타임스탬프}.{fbclid}
   *  fbclid 는 첫 진입 URL 에만 있으므로 localStorage 에 보관해
   *  이후 페이지 이동·재방문에서도 계속 실어 보낸다.                        */
  var FBC_KEY = 'sg_fbc';
  (function captureFbclid() {
    try {
      var fbclid = new URLSearchParams(location.search).get('fbclid');
      if (fbclid) {
        localStorage.setItem(FBC_KEY, 'fb.1.' + Date.now() + '.' + fbclid);
      }
    } catch (e) { /* 사생활 보호 모드 등 — 무시 */ }
  })();

  function storedFbc() {
    try { return localStorage.getItem(FBC_KEY); } catch (e) { return null; }
  }

  /* ── metaIds — 반드시 getter 로 노출한다 ──────────────────────────────
   *  ⚠️ 함정: _fbp 쿠키는 픽셀 스크립트가 로드된 "뒤"에 심긴다.
   *     <head> 실행 시점에 값을 한 번 읽어 캐시하면 그 순간엔 쿠키가 없어서
   *     fbp 가 영원히 null 로 나간다. 읽을 때마다 쿠키를 다시 보게 해야 한다.  */
  var metaIds = {};
  Object.defineProperty(metaIds, 'fbp', {
    get: function () { return cookie('_fbp'); },
    enumerable: true
  });
  Object.defineProperty(metaIds, 'fbc', {
    // 픽셀이 심은 쿠키 우선, 없으면 fbclid 로 만든 값
    get: function () { return cookie('_fbc') || storedFbc(); },
    enumerable: true
  });
  Object.defineProperty(metaIds, 'userAgent', {
    get: function () { return navigator.userAgent; },
    enumerable: true
  });
  window.metaIds = metaIds;

  /* ── event_id 생성기 ──────────────────────────────────────────────────
   *  지금은 브라우저와 서버가 겹치는 이벤트가 없어(Purchase 는 서버 전용)
   *  중복제거가 필요 없다. 다만 나중에 상위 퍼널도 이중 전송하게 되면
   *  양쪽이 같은 event_id 를 써야 하므로 헬퍼를 미리 둔다.
   *  서버(CAPI)로도 보낼 이벤트는 이 값을 함께 넘겨라.                      */
  function metaEventId(kind) {
    var rand = Math.random().toString(36).slice(2, 10);
    return (kind || 'evt') + '.' + Date.now() + '.' + rand;
  }
  window.metaEventId = metaEventId;

  /* ── 픽셀 부트스트랩 (Meta 공식 스니펫) ───────────────────────────────── */
  /* eslint-disable */
  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return; n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments)
    };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0';
    n.queue = []; t = b.createElement(e); t.async = !0;
    t.src = v; s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s)
  }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */

  fbq('init', PIXEL_ID);
  fbq('track', 'PageView');

  /* ── metaTrack — 전환 이벤트 전송 ─────────────────────────────────────
   *  metaTrack('Lead')
   *  metaTrack('InitiateCheckout', { product: 'myodam', tier: 'five' })   ← 등급별 코드·금액
   *  metaTrack('Purchase', { contentId: 'xiXpcK', value: 3900 }, merchantUid)
   *  metaTrack('ViewContent', { product: 'hyunwol' }, myEventId)
   *
   *  product 키를 주면 PRODUCTS 표에서 content_ids / value / currency 를 채운다.
   *  반환값은 event_id — 같은 이벤트를 서버로도 보낼 때 그대로 넘기면 중복제거된다.  */
  function metaTrack(eventName, opts, eventId) {
    try {
      opts = opts || {};
      var key = opts.product || currentProduct();
      var p = key && PRODUCTS[key];
      // 등급(tier)이나 결제창 코드(contentId)를 알면 그 등급의 코드·금액을 쓴다
      if (p && opts.tier && p.tiers && p.tiers[opts.tier]) p = p.tiers[opts.tier];
      else if (opts.contentId) p = productByContentId(opts.contentId) || p;
      var params = {};

      // 금액이 의미 있는 이벤트에만 value 를 싣는다 (Lead 등에 붙이면 집계가 왜곡된다)
      var VALUED = ['InitiateCheckout', 'Purchase', 'AddToCart', 'ViewContent'];
      if (p) {
        params.content_ids = [p.id];
        params.content_name = p.name;
        params.content_type = 'product';
      }
      if (VALUED.indexOf(eventName) !== -1) {
        // 상품 표에 없는 키(예: 웹훅이 unknown 으로 격리한 건)라도
        // 실제 결제 금액을 알면 그대로 싣는다 — value 가 0/누락이면 ROAS 를 못 본다.
        var v = opts.value != null ? opts.value : (p ? p.value : null);
        if (v != null) {
          params.value = v;
          params.currency = opts.currency || CURRENCY;
        }
      }
      if (opts.params) {
        for (var k in opts.params) {
          if (Object.prototype.hasOwnProperty.call(opts.params, k)) params[k] = opts.params[k];
        }
      }

      var id = eventId || metaEventId(eventName);
      fbq('track', eventName, params, { eventID: id });
      return id;
    } catch (e) {
      return null;
    }
  }
  window.metaTrack = metaTrack;

  /* ── 선언형 전환 — DOM 속성만 달면 잡힌다 ─────────────────────────────
   *  <a data-track="InitiateCheckout" data-product="myodam">결제하기</a>
   *  위임(delegation)이라 나중에 동적으로 생긴 버튼도 자동으로 잡힌다.
   *  같은 요소를 여러 번 눌러도 이벤트가 중복되지 않도록 한 번만 발화시킨다.   */
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-track]') : null;
    if (!el) return;
    if (el.getAttribute('data-track-fired') === '1' && el.hasAttribute('data-track-once')) return;
    el.setAttribute('data-track-fired', '1');
    metaTrack(el.getAttribute('data-track'), {
      product: el.getAttribute('data-product') || undefined
    });
  }, true);

})(window, document);
