// ════════════════════════════════════════════════════════════════════════════
//  체험권 사용 — 블로거 등 체험 계정이 결제 없이 결과지를 받는다.
//
//  POST { product, name, y, m, d, g, path? }  + Authorization: Bearer <사용자 세션 토큰>
//   → 로그인 이메일의 trial_credits 를 원자적으로 1 차감 (남은 횟수 없으면 403)
//   → 0원 정식 구매 행(status=delivered, tier=all)을 만든다
//   → { ok, id } — 클라이언트는 결과지로 ?p=<id> 점프 (report-access 가 평소처럼 검증)
//
//  설계 원칙: 새 열람 경로를 만들지 않는다. 체험권도 "구매 행"이 되므로
//  서고 목록·결과지 접근·재열람이 전부 기존 검증된 파이프라인을 그대로 탄다.
// ════════════════════════════════════════════════════════════════════════════

const PRODUCT_NAMES: Record<string, string> = {
  myodam: "무녀 묘담 · 운명 사용설명서 (체험권)",
  hyunwol: "스님 현월 · 재물의 경 (체험권)",
  hongdan: "별당 아씨 홍단 · 붉은 실의 기록 (체험권)",
};

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

  // ── 로그인 확인 — 체험권은 계정에 매인다 ────────────────────────────────
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "login_required" }, 401);
  const uRes = await fetch(`${url}/auth/v1/user`, { headers: { apikey: service, Authorization: `Bearer ${token}` } });
  if (!uRes.ok) return json({ ok: false, error: "login_required" }, 401);
  const u = await uRes.json();
  const email = String(u.email || "").toLowerCase();
  const uid = String(u.id || "");
  if (!email || !uid) return json({ ok: false, error: "login_required" }, 401);

  // ── 입력 검증 — 결과지가 그대로 그리는 값이므로 여기서 거른다 ──────────
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_e) { /* ignore */ }
  const product = String(body.product || "");
  if (!Object.prototype.hasOwnProperty.call(PRODUCT_NAMES, product)) return json({ ok: false, error: "bad_product" }, 400);
  // 이름: 사주 문자열("이름 / 1995.03.14 / 여")의 구분자와 충돌하는 문자는 제거
  const name = String(body.name || "").replace(/[\/,]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  if (name.length < 1) return json({ ok: false, error: "bad_name" }, 400);
  const y = Number(body.y), m = Number(body.m), d = Number(body.d);
  if (!Number.isInteger(y) || y < 1900 || y > 2020) return json({ ok: false, error: "bad_birth" }, 400);
  if (!Number.isInteger(m) || m < 1 || m > 12) return json({ ok: false, error: "bad_birth" }, 400);
  if (!Number.isInteger(d) || d < 1 || d > 31) return json({ ok: false, error: "bad_birth" }, 400);
  const g = String(body.g || "");
  if (g !== "남" && g !== "여") return json({ ok: false, error: "bad_gender" }, 400);
  let path: string | null = null;
  if (product === "hongdan") {
    path = String(body.path || "");
    if (path !== "jae" && path !== "yeon") return json({ ok: false, error: "bad_path" }, 400);
  }

  // ── 체험권 원자적 차감 — 동시 클릭이 와도 초과 사용 불가 ────────────────
  const c = await fetch(`${url}/rest/v1/rpc/consume_trial_credit`, {
    method: "POST",
    headers: { ...S, "Content-Type": "application/json" },
    body: JSON.stringify({ p_email: email }),
  });
  if (!c.ok) { console.error("consume rpc failed", c.status, await c.text()); return json({ ok: false, error: "server" }, 500); }
  const consumed = await c.json();
  if (!Array.isArray(consumed) || consumed.length === 0) return json({ ok: false, error: "no_credit" }, 403);
  const remaining = Number(consumed[0]?.remaining ?? 0);

  // ── 0원 정식 구매 행 생성 — 이후는 전부 기존 파이프라인 ─────────────────
  const pad = (n: number) => String(n).padStart(2, "0");
  const row = {
    groble_purchase_id: `TRIAL-${crypto.randomUUID()}`,
    event_type: "trial.redeem",
    user_id: uid,
    site_email: email,
    buyer_email: email,
    product,
    product_name: PRODUCT_NAMES[product],
    content_title: PRODUCT_NAMES[product],
    amount: 0,
    saju_answer: `${name} / ${y}.${pad(m)}.${pad(d)} / ${g}`,
    tier: "all",
    picks: null,
    path,
    purchased_at: new Date().toISOString(),
    status: "delivered",
    updated_at: new Date().toISOString(),
  };
  const r = await fetch(`${url}/rest/v1/purchases`, {
    method: "POST",
    headers: { ...S, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    console.error("trial purchase insert failed", r.status, await r.text());
    // 실패 시 차감 되돌림 — 열람 못 받았는데 횟수만 깎이는 일 방지
    try {
      await fetch(`${url}/rest/v1/rpc/refund_trial_credit`, {
        method: "POST",
        headers: { ...S, "Content-Type": "application/json" },
        body: JSON.stringify({ p_email: email }),
      });
    } catch (e) { console.error("refund failed", String(e)); }
    return json({ ok: false, error: "server" }, 500);
  }
  const rows = await r.json();
  const id = Array.isArray(rows) && rows[0] ? rows[0].id : null;
  if (!id) return json({ ok: false, error: "server" }, 500);
  return json({ ok: true, id, remaining });
});
