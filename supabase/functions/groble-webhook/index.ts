// ════════════════════════════════════════════════════════════════════════════
//  그로블 결제 웹훅 수신기
//  공식 스펙: https://www.groble.im/help/guides/webhook
//
//  ┌────────────────────────────────────────────────────────────────────────┐
//  │  ★ 새 상품(캐릭터)을 출시할 때 고쳐야 할 곳 — 전부 여기 적혀 있다  ★    │
//  ├────────────────────────────────────────────────────────────────────────┤
//  │  1. 이 파일의 PRODUCTS 배열에 한 줄 추가 (contentId·상품명·결과지 경로) │
//  │  2. /library/index.html 의 CHAR 맵에 한 줄 추가 (썸네일·책 제목·경로)   │
//  │  3. 새 랜딩 페이지의 PAY_URL 을 PRODUCTS 의 payUrl 과 동일하게 맞출 것   │
//  │  4. 랜딩의 결제 이동에 ?ref=<session_id> 가 붙는지 확인                 │
//  │  → 1번을 빠뜨리면 product='unknown' + status='paid' 로 떨어져           │
//  │    어드민에서 눈에 띈다. (기존 상품으로 오배송되지 않는다)              │
//  └────────────────────────────────────────────────────────────────────────┘
//
//  [보안 규약]
//   · 서명은 JSON 파싱 전 원문 문자열로 계산: HEX(HMAC-SHA256(secret, `${ts}.${raw}`))
//   · 타임스탬프 ±5분
//   · GROBLE_WEBHOOK_SECRET 미설정이면 503 — 설정 누락으로 무방비가 되는 사고 방지
//   · 시크릿 교체기간(24h)에는 X-Groble-Signature-Previous + GROBLE_WEBHOOK_SECRET_PREV 허용
//
//  [응답코드 규약] 그로블은 408/429/500~504 를 받으면 최대 7회(≈44시간) 재시도한다.
//   · 200 : 정상 처리 / 중복(멱등) / 미지원 이벤트 무시
//   · 400 : 서명은 통과했으나 본문이 깨짐 (재시도해도 무의미)
//   · 401 : 서명·타임스탬프 실패
//   · 503 : 시크릿 미설정
//   · 500 : 일시적 DB 오류 — 이때만 재시도를 받는다
// ════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
//  상품 표 — 새 상품은 여기 한 줄 추가로 끝난다.
//  contentIds 는 그로블 결제링크 코드(= data.object.content.id)와 동일하다.
// ─────────────────────────────────────────────────────────────────────────────
type Product = {
  key: string;
  label: string;
  contentIds: string[];
  titleHints: string[];   // 스토어 상품명 부분일치 — contentId 가 바뀌었을 때의 2차 방어선
  amount: number | null;  // 정상가(원). 참고용 — 실제 금액은 pricing.finalAmount 를 쓴다.
  payUrl: string;
  reportPath: string;     // 결과지 경로 (서고에서 여는 곳)
};

const PRODUCTS: Product[] = [
  {
    key: "myodam",
    label: "무녀 묘담 · 운명 사용설명서 아흔아홉 장",
    contentIds: ["kAAJFx"],
    titleHints: ["묘담", "살풀이", "운명 사용설명서"],
    amount: 38900,
    payUrl: "https://www.groble.im/payment/kAAJFx",
    reportPath: "/report/",
  },
  {
    key: "hyunwol",
    label: "스님 현월 · 재물의 경 여든여덟 장",
    contentIds: ["5xeDtU"],
    titleHints: ["현월", "재물의 경", "재물"],
    amount: 38900,
    payUrl: "https://www.groble.im/payment/5xeDtU",
    reportPath: "/gyeong/",
  },
];

// 미식별 상품의 기본값. 기존 상품으로 폴백하지 않는다 —
// 오배송(다른 상품 결과지가 delivered 로 열리는 사고)이 조용히 발생하기 때문.
const UNKNOWN_PRODUCT = "unknown";

// 화이트리스트는 명시적 배열 검사. (`key in OBJ` 는 'constructor' 같은 상속 키까지 통과한다)
const PRODUCT_KEYS: string[] = PRODUCTS.map((p) => p.key);
const findByContentId = (id: string | null): Product | null =>
  id ? PRODUCTS.find((p) => p.contentIds.includes(id)) ?? null : null;
const findByTitle = (title: string | null): Product | null =>
  title ? PRODUCTS.find((p) => p.titleHints.some((h) => title.includes(h))) ?? null : null;
const findByKey = (key: string | null): Product | null =>
  key && PRODUCT_KEYS.includes(key) ? PRODUCTS.find((p) => p.key === key) ?? null : null;

// ─────────────────────────────────────────────────────────────────────────────
//  이벤트 라우팅
// ─────────────────────────────────────────────────────────────────────────────
const PAID_EVENTS = ["payment.completed", "subscription_payment.completed"];
const REFUND_EVENTS = ["payment.refunded", "subscription_payment.refunded"];

// ─────────────────────────────────────────────────────────────────────────────
//  유틸
// ─────────────────────────────────────────────────────────────────────────────
const enc = new TextEncoder();

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 길이 노출은 감수하되 내용 비교는 상수시간으로 (hex 는 대소문자 무시)
function safeEq(a: string, b: string): boolean {
  const x = a.trim().toLowerCase(), y = b.trim().toLowerCase();
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// 중첩 키 안전 탐색
const dig = (obj: unknown, path: string): unknown =>
  path.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);

function str(obj: unknown, ...paths: string[]): string | null {
  for (const p of paths) {
    const v = dig(obj, p);
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return null;
}
function num(obj: unknown, ...paths: string[]): number | null {
  for (const p of paths) {
    const v = dig(obj, p);
    if (v !== undefined && v !== null && v !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

// 저장에서 제외할 헤더 — 서명·인증·쿠키 계열
const HEADER_DENYLIST = [
  "x-groble-signature",
  "x-groble-signature-previous",
  "authorization",
  "apikey",
  "cookie",
  "set-cookie",
  "proxy-authorization",
];
function safeHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of req.headers.entries()) {
    if (HEADER_DENYLIST.includes(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

// sellerReference 허용 문자: A-Z a-z 0-9 - _ . : = ~ / 길이 1~128
const REF_RE = /^[A-Za-z0-9\-_.:=~]{1,128}$/;

// ─────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "GET") {
    return json({ ok: true, service: "simgoksa groble-webhook", products: PRODUCT_KEYS });
  }
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  // ── 0) 시크릿 미설정이면 아예 받지 않는다 ────────────────────────────────
  const SECRET = Deno.env.get("GROBLE_WEBHOOK_SECRET");
  const SECRET_PREV = Deno.env.get("GROBLE_WEBHOOK_SECRET_PREV");
  if (!SECRET) {
    console.error("GROBLE_WEBHOOK_SECRET is not set — refusing to accept webhooks");
    return json({ ok: false, error: "webhook_secret_not_configured" }, 503);
  }

  const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const H = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  // ── 1) 원문 확보 — 반드시 파싱 전에. 재직렬화하면 서명이 절대 안 맞는다 ──
  const raw = await req.text();

  const sig = req.headers.get("x-groble-signature");
  const sigPrev = req.headers.get("x-groble-signature-previous");
  const ts = req.headers.get("x-groble-timestamp");

  // 401 은 그로블 기준 '최종 실패' — 재시도가 없다. 즉 거절 = 결제 기록 유실이다.
  // 시크릿 불일치를 조용히 넘기지 않도록 거절은 전부 로그에 남긴다.
  // (DB 에 남기지 않는 이유: 이 경로는 인증 전이라 스팸 쓰기 통로가 되기 때문)
  const reject = (reason: string) => {
    console.error(
      `[groble-webhook] REJECTED ${reason} — ` +
      `sig=${sig ? "present" : "MISSING"} prev=${sigPrev ? "present" : "none"} ` +
      `ts=${ts ?? "MISSING"} bodyBytes=${raw.length} ` +
      `ua=${req.headers.get("user-agent") ?? "-"}`,
    );
    return json({ ok: false, error: reason }, 401);
  };

  if (!sig || !ts) return reject("missing_signature_headers");

  // ── 2) 타임스탬프 ±5분 (과거 요청 복사·재전송 차단) ──────────────────────
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return reject("bad_timestamp");
  const skew = Math.abs(Date.now() / 1000 - tsNum);
  if (skew > 300) return reject("timestamp_out_of_window");

  // ── 3) 서명 검증 (현재 시크릿 → 교체기간이면 이전 시크릿) ────────────────
  const signed = `${ts}.${raw}`;
  let verified = safeEq(await hmacHex(SECRET, signed), sig);
  if (!verified && SECRET_PREV && sigPrev) {
    verified = safeEq(await hmacHex(SECRET_PREV, signed), sigPrev);
  }
  if (!verified) return reject("invalid_signature");

  // ── 4) 여기서부터는 그로블이 보낸 것이 확실하다 ──────────────────────────
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
  } catch (_e) {
    // 서명은 맞는데 본문이 깨짐 → 재시도해도 같은 결과. 400 으로 종결.
    console.error("signature ok but body unparseable", raw.slice(0, 400));
    return json({ ok: false, error: "malformed_body" }, 400);
  }

  const eventId = str(body, "id");
  const eventType = str(body, "type");
  const obj = dig(body, "data.object");
  const merchantUid = str(obj, "merchantUid");
  const idemKey = req.headers.get("x-groble-idempotency-key") || eventId || null;

  // ── 5) 멱등 게이트 ───────────────────────────────────────────────────────
  //   같은 전송이 이미 '처리 완료'로 남아 있으면 200 으로 즉시 종결한다.
  //   (중복에 5xx 를 주면 그로블이 44시간 동안 재시도한다)
  if (idemKey) {
    try {
      const q = `${SUPA_URL}/rest/v1/webhook_events` +
        `?source=eq.groble&idempotency_key=eq.${encodeURIComponent(idemKey)}` +
        `&select=id,status&limit=1`;
      const r = await fetch(q, { headers: H });
      if (r.ok) {
        const rows = await r.json();
        if (Array.isArray(rows) && rows.length && ["processed", "ignored"].includes(rows[0].status)) {
          return json({ ok: true, duplicate: true, status: rows[0].status });
        }
      }
    } catch (_e) { /* 조회 실패는 무시 — 아래 upsert 로 어차피 한 줄만 남는다 */ }
  }

  // 수신 원문 기록 (서명·인증 헤더 제외). 멱등키 충돌 시 병합.
  const eventRow = {
    source: "groble",
    idempotency_key: idemKey,
    event_id: eventId,
    event_type: eventType,
    merchant_uid: merchantUid,
    status: "received",
    headers: safeHeaders(req),
    payload: body,
  };
  let eventRowId: string | null = null;
  try {
    const er = await fetch(
      `${SUPA_URL}/rest/v1/webhook_events?on_conflict=source,idempotency_key`,
      {
        method: "POST",
        headers: { ...H, Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(eventRow),
      },
    );
    if (er.ok) {
      const rows = await er.json();
      if (Array.isArray(rows) && rows.length) eventRowId = rows[0].id;
    } else {
      console.error("webhook_events insert failed", er.status, await er.text());
    }
  } catch (e) {
    console.error("webhook_events insert threw", String(e));
  }

  const markEvent = async (status: string, note?: string) => {
    if (!eventRowId) return;
    try {
      await fetch(`${SUPA_URL}/rest/v1/webhook_events?id=eq.${eventRowId}`, {
        method: "PATCH",
        headers: { ...H, Prefer: "return=minimal" },
        body: JSON.stringify({ status, note: note ?? null }),
      });
    } catch (_e) { /* 기록 실패는 처리 결과에 영향 주지 않는다 */ }
  };

  // ── 6) 이벤트 라우팅 ─────────────────────────────────────────────────────
  if (!eventType || (!PAID_EVENTS.includes(eventType) && !REFUND_EVENTS.includes(eventType))) {
    await markEvent("ignored", `unsupported event: ${eventType ?? "(none)"}`);
    return json({ ok: true, ignored: true, type: eventType });
  }
  if (!merchantUid) {
    await markEvent("ignored", "missing merchantUid");
    return json({ ok: true, ignored: true, reason: "missing_merchant_uid" });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  환불 — payment.refunded 에는 sellerReference 가 오지 않는다(공식 스펙).
  //  merchantUid 로만 기존 주문을 찾아 상태를 바꾼다.
  // ══════════════════════════════════════════════════════════════════════════
  if (REFUND_EVENTS.includes(eventType)) {
    const patch = {
      status: "refunded",
      event_id: eventId,
      event_type: eventType,
      refunded_at: str(obj, "refund.refundedAt") ?? new Date().toISOString(),
      refund_amount: num(obj, "refund.amount"),
      refund_reason: str(obj, "refund.reason", "refund.cancelledBy"),
      updated_at: new Date().toISOString(),
    };
    try {
      const r = await fetch(
        `${SUPA_URL}/rest/v1/purchases?groble_purchase_id=eq.${encodeURIComponent(merchantUid)}`,
        { method: "PATCH", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(patch) },
      );
      if (!r.ok) {
        console.error("refund patch failed", r.status, await r.text());
        await markEvent("failed", "refund patch failed");
        return json({ ok: false, error: "db_error" }, 500);   // 일시적 DB 오류 → 재시도 허용
      }
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length === 0) {
        // 결제 웹훅을 못 받았던 건의 환불 — 유실하지 않도록 환불 상태로 새로 기록한다.
        const p = findByContentId(str(obj, "content.id")) ?? findByTitle(str(obj, "content.title"));
        const ins = await fetch(`${SUPA_URL}/rest/v1/purchases?on_conflict=groble_purchase_id`, {
          method: "POST",
          headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({
            groble_purchase_id: merchantUid,
            groble_content_id: str(obj, "content.id"),
            product: p?.key ?? UNKNOWN_PRODUCT,
            product_name: str(obj, "content.title"),
            content_title: str(obj, "content.title"),
            buyer_email: str(obj, "buyer.email"),
            buyer_name: str(obj, "buyer.displayName"),
            buyer_phone: str(obj, "buyer.phoneNumber"),
            amount: num(obj, "pricing.finalAmount"),
            payload: body,
            ...patch,
          }),
        });
        if (!ins.ok) {
          console.error("orphan refund insert failed", ins.status, await ins.text());
          await markEvent("failed", "orphan refund insert failed");
          return json({ ok: false, error: "db_error" }, 500);
        }
      }
    } catch (e) {
      console.error("refund threw", String(e));
      await markEvent("failed", String(e));
      return json({ ok: false, error: "db_error" }, 500);
    }
    await markEvent("processed", "refunded");
    return json({ ok: true, action: "refunded", merchantUid });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  결제 완료
  // ══════════════════════════════════════════════════════════════════════════
  const contentId = str(obj, "content.id");
  const contentTitle = str(obj, "content.title");
  const buyerEmail = str(obj, "buyer.email");
  const buyerName = str(obj, "buyer.displayName");

  // ── 우리 쪽 세션 붙이기 ──────────────────────────────────────────────────
  //  결제창은 우리 화면이 아니므로 사용자가 입력한 정보가 결제데이터에 없다.
  //  랜딩에서 groble.im/payment/<code>?ref=<session_id> 로 보낸 값이
  //  data.object.sellerReference 로 되돌아온다. (ref/reference 키가 아니다)
  const refRaw = str(obj, "sellerReference");
  const sellerReference = refRaw && REF_RE.test(refRaw) ? refRaw : null;

  let leadUserId: string | null = null;
  let leadEmail: string | null = null;
  let leadProductKey: string | null = null;
  let sajuFromLead: string | null = null;

  const sajuOf = (l: { name?: string | null; birth?: string | null; gender?: string | null }) => {
    if (!l.name || !l.birth) return null;
    const [y, m, d] = String(l.birth).split("-");
    return `${l.name} / ${y}.${m}.${d} / ${l.gender || ""}`.trim();
  };

  if (sellerReference) {
    try {
      const q = `${SUPA_URL}/rest/v1/leads?session_id=eq.${encodeURIComponent(sellerReference)}` +
        `&order=created_at.desc&limit=30&select=created_at,event,email,user_id,name,birth,gender,product`;
      const r = await fetch(q, { headers: H });
      if (r.ok) {
        const rows: Array<Record<string, string | null>> = await r.json();
        for (const l of rows) {
          if (!leadUserId && l.user_id) leadUserId = l.user_id;
          if (!leadEmail && l.email) leadEmail = l.email;
          if (!leadProductKey && l.product) leadProductKey = l.product;
          if (!sajuFromLead) sajuFromLead = sajuOf(l);
        }
      }
    } catch (e) {
      console.error("lead lookup by sellerReference failed", String(e));
    }
  }

  // ── 폴백: ref 가 없을 때만 이메일로 최근 pay_intent 를 찾는다 ────────────
  //  (스펙상 이메일 매칭은 폴백 전용. 이름·시간 근접 매칭은 남의 사주가 붙을 수 있어 쓰지 않는다)
  if (!leadUserId && !sajuFromLead && buyerEmail) {
    try {
      const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const q = `${SUPA_URL}/rest/v1/leads?event=eq.pay_intent&created_at=gte.${since}` +
        `&email=eq.${encodeURIComponent(buyerEmail)}` +
        `&order=created_at.desc&limit=5&select=created_at,email,user_id,name,birth,gender,product`;
      const r = await fetch(q, { headers: H });
      if (r.ok) {
        const rows: Array<Record<string, string | null>> = await r.json();
        if (rows.length) {
          leadUserId = leadUserId ?? rows[0].user_id;
          leadEmail = leadEmail ?? rows[0].email;
          leadProductKey = leadProductKey ?? rows[0].product;
          sajuFromLead = sajuFromLead ?? sajuOf(rows[0]);
        }
      }
    } catch (e) {
      console.error("lead lookup by email failed", String(e));
    }
  }

  // ── 상품 판별 ────────────────────────────────────────────────────────────
  //  ① 판매자측 값 (content.id → 스토어 상품명) — 구매자가 건드릴 수 없다
  //  ② 리드 테이블의 값 — anon INSERT 가 열린 표라 위조 가능하므로 ①이 없을 때만
  //  ③ 기본값 unknown — 기존 상품으로 폴백하지 않는다
  const product =
    findByContentId(contentId) ??
    findByTitle(contentTitle) ??
    findByKey(leadProductKey);
  const productKey = product?.key ?? UNKNOWN_PRODUCT;

  // ── 사주 확보: 그로블 결제창 주관식 답변 우선, 없으면 우리 세션의 입력값 ─
  const qa = dig(obj, "questionAnswers");
  const qaAnswer = Array.isArray(qa) && qa.length && qa[0]?.answer ? String(qa[0].answer) : null;
  const saju = qaAnswer ?? sajuFromLead;

  // 결과지는 자동 생성이므로, 상품이 확정되고 사주가 있으면 즉시 열람 가능(delivered).
  // 둘 중 하나라도 없으면 paid 로 남겨 어드민이 처리한다.
  let status = product && saju ? "delivered" : "paid";

  // 이미 환불된 건이면 상태를 되돌리지 않는다.
  // 그로블은 payment.completed 를 최대 44시간 재시도하므로, 환불이 먼저 반영된 뒤
  // 결제 재시도가 늦게 도착해 delivered 로 되살아나는 순서 역전이 가능하다.
  try {
    const ex = await fetch(
      `${SUPA_URL}/rest/v1/purchases?groble_purchase_id=eq.${encodeURIComponent(merchantUid)}&select=status&limit=1`,
      { headers: H },
    );
    if (ex.ok) {
      const rows = await ex.json();
      if (Array.isArray(rows) && rows.length && rows[0].status === "refunded") {
        status = "refunded";
      }
    }
  } catch (_e) { /* 조회 실패 시에는 정상 판정을 그대로 쓴다 */ }

  const row = {
    groble_purchase_id: merchantUid,
    groble_content_id: contentId,
    seller_reference: sellerReference,
    event_id: eventId,
    event_type: eventType,
    user_id: leadUserId,
    site_email: leadEmail,
    buyer_email: buyerEmail,
    buyer_name: buyerName,
    buyer_phone: str(obj, "buyer.phoneNumber"),
    product: productKey,
    product_name: contentTitle,
    content_title: contentTitle,
    amount: num(obj, "pricing.finalAmount"),
    saju_answer: saju,
    tracking_code: str(obj, "trackingLink.code"),
    purchased_at: str(obj, "payment.purchasedAt"),
    status,
    payload: body,
    updated_at: new Date().toISOString(),
  };

  try {
    // merchantUid 유니크 + upsert → 재전송이 와도 한 건만 남는다.
    const r = await fetch(`${SUPA_URL}/rest/v1/purchases?on_conflict=groble_purchase_id`, {
      method: "POST",
      headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const err = await r.text();
      console.error("purchase upsert failed", r.status, err);
      await markEvent("failed", `purchase upsert ${r.status}`);
      return json({ ok: false, error: "db_error" }, 500);   // 일시적 DB 오류 → 재시도 허용
    }
  } catch (e) {
    console.error("purchase upsert threw", String(e));
    await markEvent("failed", String(e));
    return json({ ok: false, error: "db_error" }, 500);
  }

  if (productKey === UNKNOWN_PRODUCT) {
    console.error(
      `UNMAPPED PRODUCT — contentId=${contentId} title=${contentTitle} merchantUid=${merchantUid}. ` +
      `Add it to PRODUCTS in groble-webhook/index.ts (see header comment).`,
    );
  }

  await markEvent("processed", `${productKey}/${status}`);
  return json({ ok: true, action: "paid", merchantUid, product: productKey, status });
});
