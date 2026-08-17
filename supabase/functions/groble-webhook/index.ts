// 그로블 결제 완료 웹훅 수신 → purchases 테이블 기록
// 형식 변동에 대비해 원본 payload를 통째로 저장하고, 주요 필드는 best-effort로 추출한다.
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

  // 그로블 상품 ID → 캐릭터 매핑. 새 캐릭터(현월·홍단 등) 출시 시 여기에 한 줄씩 추가한다.
  const CONTENT_PRODUCT: Record<string, string> = {
    "kAAJFx": "myodam",
  };
  const contentId = pick("contentId", "content_id", "data.contentId", "content.id");

  const row = {
    buyer_email: pick("buyerEmail", "buyer_email", "email", "purchaserEmail", "data.buyerEmail", "data.email", "user.email", "customer.email"),
    buyer_name: pick("buyerName", "buyer_name", "name", "purchaserName", "data.buyerName", "data.name", "customer.name"),
    buyer_phone: pick("buyerPhone", "buyer_phone", "phone", "phoneNumber", "data.buyerPhone", "data.phone", "customer.phone"),
    product_name: pick("contentTitle", "productName", "product_name", "title", "data.contentTitle", "data.productName", "content.title"),
    amount: Number(pick("finalPrice", "amount", "price", "totalPrice", "data.finalPrice", "data.amount", "data.price") ?? 0) || null,
    saju_answer: pick("customAnswer", "answers", "surveyAnswer", "data.customAnswer", "data.answers", "optionAnswer"),
    groble_content_id: contentId,
    groble_purchase_id: pick("purchaseId", "purchase_id", "orderId", "merchantUid", "data.purchaseId", "data.orderId", "data.merchantUid"),
    // 매핑에 없는 ID는 묘담으로 폴백 (contentId 추출 실패 시에도 기존 구매 흐름이 끊기지 않도록)
    product: (contentId && CONTENT_PRODUCT[contentId]) || "myodam",
    status: "paid",
    payload: body,
  };

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${url}/rest/v1/purchases`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("insert failed", res.status, err);
    return new Response(JSON.stringify({ ok: false }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
});
