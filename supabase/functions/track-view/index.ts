// 보고서 열람/다운로드 기록 — 요청 IP를 서버에서 캡처
Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Content-Type": "application/json",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false }), { status: 405, headers: cors });

  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch (_e) { /* ignore */ }

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || req.headers.get("cf-connecting-ip") || null;

  const row = {
    event: b.event === "download" ? "download" : "view",
    name: typeof b.name === "string" ? b.name.slice(0, 40) : null,
    birth: typeof b.birth === "string" ? b.birth.slice(0, 12) : null,
    gender: typeof b.gender === "string" ? b.gender.slice(0, 4) : null,
    product: typeof b.product === "string" ? b.product.slice(0, 30) : "myodam",
    is_demo: !!b.is_demo,
    ip,
    user_agent: (req.headers.get("user-agent") || "").slice(0, 250),
    referer: (req.headers.get("referer") || "").slice(0, 250),
  };

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${url}/rest/v1/report_views`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  return new Response(JSON.stringify({ ok: res.ok }), { status: res.ok ? 200 : 500, headers: cors });
});
