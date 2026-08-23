/* ═══════════════════════════════════════════════════════════════════════
 *  심곡사 공통 설정 — 모든 페이지가 이 한 곳을 본다.
 *  (랜딩·서고·결과지·track.js)  ※ 웹훅(groble-webhook/index.ts)의 PRODUCTS 와 코드 일치 필수
 * ═══════════════════════════════════════════════════════════════════════ */
(function (w) {
  'use strict';
  var SGS = w.SGS = w.SGS || {};
  SGS.SUPA_URL = 'https://lpjuanegereuzufjzgbq.supabase.co';
  SGS.SUPA_KEY = 'sb_publishable_6cw7cndY7zeRh-u50zGL2w_qRKj8Jfa';   // 공개 키 — RLS 로 보호
  SGS.FN_URL   = SGS.SUPA_URL + '/functions/v1';
  SGS.ADMIN_EMAILS = ['motiol_6829@naver.com'];        // admin-api 의 목록과 동일하게

  /* 이 시각 이전에 만들어진 주문은 구(舊) 해시(v1: 월·일 0-패딩 없음)로 결과지를 연다.
     v2 부터는 0-패딩 → 1990-1-12 / 1990-11-2 충돌 제거. */
  SGS.HASH_V2_SINCE = '2026-08-23T07:55:00Z';

  SGS.PRODUCTS = {
    myodam: {
      name: '무녀 묘담', book: '운명 사용설명서 · 아흔아홉 장', report: '/report/', landing: '/myodam/',
      img: '/assets/hero.jpg', label: '묘담', store: 'sgs_myodam',
      tiers: {
        one:  { n: 1,  price: 3900,  code: 'xiXpcK', head: '묘담의 살풀이 · 고른 한 대목',   name: '한 대목' },
        five: { n: 5,  price: 14900, code: 'e7Ntiv', head: '묘담의 살풀이 · 고른 다섯 대목', name: '다섯 대목' },
        all:  { n: 10, price: 38900, code: 'kAAJFx', head: '묘담의 심층 살풀이 · 아흔아홉 장', name: '전부' }
      }
    },
    hyunwol: {
      name: '스님 현월', book: '재물의 경(經) · 여든여덟 장', report: '/gyeong/', landing: '/hyunwol/',
      img: '/assets/hyunwol.jpg', label: '현월', store: 'sgs_hyunwol',
      tiers: {
        one:  { n: 1,  price: 3900,  code: 'vuzWHN', head: '현월의 셈 · 고른 한 권',   name: '한 권' },
        five: { n: 5,  price: 14900, code: 'RpxRzG', head: '현월의 셈 · 고른 다섯 권', name: '다섯 권' },
        all:  { n: 10, price: 38900, code: '5xeDtU', head: '현월의 셈 · 재물의 경 여든여덟 장', name: '전부' }
      }
    },
    hongdan: { name: '아씨 홍단', book: '붉은 실의 기록', report: null, landing: '/hongdan/', img: '/assets/hongdan.jpg', label: '홍단', tiers: {} }
  };
  SGS.payUrl = function (code) { return 'https://www.groble.im/payment/' + code; };
  SGS.isAdmin = function (email) { return !!email && SGS.ADMIN_EMAILS.indexOf(String(email).toLowerCase()) !== -1; };
})(window);
