// ════════════════════════════════════════════════════════════════════════════
//  주문번호로 서고 열기 — 결제한 기기·브라우저를 잃어버린 구매자의 최후 복구 경로.
//
//  POST { email, order }
//   → order = 그로블 주문번호(merchantUid, 예 2026091800332621925)
//   → 그 주문의 구매자 이메일과 입력 이메일이 일치할 때만 연다
//   → 계정을 보장하고 메일 없이 1회용 토큰(hashed_token)을 돌려준다
//   → 클라이언트가 supabase.auth.verifyOtp({ token_hash, type:'magiclink' })
//
//  왜 안전한가: 주문번호(19자리)와 결제 이메일을 동시에 아는 것은 구매 당사자뿐이다.
//  (claim-session 의 sid 와 같은 급의 증거. 둘 중 하나만으로는 열리지 않는다)
//
//  ※ 이 함수는 대시보드에서도 그대로 붙여 넣어 배포할 수 있도록 _shared 를 쓰지 않고
//    계정 보장/토큰 생성 헬퍼를 안에 둔다. (_shared/auth.ts 와 동작이 같아야 한다)
//
//  응답 error:
//   bad_params   입력이 비었거나 형식이 아님
//   not_found    주문번호가 없거나 이메일이 다름 (구분하지 않는다 — 존재 여부 노출 방지)
//   refunded     환불된 주문
//   token        토큰 생성 실패
// ════════════════════════════════════════════════════════════════════════════

const ORDER_RE = /^[A-Za-z0-9\-_]{8,64}$/;

type AuthHeaders = { apikey: string; Authorization: string };

/** 매직링크 토큰 생성 — 메일을 보내지 않고 hashed_token 만 돌려준다. */
async function generateMagic(url: string, H: AuthHeaders, email: string) {
  const r = await fetch(`${url}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: email.trim().toLowerCase() }),
  });
  if (!r.ok) { console.error("generate_link failed", r.status, await r.text()); return null; }
  const j = await r.json();
  return {
    userId: j?.user?.id ?? j?.id ?? null,
    tokenHash: j?.hashed_token ?? j?.properties?.hashed_token ?? null,
  };
}

/** 이메일로 사용자를 보장한다 (없으면 생성, 이메일 인증 완료 상태). */
async function ensureAuthUser(url: string, H: AuthHeaders, email: string): Promise<string | null> {
  const em = email.trim().toLowerCase();
  if (!/.+@.+\..+/.test(em)) return null;
  const c = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ email: em, email_confirm: true, user_metadata: { via: "groble" } }),
  });
  if (c.ok) { const u = await c.json(); return u?.id ?? null; }
  const g = await generateMagic(url, H, em);
  return g?.userId ?? null;
}

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
  const H = { apikey: service, Authorization: `Bearer ${service}` };

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_e) { /* ignore */ }

  const email = String(body.email || "").trim().toLowerCase();
  // 사람이 옮겨 적으면 공백·하이픈이 섞인다 — 숫자/영문만 남긴다
  const order = String(body.order || "").replace(/[\s\-_.]/g, "");

  if (!/.+@.+\..+/.test(email) || !ORDER_RE.test(order)) return json({ ok: false, error: "bad_params" }, 400);

  const r = await fetch(
    `${url}/rest/v1/purchases?groble_purchase_id=eq.${encodeURIComponent(order)}` +
    `&select=id,product,status,buyer_email,site_email,user_id&limit=1`,
    { headers: H },
  );
  if (!r.ok) return json({ ok: false, error: "db" }, 500);
  const rows = await r.json();
  const p = Array.isArray(rows) && rows[0];
  if (!p) return json({ ok: false, error: "not_found" }, 404);

  const buyer = String(p.buyer_email || "").toLowerCase();
  const site = String(p.site_email || "").toLowerCase();
  if (email !== buyer && email !== site) return json({ ok: false, error: "not_found" }, 404);
  if (p.status === "refunded") return json({ ok: false, error: "refunded" }, 409);

  // 로그인은 결제 이메일 계정으로 연다 (서고 조회가 buyer_email 기준으로도 열리도록)
  const loginEmail = buyer || email;
  const uid = await ensureAuthUser(url, H, loginEmail);
  if (uid && !p.user_id) {
    await fetch(`${url}/rest/v1/purchases?id=eq.${p.id}`, {
      method: "PATCH",
      headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: uid }),
    }).catch(() => {});
  }

  const g = await generateMagic(url, H, loginEmail);
  if (!g?.tokenHash) return json({ ok: false, error: "token" }, 500);

  return json({
    ok: true,
    token_hash: g.tokenHash,
    email: loginEmail,
    purchase: { id: p.id, product: p.product, status: p.status },
  });
});
