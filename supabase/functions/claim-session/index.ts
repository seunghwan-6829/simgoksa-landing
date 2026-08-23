// ════════════════════════════════════════════════════════════════════════════
//  결제 직후 서고 자동 입장 — 회원가입 없이 산 사람을 같은 기기에서 바로 로그인시킨다.
//
//  POST { sid: <랜딩이 결제 직전 localStorage 에 남긴 session_id> }
//   → 그 sid 가 sellerReference 로 붙은 최근(24h) 주문을 찾는다
//   → 주문의 구매자 이메일로 계정을 보장하고, 메일 없이 1회용 토큰(hashed_token)을 만든다
//   → { ok, token_hash, email }  — 클라이언트는 supabase.auth.verifyOtp({ token_hash, type:'magiclink' })
//   → 주문이 아직 안 들어왔으면 { ok:false, error:'pending' } (서고가 잠시 뒤 다시 묻는다)
//
//  sid 는 결제한 브라우저만 아는 무작위 UUID 라, 이것을 아는 쪽 = 결제한 기기다.
// ════════════════════════════════════════════════════════════════════════════
import { ensureAuthUser, generateMagic } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, authorization", "Content-Type": "application/json" };
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const H = { apikey: service, Authorization: `Bearer ${service}` };

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_e) { /* ignore */ }
  const sid = String(body.sid || "");
  if (!/^[0-9a-f-]{36}$/i.test(sid)) return json({ ok: false, error: "bad_sid" }, 400);

  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const r = await fetch(
    `${url}/rest/v1/purchases?seller_reference=eq.${encodeURIComponent(sid)}&created_at=gte.${since}&select=id,buyer_email,user_id,status,product&order=created_at.desc&limit=1`,
    { headers: H },
  );
  if (!r.ok) return json({ ok: false, error: "db" }, 500);
  const rows = await r.json();
  const p = Array.isArray(rows) && rows[0];
  if (!p) return json({ ok: false, error: "pending" });           // 웹훅이 아직 — 잠시 뒤 재시도
  if (p.status === "refunded") return json({ ok: false, error: "refunded" });
  const email = String(p.buyer_email || "").toLowerCase();
  if (!email) return json({ ok: false, error: "no_email" });

  const uid = await ensureAuthUser(url, H, email);
  if (uid && !p.user_id) {
    await fetch(`${url}/rest/v1/purchases?id=eq.${p.id}`, {
      method: "PATCH", headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: uid }),
    }).catch(() => {});
  }
  const g = await generateMagic(url, H, email);
  if (!g?.tokenHash) return json({ ok: false, error: "token" }, 500);
  // 서고가 곧장 그 책을 열 수 있게 주문 id·상품·상태도 돌려준다
  return json({ ok: true, token_hash: g.tokenHash, email, purchase: { id: p.id, product: p.product, status: p.status } });
});
