// ════════════════════════════════════════════════════════════════════════════
//  Meta 전환 API(CAPI) 공용 모듈
//
//  [왜 서버에서 쏘는가]
//  결제가 groble.im(외부 도메인)에서 끝난다. 브라우저 픽셀은 남의 도메인을 따라갈 수
//  없으므로 Purchase 를 영원히 못 잡는다. 서버가 결제 사실을 아는 유일한 통로가
//  그로블 웹훅이라, 주문 기록 직후 여기서 CAPI 로 보낸다.
//
//  [토큰이 없으면]
//  조용히 건너뛰고 capi_events 에 사유만 남긴다. 절대 예외를 던지지 않는다 —
//  CAPI 실패가 결제 기록을 망치면 안 된다.
//
//  [환경변수]
//    META_PIXEL_ID          필수. 데이터 세트 ID (공개값)
//    META_CAPI_TOKEN        필수. 전환 API 액세스 토큰 (비밀값 — 시스템 사용자로 발급 권장)
//    META_TEST_EVENT_CODE   선택. 있으면 「테스트 이벤트」 탭에 보인다
//                           ⚠️ 검증 끝나면 반드시 제거하고 재배포할 것.
//                              붙어있는 동안 Purchase 가 실집계에서 빠진다.
//    META_GRAPH_VERSION     선택. 기본 v23.0 (그래프 API 버전 만료 대비용 탈출구)
// ════════════════════════════════════════════════════════════════════════════

const encoder = new TextEncoder();

// ─────────────────────────────────────────────────────────────────────────────
//  정규화 + 해싱
//  식별정보는 반드시 정규화 후 SHA-256 해시해서 보낸다. 원문 전송 금지.
// ─────────────────────────────────────────────────────────────────────────────
async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 이메일: 공백 제거 → 소문자 */
export async function hashEmail(v: string | null): Promise<string | null> {
  if (!v) return null;
  const norm = v.trim().toLowerCase();
  return norm.includes("@") ? await sha256(norm) : null;
}

/**
 * 전화: 숫자만 남기고 E.164.
 * 한국 번호는 선행 0 을 떼고 82 를 붙인다 (01012345678 → 821012345678).
 * 이미 82 로 시작하거나 +가 붙어 있으면 그대로 둔다.
 */
export async function hashPhone(v: string | null): Promise<string | null> {
  if (!v) return null;
  let d = v.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("0")) d = "82" + d.slice(1);        // 010… → 8210…
  else if (!d.startsWith("82") && d.length <= 11) d = "82" + d;
  if (d.length < 10 || d.length > 15) return null;      // E.164 범위 밖이면 안 보낸다
  return await sha256(d);
}

/**
 * 이름: 공백 제거 → 소문자.
 * 한국 이름은 성/이름 분리가 불확실하므로 fn 하나로만 보낸다.
 * (성을 잘못 자르면 매칭이 오히려 나빠진다 — 남궁·선우 같은 복성 때문)
 */
export async function hashName(v: string | null): Promise<string | null> {
  if (!v) return null;
  const norm = v.replace(/\s+/g, "").toLowerCase();
  return norm ? await sha256(norm) : null;
}

/** 내부 식별자(Supabase auth uid 등) */
export async function hashExternalId(v: string | null): Promise<string | null> {
  if (!v) return null;
  const norm = v.trim().toLowerCase();
  return norm ? await sha256(norm) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  event_id 생성 — 브라우저 픽셀과 서버가 같은 값을 써야 메타가 중복제거한다.
//  Purchase 는 merchantUid 를 그대로 쓴다(브라우저의 /library/ 발화와 동일).
//  다른 이벤트를 나중에 이중 전송하게 되면 이 헬퍼로 만든 값을 양쪽이 공유하면 된다.
// ─────────────────────────────────────────────────────────────────────────────
export function metaEventId(kind: string, key: string): string {
  return `${kind}.${key}`;
}

// ─────────────────────────────────────────────────────────────────────────────
export type MetaUserData = {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  externalId?: string | null;
  fbp?: string | null;          // 해시하지 않는다 — 원문 그대로
  fbc?: string | null;          // 해시하지 않는다 — 원문 그대로
  clientIp?: string | null;
  clientUserAgent?: string | null;
};

export type MetaEventInput = {
  eventName: string;            // 'Purchase' 등
  eventId: string;              // 중복제거 키 (Purchase = merchantUid)
  eventTime?: number;           // unix seconds. 없으면 현재
  eventSourceUrl?: string | null;
  value?: number | null;
  currency?: string | null;
  contentId?: string | null;
  contentName?: string | null;
  user: MetaUserData;
};

export type MetaSendResult = {
  configured: boolean;          // 토큰·픽셀ID 가 설정돼 있었는가
  ok: boolean;
  status: number | null;
  matched: number | null;       // events_received
  fbtrace: string | null;
  note: string;                 // ⚠️ 해시값·원문 금지. 키 종류와 오류 원문만.
  payloadMeta: Record<string, unknown>;
};

// ─────────────────────────────────────────────────────────────────────────────
//  전송
//  절대 throw 하지 않는다. 호출부는 결과를 로그에만 쓰고 처리 흐름을 바꾸지 않는다.
// ─────────────────────────────────────────────────────────────────────────────
export async function sendMetaEvent(input: MetaEventInput): Promise<MetaSendResult> {
  const pixelId = Deno.env.get("META_PIXEL_ID");
  const token = Deno.env.get("META_CAPI_TOKEN");
  const testCode = Deno.env.get("META_TEST_EVENT_CODE") || null;
  const version = Deno.env.get("META_GRAPH_VERSION") || "v23.0";

  const base: MetaSendResult = {
    configured: false,
    ok: false,
    status: null,
    matched: null,
    fbtrace: null,
    note: "",
    payloadMeta: {},
  };

  try {
    const u = input.user;
    const [em, ph, fn, externalId] = await Promise.all([
      hashEmail(u.email ?? null),
      hashPhone(u.phone ?? null),
      hashName(u.name ?? null),
      hashExternalId(u.externalId ?? null),
    ]);

    // Meta 는 해시 필드를 배열로 받는 것을 권장한다.
    const userData: Record<string, unknown> = {};
    const matchKeys: string[] = [];
    if (em) { userData.em = [em]; matchKeys.push("em"); }
    if (ph) { userData.ph = [ph]; matchKeys.push("ph"); }
    if (fn) { userData.fn = [fn]; matchKeys.push("fn"); }
    if (externalId) { userData.external_id = [externalId]; matchKeys.push("external_id"); }
    // fbp / fbc 는 해시하지 않는다
    if (u.fbp) { userData.fbp = u.fbp; matchKeys.push("fbp"); }
    if (u.fbc) { userData.fbc = u.fbc; matchKeys.push("fbc"); }
    if (u.clientIp) { userData.client_ip_address = u.clientIp; matchKeys.push("ip"); }
    if (u.clientUserAgent) { userData.client_user_agent = u.clientUserAgent; matchKeys.push("ua"); }

    const customData: Record<string, unknown> = {};
    if (input.value != null) customData.value = input.value;
    if (input.currency) customData.currency = input.currency;
    if (input.contentId) {
      customData.content_ids = [input.contentId];
      customData.content_type = "product";
    }
    if (input.contentName) customData.content_name = input.contentName;

    const event: Record<string, unknown> = {
      event_name: input.eventName,
      event_time: input.eventTime ?? Math.floor(Date.now() / 1000),
      event_id: input.eventId,
      action_source: "website",
      user_data: userData,
    };
    if (input.eventSourceUrl) event.event_source_url = input.eventSourceUrl;
    if (Object.keys(customData).length) event.custom_data = customData;

    const body: Record<string, unknown> = { data: [event] };
    if (testCode) body.test_event_code = testCode;

    const payloadMeta = {
      match_keys: matchKeys,
      has_fbp: !!u.fbp,
      has_fbc: !!u.fbc,
      test_mode: !!testCode,
      content_id: input.contentId ?? null,
      graph_version: version,
    };

    // ── 설정 확인은 여기서 한다 (매칭키를 다 만든 뒤) ───────────────────────
    //  토큰이 아직 없어도 payload_meta 는 채워서 남긴다.
    //  그래야 토큰이 오기 전에도 "fbp/fbc 가 제대로 실리고 있는가"를 검증할 수 있다.
    //  (여기서 조기 반환해버리면 매칭 경로가 깨져 있어도 토큰 붙이는 날까지 모른다)
    if (!pixelId || !token) {
      const missing = [!pixelId ? "META_PIXEL_ID" : null, !token ? "META_CAPI_TOKEN" : null]
        .filter(Boolean).join(", ");
      return { ...base, note: `not configured: ${missing}`, payloadMeta };
    }

    const res = await fetch(
      `https://graph.facebook.com/${version}/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );

    const text = await res.text();
    let parsed: Record<string, any> = {};
    try { parsed = JSON.parse(text); } catch (_e) { /* 비-JSON 응답 */ }

    const matched = typeof parsed.events_received === "number" ? parsed.events_received : null;
    const fbtrace = parsed.fbtrace_id ?? parsed?.error?.fbtrace_id ?? null;

    if (!res.ok) {
      // 오류 원문은 남긴다 (여기에는 해시도 원문 식별정보도 들어가지 않는다)
      const msg = parsed?.error?.message ?? text.slice(0, 500);
      return {
        configured: true, ok: false, status: res.status, matched, fbtrace,
        note: `error: ${msg}`, payloadMeta,
      };
    }

    return {
      configured: true,
      ok: true,
      status: res.status,
      matched,
      fbtrace,
      note: `sent with [${matchKeys.join(", ")}]`,   // 키 "종류"만. 값은 절대 남기지 않는다.
      payloadMeta,
    };
  } catch (e) {
    return { ...base, configured: true, note: `threw: ${String(e).slice(0, 300)}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  전송 로그 기록 — capi_events
//  로그 실패가 호출부 흐름을 바꾸면 안 되므로 여기서도 throw 하지 않는다.
// ─────────────────────────────────────────────────────────────────────────────
export async function logCapiEvent(
  supaUrl: string,
  serviceKey: string,
  row: {
    event_name: string;
    event_id: string;
    value?: number | null;
    currency?: string | null;
    result: MetaSendResult;
  },
): Promise<void> {
  try {
    await fetch(`${supaUrl}/rest/v1/capi_events`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        event_name: row.event_name,
        event_id: row.event_id,
        ok: row.result.ok,
        status: row.result.status,
        matched: row.result.matched,
        value: row.value ?? null,
        currency: row.currency ?? null,
        fbtrace: row.result.fbtrace,
        note: row.result.note,
        payload_meta: row.result.payloadMeta,
      }),
    });
  } catch (e) {
    console.error("capi_events log failed", String(e));
  }
}
