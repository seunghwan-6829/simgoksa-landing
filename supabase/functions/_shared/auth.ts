// 결제 이메일로 계정을 자동 생성/조회하고, 이메일 없이 쓰는 1회용 로그인 토큰을 만든다.
// (회원가입 단계를 결제 뒤로 밀기 위한 공용 헬퍼 — groble-webhook / claim-session 이 쓴다)

export type AuthHeaders = { apikey: string; Authorization: string };

/** 이메일로 사용자를 보장한다 (없으면 생성, 이메일 인증 완료 상태). user id 를 돌려준다. */
export async function ensureAuthUser(url: string, H: AuthHeaders, email: string): Promise<string | null> {
  const em = email.trim().toLowerCase();
  if (!/.+@.+\..+/.test(em)) return null;
  // 1) 생성 시도 — 이미 있으면 422
  const c = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ email: em, email_confirm: true, user_metadata: { via: "groble" } }),
  });
  if (c.ok) { const u = await c.json(); return u?.id ?? null; }
  // 2) 이미 있으면 링크 생성 응답에서 id 를 얻는다 (메일은 보내지 않는다)
  const g = await generateMagic(url, H, em);
  return g?.userId ?? null;
}

/** 매직링크 토큰 생성 — 메일을 보내지 않고 hashed_token 만 돌려준다. 클라이언트가 verifyOtp 로 세션을 연다. */
export async function generateMagic(url: string, H: AuthHeaders, email: string): Promise<{ userId: string | null; tokenHash: string | null } | null> {
  const r = await fetch(`${url}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: email.trim().toLowerCase() }),
  });
  if (!r.ok) { console.error("generate_link failed", r.status, await r.text()); return null; }
  const j = await r.json();
  // gotrue: { ..user fields.., hashed_token, action_link, ... } 또는 { properties: { hashed_token }, user: {...} }
  const tokenHash = j?.hashed_token ?? j?.properties?.hashed_token ?? null;
  const userId = j?.user?.id ?? j?.id ?? null;
  return { userId, tokenHash };
}
