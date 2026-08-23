// 어드민 API — 지정된 관리자 계정(Supabase Auth) 토큰으로만 접근
const ADMIN_EMAILS = ["motiol_6829@naver.com"];

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Content-Type": "application/json",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method" }), { status: 405, headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1) 관리자 검증: 사용자 액세스 토큰 → auth/user 조회 → 이메일 확인
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return new Response(JSON.stringify({ error: "no token" }), { status: 401, headers: cors });
  const uRes = await fetch(`${url}/auth/v1/user`, { headers: { apikey: service, Authorization: `Bearer ${token}` } });
  if (!uRes.ok) return new Response(JSON.stringify({ error: "bad token" }), { status: 401, headers: cors });
  const u = await uRes.json();
  const email = (u.email || "").toLowerCase();
  if (!ADMIN_EMAILS.includes(email)) return new Response(JSON.stringify({ error: "not admin" }), { status: 403, headers: cors });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_e) { /* ignore */ }
  const action = body.action;
  const S = { apikey: service, Authorization: `Bearer ${service}` };
  const j = (r: Response) => r.json();

  try {
    if (action === "stats") {
      const since = new Date(Date.now() - 7 * 86400e3).toISOString();
      const [leads, orders, views] = await Promise.all([
        fetch(`${url}/rest/v1/leads?select=id,created_at,event&created_at=gte.${since}&limit=5000`, { headers: S }).then(j),
        fetch(`${url}/rest/v1/purchases?select=id,created_at,amount,status&limit=5000`, { headers: S }).then(j),
        fetch(`${url}/rest/v1/report_views?select=id,created_at,event,is_demo&created_at=gte.${since}&limit=5000`, { headers: S }).then(j),
      ]);
      const totalLeads = await fetch(`${url}/rest/v1/leads?select=id&limit=1`, { headers: { ...S, Prefer: "count=exact" } })
        .then(r => Number((r.headers.get("content-range") || "0/0").split("/")[1]) || 0);
      return new Response(JSON.stringify({ leads, orders, views, totalLeads }), { headers: cors });
    }

    if (action === "inputs") {
      // 인적사항 입력 완료 리드 목록 (+같은 세션의 결제클릭 여부 판별용 pay_click 포함)
      const rows = await fetch(
        `${url}/rest/v1/leads?select=created_at,event,session_id,name,birth,gender,product,sals,tier,picks&event=in.(input_complete,pay_click)&order=created_at.desc&limit=500`,
        { headers: S },
      ).then(j);
      return new Response(JSON.stringify({ inputs: rows }), { headers: cors });
    }

    if (action === "orders") {
      const rows = await fetch(`${url}/rest/v1/purchases?select=*&order=created_at.desc&limit=300`, { headers: S }).then(j);
      return new Response(JSON.stringify({ rows }), { headers: cors });
    }

    if (action === "views_for") {
      // 특정 이름·생년월일의 열람 기록 (IP 포함)
      const name = encodeURIComponent(String(body.name || ""));
      const rows = await fetch(`${url}/rest/v1/report_views?select=*&name=eq.${name}&order=created_at.desc&limit=200`, { headers: S }).then(j);
      return new Response(JSON.stringify({ rows }), { headers: cors });
    }

    if (action === "members") {
      const ures = await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers: S }).then(j);
      const users = (ures.users || []).map((x: any) => ({ id: x.id, email: x.email, created_at: x.created_at, last_sign_in_at: x.last_sign_in_at }));
      const purchases = await fetch(`${url}/rest/v1/purchases?select=buyer_email,amount,status,created_at,saju_answer`, { headers: S }).then(j);
      return new Response(JSON.stringify({ users, purchases }), { headers: cors });
    }

    if (action === "set_status") {
      const id = String(body.id || "");
      const status = String(body.status || "");
      if (!id || !["paid", "preparing", "delivered", "refunded"].includes(status))
        return new Response(JSON.stringify({ error: "bad params" }), { status: 400, headers: cors });
      const r = await fetch(`${url}/rest/v1/purchases?id=eq.${id}`, {
        method: "PATCH",
        headers: { ...S, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ status }),
      });
      return new Response(JSON.stringify({ ok: r.ok }), { status: r.ok ? 200 : 500, headers: cors });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), { status: 400, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
