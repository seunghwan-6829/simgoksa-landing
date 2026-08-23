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

/* ── 이름 검사 — "..", "ㅇㅇ", "asdf" 같은 장난 입력을 거른다 ──
   통과: 한글 2~6자(완성형), 또는 영문 2~20자(이름용). 자모만·기호·숫자·같은 글자 반복은 탈락.
   반환: null(정상) 또는 무녀/스님 말투로 쓸 사유 키 */
(function (w) {
  'use strict';
  w.SGS.checkName = function (raw) {
    var v = String(raw || '').trim();
    if (v.length < 2) return 'short';
    if (/[ㄱ-ㅎㅏ-ㅣ]/.test(v)) return 'jamo';                        // ㅇㅇ, ㅋㅋ
    if (/[0-9]/.test(v) || /[^가-힣A-Za-z\s]/.test(v)) return 'symbol';   // .., ??, 김철수!
    var core = v.replace(/\s+/g, '');
    if (/^(.)\1+$/.test(core)) return 'repeat';                       // 아아아, aaaa
    var FAKE = ['asdf','asdfg','qwer','qwerty','zxcv','test','tester','abc','abcd','none','null','name','테스트','이름','본인','아무개','홍길동','무명','몰라','비밀','익명','그냥','없음','없어'];
    if (FAKE.indexOf(core.toLowerCase()) !== -1) return 'fake';        // 자리표시 이름
    if (/^[가-힣]+$/.test(core)) { if (core.length > 6) return 'long'; return null; }
    if (/^[A-Za-z\s]+$/.test(v)) { if (core.length > 20) return 'long'; return null; }
    return 'mixed';                                                     // 한글+영문 섞임
  };
})(window);

/* ── 현월 · 야망 축 — 그릇의 숫자 / 돈 팔자 유형 / 단안(斷案) / 올해 할 일 ──
   랜딩과 재물의 경이 같은 함수를 써야 숫자가 어긋나지 않는다. 전부 원국 해시(h)로 고정. */
(function (w) {
  'use strict';
  var S = w.SGS;
  S.vessel = function (h, nowY) {
    nowY = nowY || new Date().getFullYear();
    var EOK = [6, 8, 10, 12, 15, 18, 22, 27, 35, 45];
    var eok = EOK[(h >> 8) % 10];                       // 평생 그릇 (억)
    var filled = 1 + ((h >> 10) % 4);                   // 지금 채운 몫 (할, 1~4)
    var type = ['버는 팔자', '모으는 팔자', '불리는 팔자'][(h >> 14) % 3];
    var TYPE_DESC = {
      '버는 팔자': '들어오는 물이 굵다. 쥐는 법만 알면 판이 금방 커진다.',
      '모으는 팔자': '크게 들어오진 않아도 고이면 안 새는 그릇이다. 물길만 하나 더 트면 된다.',
      '불리는 팔자': '돈이 돈을 낳는 자리가 있다. 때를 맞춰 굴리면 그릇이 두 번 커진다.'
    };
    var peakAge = 36 + ((h >> 16) % 14);                // 그릇이 가장 크게 차는 나이
    // 단안 — 남자 앞의 결정 셋
    var DEC = [
      { k: 'move',   q: '이직 · 독립', v: [
        '지금 자리는 네 그릇의 반도 못 쓰는 자리다. 옮겨야 판이 커진다.',
        '옮기고 싶은 건 그릇이 아니라 조급함이다. 지금 자리에서 두 해는 더 쌓아라.',
        '옮기긴 옮긴다. 허나 {y}년 {m}월 전엔 판이 안 열려 있다— 그때까진 칼을 갈아라.' ] },
      { k: 'invest', q: '투자 · 주식 · 부동산', v: [
        '네 재성은 움직이는 돈에 붙는다. 다만 한 번에 넣지 말고 세 번에 나눠라.',
        '지금 네 물길은 들어오는 쪽이 아니라 새는 쪽이다. 이 구간의 투자는 남 좋은 일이다.',
        '{y}년 {m}월이 물때다. 그 전에 오는 "기회"는 전부 미끼라 봐라.' ] },
      { k: 'debt',   q: '동업 · 보증 · 대출', v: [
        '빚은 네 그릇엔 지렛대다. 단, 네 이름이 걸린 빚만— 남의 이름은 지지 마라.',
        '동업·보증·빌려주는 돈— 셋 다 네 구멍으로 직행한다. 올해는 전부 거절해라.',
        '지금은 아니다. {y}년 {m}월 이후, 그것도 문서 없이는 한 푼도.' ] }
    ];
    var verdicts = DEC.map(function (d, i) {
      var c = (h >> (18 + 2 * i)) % 3;
      var y = nowY + 1 + ((h >> (24 + i)) % 2), m = 1 + ((h >> (4 + 3 * i)) % 12);
      return { key: d.k, q: d.q, code: c, label: ['한다', '안 한다', '미룬다'][c],
               when: c === 2 ? (y + '년 ' + m + '월') : null,
               why: d.v[c].replace('{y}', y).replace('{m}', m) };
    });
    // 올해 할 일 셋 · 하지 말 일 셋
    var DO = ['통장을 셋으로 갈라라— 벌이·쌓기·굴리기. 섞이면 그릇이 안 보인다.',
              '네 몸값을 숫자로 적어 두고 반년마다 다시 적어라. 안 오르면 자리를 의심해라.',
              '큰 결정은 {m}월 전에 끝내라. 그 뒤는 판이 닫힌다.',
              '돈 이야기를 꺼내는 사람을 한 명 만들어라— 너보다 그릇이 큰 사람으로.',
              '한 해 목표를 금액으로 적어라. 그릇의 한 할(割)이 기준이다.',
              '벌이 하나에 물길 하나를 더 붙여라. 둘째 물길이 그릇을 키운다.'];
    var DONT = ['남의 이름이 걸린 돈— 보증·동업·빌려주기. 올해는 전부 거절해라.',
                '"곧 오른다"는 말에 한 번에 넣지 마라. 네 물때는 따로 있다.',
                '벌이가 알려지게 하지 마라. 드러난 돈은 새고 감춘 돈은 고인다.',
                '자리를 옮길 땐 홧김에 옮기지 마라. 그릇이 아니라 자존심이 움직이는 날이다.',
                '큰돈이 들어온 달에 큰 지출을 정하지 마라— 그 달이 제일 위험하다.',
                '잔고를 보며 한숨짓는 밤을 만들지 마라. 장부는 숫자로만 적는 것이다.'];
    var pick3 = function (arr, seed) { var out = [], i = seed % arr.length, st = (seed >> 3) % 2 ? 5 : 1; while (out.length < 3) { if (out.indexOf(arr[i]) === -1) out.push(arr[i]); i = (i + st) % arr.length; } return out; };
    var mDo = 4 + ((h >> 7) % 8);   // 4~11월
    return {
      eok: eok, filled: filled, remain: 10 - filled, type: type, typeDesc: TYPE_DESC[type], peakAge: peakAge,
      verdicts: verdicts,
      todo: pick3(DO, h >> 5).map(function (t) { return t.replace('{m}', mDo); }),
      dont: pick3(DONT, h >> 9)
    };
  };
  S.HAL = ['', '한 할', '두 할', '세 할', '네 할', '다섯 할', '여섯 할', '일곱 할', '여덟 할', '아홉 할'];
})(window);
