/* ═══════════════════════════════════════════════════════════════════════
 *  심곡사 사주 공통 로직 — 랜딩과 결과지가 같은 함수를 써야 진단이 어긋나지 않는다.
 *  (STEMS/BRANCHES, 띠, hashUser, 살 선택)
 * ═══════════════════════════════════════════════════════════════════════ */
(function (w) {
  'use strict';
  var SGS = w.SGS = w.SGS || {};
  SGS.STEMS    = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
  SGS.STEM_KO  = ['갑','을','병','정','무','기','경','신','임','계'];
  SGS.BRANCHES = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
  SGS.ZODIAC_KO   = ['쥐','소','호랑이','토끼','용','뱀','말','양','원숭이','닭','개','돼지'];
  SGS.ZODIAC_FILE = ['rat','ox','tiger','rabbit','dragon','snake','horse','goat','monkey','rooster','dog','pig'];

  SGS.yearStemIdx   = function (y) { return (((y - 4) % 10) + 10) % 10; };
  SGS.yearBranchIdx = function (y) { return (((y - 4) % 12) + 12) % 12; };
  SGS.yearPillar    = function (y) { return SGS.STEMS[SGS.yearStemIdx(y)] + SGS.BRANCHES[SGS.yearBranchIdx(y)]; };

  /* 문자열 해시 (java hashCode 식) */
  function strHash(s) { var h = 0; for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; } return Math.abs(h); }

  /* hashUser(user, version)
   *  user = { name, birth:{y,m,d}, gender }
   *  version 2 (기본): 월·일을 두 자리로 → "19950314"   version 1: 구형 "1995314" (기존 주문 호환) */
  SGS.hashUser = function (user, version) {
    var b = user && user.birth;
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var birth = !b ? '' : (version === 1 ? (b.y + '' + b.m + '' + b.d) : (b.y + pad(b.m) + pad(b.d)));
    return strHash((user.name || '') + birth + (user.gender || ''));
  };

  /* 살(殺)/구멍 선택 — 2~3개, 6과 서로소인 걸음으로 전체 순환 */
  SGS.pickSals = function (pool, h) {
    var count = 2 + ((h >> 5) % 2);
    var picks = [];
    var idx = h % pool.length;
    var step = ((h >> 7) % 2) ? 5 : 1;
    while (picks.length < count) {
      if (picks.indexOf(pool[idx]) === -1) picks.push(pool[idx]);
      idx = (idx + step) % pool.length;
    }
    return picks;
  };

  /* 구매 시각으로 해시 버전 결정 */
  SGS.hashVersionFor = function (createdAt) {
    if (!createdAt) return 2;
    return new Date(createdAt).getTime() < new Date(SGS.HASH_V2_SINCE).getTime() ? 1 : 2;
  };
})(window);
