// ════════════════════════════════════════════════════════════════════════════
//  결제 직후 서고 자동 입장 — 회원가입 없이 산 사람을 같은 기기에서 바로 로그인시킨다.
//
//  POST { sid: <랜딩이 결제 직전 localStorage 에 남긴 session_id>, probe?: true }
//   → 그 sid 가 sellerReference 로 붙은 최근(30일) 주문을 찾는다 — 인앱 브라우저에서 며칠 뒤 다시 열어도 자동 입장
//   → sellerReference 가 유실된 경우엔, 같은 sid 의 리드에 남은 이메일/계정으로 최근 주문을 찾는다(2차)
//   → probe:true 면 "결제가 확인되는지"만 답한다 (토큰을 만들지 않는다 — 랜딩의 재결제 방지 배너용)
//   → 아니면 주문의 구매자 이메일로 계정을 보장하고, 메일 없이 1회용 토큰(hashed_token)을 만든다
//   → { ok, token_hash, email }  — 클라이언트는 supabase.auth.verifyOtp({ token_hash, type:'magiclink' })
//   → 주문이 아직 안 들어왔으면 { ok:false, error:'pending' } (서고가 잠시 뒤 다시 묻는다)
//
//  sid 는 결제한 브라우저만 아는 무작위 UUID 라, 이것을 아는 쪽 = 결제한 기기다.
// ════════════════════════════════════════════════════════════════════════════
import { ensureAuthUser, generateMagic } from "../_shared/auth.ts";

type Row = Record<string, string | null>;

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
  const probe = body.probe === true;
  if (!/^[0-9a-f-]{36}$/i.test(sid)) return json({ ok: false, error: "bad_sid" }, 400);

  const since = new Date(Date.now() - 30 * 24 * 3600e3).toISOString();
  const sel = "id,buyer_email,site_email,user_id,status,product,created_at";

  // ① 정상 경로 — 결제창에 실어 보낸 ?ref=<sid> 가 sellerReference 로 돌아온 주문
  let p: Row | null = null;
  const r = await fetch(
    `${url}/rest/v1/purchases?seller_reference=eq.${encodeURIComponent(sid)}&created_at=gte.${since}&select=${sel}&order=created_at.desc&limit=1`,
    { headers: H },
  );
  if (!r.ok) return json({ ok: false, error: "db" }, 500);
  const rows = await r.json();
  if (Array.isArray(rows) && rows[0]) p = rows[0];

  // ※ ref 가 유실된 주문은 여기서 열지 않는다.
  //    leads 는 anon INSERT 가 열린 표라, 리드의 이메일로 되찾는 폴백을 두면
  //    남의 이메일을 적은 가짜 리드로 타인 계정의 토큰을 받아갈 수 있다(계정 탈취).
  //    그 경우의 복구는 order-unlock (결제 이메일 + 주문번호) 이 맡는다.
  if (!p) return json({ ok: false, error: "pending" });           // 웹훅이 아직 — 잠시 뒤 재시도
  if (p.status === "refunded") return json({ ok: false, error: "refunded" });

  const purchase = { id: p.id, product: p.product, status: p.status };
  // 랜딩의 "이미 결제했다" 확인용 — 토큰을 만들지 않는다(쓰지도 않을 1회용 토큰 낭비 방지)
  if (probe) return json({ ok: true, probe: true, purchase });

  const email = String(p.buyer_email || p.site_email || "").toLowerCase();
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
  return json({ ok: true, token_hash: g.tokenHash, email, purchase });
});
