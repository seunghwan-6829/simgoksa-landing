// ════════════════════════════════════════════════════════════════════════════
//  결과지 열람 권한 — 서버가 구매를 확인하고 결과지 입력값(이름·생년월일·성별·등급·고른 대목)을 돌려준다.
//
//  POST { id: <purchases.id> }  + Authorization: Bearer <사용자 세션 토큰>
//   → 로그인 사용자가 그 주문의 주인인지(user_id / buyer_email / site_email) 확인
//   → status 가 delivered 인지 확인
//   → { ok, product, name, y, m, d, g, tier, picks, hv, yr }
//
//  결과지 페이지는 URL 의 이름·생일을 믿지 않고 이 응답만으로 책을 만든다.
//  (관리자 계정은 admin-api 와 같은 목록으로 어떤 주문이든 열 수 있다)
// ════════════════════════════════════════════════════════════════════════════
const ADMIN_EMAILS = ["motiol_6829@naver.com"];
const HASH_V2_SINCE = Date.parse("2026-08-23T07:55:00Z");   // /assets/sgs-config.js 와 동일

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Content-Type": "application/json",
  };
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const S = { apikey: service, Authorization: `Bearer ${service}` };

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "login_required" }, 401);
  const uRes = await fetch(`${url}/auth/v1/user`, { headers: { apikey: service, Authorization: `Bearer ${token}` } });
  if (!uRes.ok) return json({ ok: false, error: "login_required" }, 401);
  const u = await uRes.json();
  const email = String(u.email || "").toLowerCase();
  const uid = String(u.id || "");
  const isAdmin = ADMIN_EMAILS.includes(email);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_e) { /* ignore */ }
  const id = String(body.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: false, error: "bad_id" }, 400);

  const r = await fetch(
    `${url}/rest/v1/purchases?id=eq.${id}&select=id,created_at,product,status,user_id,buyer_email,site_email,saju_answer,tier,picks&limit=1`,
    { headers: S },
  );
  if (!r.ok) return json({ ok: false, error: "db" }, 500);
  const rows = await r.json();
  const p = Array.isArray(rows) && rows[0];
  if (!p) return json({ ok: false, error: "not_found" }, 404);

  const owner = isAdmin ||
    (p.user_id && p.user_id === uid) ||
    (p.buyer_email && String(p.buyer_email).toLowerCase() === email) ||
    (p.site_email && String(p.site_email).toLowerCase() === email);
  if (!owner) return json({ ok: false, error: "forbidden" }, 403);
  if (p.status !== "delivered" && !isAdmin) return json({ ok: false, error: "not_delivered", status: p.status }, 409);

  // "이름 / 1995.03.14 / 여" — 서고와 같은 규칙으로 푼다
  const m = String(p.saju_answer || "").match(/([^\/,]+)[\/,]\s*(\d{4})[.\-년\s]*(\d{1,2})[.\-월\s]*(\d{1,2})[일\s]*[\/,]\s*(남|여)/);
  if (!m) return json({ ok: false, error: "no_saju" }, 409);

  const createdMs = Date.parse(p.created_at);
  return json({
    ok: true,
    id: p.id,
    product: p.product,
    name: m[1].trim().slice(0, 40),
    y: Number(m[2]), m: Number(m[3]), d: Number(m[4]), g: m[5],
    tier: p.tier || "all",
    picks: p.tier && p.tier !== "all" ? (p.picks || null) : null,
    hv: Number.isFinite(createdMs) && createdMs < HASH_V2_SINCE ? 1 : 2,   // 구형 해시 호환
    yr: Number.isFinite(createdMs) ? new Date(createdMs).getFullYear() : new Date().getFullYear(),   // 결과지의 "올해" 고정
  });
});
