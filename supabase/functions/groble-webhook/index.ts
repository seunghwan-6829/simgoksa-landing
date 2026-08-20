// 그로블 결제 완료 웹훅 수신 → purchases 테이블 기록
// 실제 페이로드 구조(2026-08-17 실결제로 확인):
//   { type: "payment.completed", data: { object: {
//       buyer: { email, displayName, phoneNumber },
//       content: { id, title },
//       merchantUid,
//       pricing: { finalAmount },
//       questionAnswers: [{ answer, question }] } } }
// 형식 변동에 대비해 원본 payload를 통째로 저장하고, 구버전 추측 경로도 폴백으로 유지한다.
Deno.serve(async (req) => {
  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, service: "simgoksa groble-webhook" }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch (_e) {
    try {
      const text = await req.text();
      body = { raw: text };
    } catch (_e2) { /* ignore */ }
  }

  // 중첩 키 탐색 유틸
  const dig = (obj: unknown, path: string): unknown =>
    path.split(".").reduce((o: any, k) => (o == null ? undefined : o[k]), obj);
  const pick = (...paths: string[]): string | null => {
    for (const p of paths) {
      const v = dig(body, p);
      if (v !== undefined && v !== null && v !== "") return String(v);
    }
    return null;
  };

  // 주관식 답변 (questionAnswers 배열 → 첫 답변)
  const qa = dig(body, "data.object.questionAnswers");
  const qaAnswer = Array.isArray(qa) && qa.length > 0 && qa[0]?.answer ? String(qa[0].answer) : null;

  // 그로블 상품 ID → 캐릭터 매핑. 새 캐릭터(현월·홍단 등) 출시 시 여기에 한 줄씩 추가한다.
  const CONTENT_PRODUCT: Record<string, string> = {
    "kAAJFx": "myodam",
    "5xeDtU": "hyunwol",
  };
  const contentId = pick("data.object.content.id", "contentId", "content_id", "data.contentId", "content.id");

  const buyerEmail = pick("data.object.buyer.email", "buyerEmail", "buyer_email", "email", "data.buyerEmail", "data.email", "user.email", "customer.email");
  const buyerName = pick("data.object.buyer.displayName", "buyerName", "buyer_name", "name", "data.buyerName", "data.name", "customer.name");

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svcHeaders = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  // ── pay_intent 매칭: 결제 직전 사이트에서 남긴 의향 기록(이메일+사주)과 잇는다 ──
  // 그로블 계정 이메일과 사이트 계정 이메일이 다를 수 있으므로:
  //   1순위: 이메일 일치  2순위: 사주 속 이름 == 그로블 실명  3순위: 최근 30분 내 의향이 정확히 1건
  let sajuFromIntent: string | null = null;
  let siteEmail: string | null = null;
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const q = `${url}/rest/v1/leads?event=eq.pay_intent&created_at=gte.${since}&order=created_at.desc&limit=30&select=created_at,email,name,birth,gender`;
    const lr = await fetch(q, { headers: svcHeaders });
    if (lr.ok) {
      const intents: Array<{ created_at: string; email: string | null; name: string | null; birth: string | null; gender: string | null }> = await lr.json();
      const toSaju = (it: typeof intents[0]) => {
        if (!it.name || !it.birth) return null;
        const [y, m, d] = it.birth.split("-");
        return `${it.name} / ${y}.${m}.${d} / ${it.gender || ""}`.trim();
      };
      let hit = buyerEmail
        ? intents.find((it) => it.email && it.email.toLowerCase() === buyerEmail.toLowerCase())
        : undefined;
      if (!hit && buyerName) {
        hit = intents.find((it) => it.name && it.name.trim() === buyerName.trim());
      }
      if (!hit) {
        const recent = intents.filter((it) => Date.now() - new Date(it.created_at).getTime() < 30 * 60 * 1000);
        if (recent.length === 1) hit = recent[0];
      }
      if (hit) {
        siteEmail = hit.email;
        sajuFromIntent = toSaju(hit);
      }
    }
  } catch (_e) { /* 매칭 실패해도 결제 기록은 계속 */ }

  // 사주가 확보된 묘담 결제는 즉시 도착(delivered) — 결과지는 자동 생성이므로 바로 열람 가능.
  // 사주를 못 찾은 건은 paid로 남겨 관리자가 수동 연결한다.
  const finalSaju = qaAnswer
    ?? pick("customAnswer", "answers", "surveyAnswer", "data.customAnswer", "data.answers", "optionAnswer")
    ?? sajuFromIntent;
  const productKey = (contentId && CONTENT_PRODUCT[contentId]) || "myodam";

  const row = {
    buyer_email: buyerEmail,
    buyer_name: buyerName,
    buyer_phone: pick("data.object.buyer.phoneNumber", "buyerPhone", "buyer_phone", "phone", "phoneNumber", "data.buyerPhone", "data.phone", "customer.phone"),
    product_name: pick("data.object.content.title", "contentTitle", "productName", "product_name", "title", "data.contentTitle", "data.productName", "content.title"),
    amount: Number(pick("data.object.pricing.finalAmount", "finalPrice", "amount", "price", "totalPrice", "data.finalPrice", "data.amount", "data.price") ?? 0) || null,
    // 그로블 질문 답변이 있으면 우선, 없으면 pay_intent의 사주로 채운다 (질문 제거 후에도 결과지 연결 유지)
    saju_answer: finalSaju,
    groble_content_id: contentId,
    groble_purchase_id: pick("data.object.merchantUid", "purchaseId", "purchase_id", "orderId", "merchantUid", "data.purchaseId", "data.orderId", "data.merchantUid"),
    // 매핑에 없는 ID는 묘담으로 폴백 (contentId 추출 실패 시에도 기존 구매 흐름이 끊기지 않도록)
    product: productKey,
    site_email: siteEmail,
    status: productKey === "myodam" && finalSaju ? "delivered" : "paid",
    payload: body,
  };

  const res = await fetch(`${url}/rest/v1/purchases`, {
    method: "POST",
    headers: { ...svcHeaders, Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("insert failed", res.status, err);
    return new Response(JSON.stringify({ ok: false }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
});
