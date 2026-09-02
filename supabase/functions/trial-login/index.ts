// ════════════════════════════════════════════════════════════════════════════
//  체험 초대 링크 로그인 — /library/?iv=<invite_token>
//
//  POST { iv }  →  trial_credits 에서 토큰으로 계정을 찾고,
//  매번 새 매직링크 열쇠(hashed_token)를 만들어 돌려준다.
//  → 초대 링크 자체는 영구 재사용: 누를 때마다 새 열쇠가 나오므로
//    "한 번 쓰면 낡는" 문제가 없다. 어드민이 체험권을 회수(행 삭제)하면 죽는다.
//  (claim-session 과 같은 원리 — sid 대신 invite_token 을 증표로 쓴다)
// ════════════════════════════════════════════════════════════════════════════
import { ensureAuthUser, generateMagic } from "../_shared/auth.ts";

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

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_e) { /* ignore */ }
  const iv = String(body.iv || "");
  if (!/^[0-9a-f]{64}$/.test(iv)) return json({ ok: false, error: "bad_token" }, 400);

  const r = await fetch(
    `${url}/rest/v1/trial_credits?invite_token=eq.${encodeURIComponent(iv)}&select=email&limit=1`,
    { headers: S },
  );
  if (!r.ok) return json({ ok: false, error: "server" }, 500);
  const rows = await r.json();
  const row = Array.isArray(rows) && rows[0];
  if (!row || !row.email) return json({ ok: false, error: "not_found" }, 404);

  // 계정 보장 후 새 열쇠 발급 — 링크는 재사용, 열쇠는 매번 새것
  const uid = await ensureAuthUser(url, S, String(row.email));
  if (!uid) return json({ ok: false, error: "server" }, 500);
  const g = await generateMagic(url, S, String(row.email));
  if (!g || !g.tokenHash) return json({ ok: false, error: "server" }, 500);
  return json({ ok: true, token_hash: g.tokenHash });
});
