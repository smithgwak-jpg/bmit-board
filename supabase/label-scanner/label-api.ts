// 상품 라벨 스캐너 API
// 브라우저는 이 함수만 부릅니다. Anthropic API 키와 DB 권한은 서버(이 함수)에만 있습니다.
// 필요한 시크릿: ANTHROPIC_API_KEY. 사용자·권한은 hub_members / hub_groups, 메인 버튼은 hub_links 테이블.
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = Deno.env.get("LABEL_MODEL") || "claude-sonnet-5-5";
const FIELDS = [
  "productName", "brand", "category", "netContent", "manufacturer", "manufacturerAddress",
  "seller", "sellerAddress", "importer", "origin", "phone", "barcode", "expiry", "storage",
  "ingredients", "allergens", "nutrition", "certifications", "reportNo", "notes",
];
const COLS: Record<string, string> = {
  productName: "product_name", brand: "brand", category: "category", netContent: "net_content",
  manufacturer: "manufacturer", manufacturerAddress: "manufacturer_address", seller: "seller",
  sellerAddress: "seller_address", importer: "importer", origin: "origin", phone: "phone",
  barcode: "barcode", expiry: "expiry", storage: "storage", ingredients: "ingredients",
  allergens: "allergens", nutrition: "nutrition", certifications: "certifications",
  reportNo: "report_no", notes: "notes",
};

const PROMPT = `첨부한 사진은 한 상품의 포장 뒷면(또는 앞면) 표시사항입니다. 사진에 실제로 인쇄된 글자만 읽어서 아래 키를 가진 JSON 객체 하나로만 답하세요. 설명이나 코드블록 없이 JSON만 출력합니다.
규칙:
- 값은 모두 문자열. 사진에서 찾을 수 없으면 "" (추측 금지).
- 원문 표기를 그대로 옮기되, 줄바꿈은 공백으로 합칩니다.
- manufacturer: "제조원", "제조사", "제조자", "Manufactured by" 옆의 회사명만. 주소는 manufacturerAddress에.
- seller: "판매원", "유통전문판매원", "판매자"의 회사명. sellerAddress에 그 주소.
- importer: "수입원", "수입판매원", "수입자".
- category: "식품의 유형", "품목", "제품유형" 값.
- nutrition: 영양정보 표를 "열량 200kcal, 나트륨 150mg, ..." 처럼 한 줄로 요약.
- allergens: 알레르기 유발물질 표시 문구.
- barcode: 바코드 아래 숫자.
- confidence: 글자가 흐리거나 잘려서 확실하지 않은 항목 키 이름들을 쉼표로 나열 (없으면 "").
키: ${FIELDS.join(", ")}, confidence`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

function toRow(rec: Record<string, unknown>) {
  const row: Record<string, string> = {};
  for (const k of FIELDS) row[COLS[k]] = String(rec?.[k] ?? "").slice(0, 5000);
  return row;
}
function fromRow(r: Record<string, unknown>) {
  const out: Record<string, unknown> = { id: r.id, createdAt: r.created_at, thumb: r.thumb || "" };
  for (const k of FIELDS) out[k] = r[COLS[k]] ?? "";
  return out;
}

async function scan(images: { media_type: string; data: string }[]) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "server_not_ready", message: "서버에 Anthropic API 키가 아직 없어요." }, 503);
  if (!Array.isArray(images) || !images.length || images.length > 4) return json({ error: "bad_request", message: "사진은 1~4장이어야 해요." }, 400);
  const ok = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  for (const im of images) {
    if (!ok.includes(im?.media_type) || typeof im?.data !== "string" || im.data.length > 7_000_000)
      return json({ error: "bad_request", message: "지원하지 않는 사진이에요." }, 400);
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      messages: [{
        role: "user",
        content: [
          ...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } })),
          { type: "text", text: PROMPT },
        ],
      }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error("anthropic error", res.status, t.slice(0, 500));
    return json({ error: res.status === 429 ? "rate_limited" : "ai_error", message: "AI 판독 서버 오류 (" + res.status + ")" }, 502);
  }
  const out = await res.json();
  const text: string = (out.content || []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  try {
    const data = JSON.parse(text.slice(a, b + 1));
    return json({ data });
  } catch {
    return json({ error: "invalid_json", message: "결과를 정리하지 못했어요." }, 502);
  }
}

// 로그인: Authorization 헤더의 Supabase 세션 토큰으로 사용자를 확인하고 hub_members에서 권한을 찾습니다.
// 버튼 권한 = 그룹의 link_ids + 개인 extra_link_ids. 관리자는 전부. 스캐너는 'scan' 버튼 권한이 있어야 사용.
type Me = { email: string; name: string; isAdmin: boolean; linkIds: string[]; all: boolean; group: string };
async function resolveMe(req: Request): Promise<Me | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: u } = await sb.auth.getUser(token);
  const email = (u?.user?.email || "").toLowerCase();
  if (!email) return null;
  const { data: m } = await sb.from("hub_members").select("*, hub_groups(name, link_ids)").eq("email", email).maybeSingle();
  if (!m) return { email, name: "", isAdmin: false, linkIds: [], all: false, group: "" };
  const g = (m.hub_groups || {}) as { name?: string; link_ids?: string[] };
  const ids = [...new Set([...(g.link_ids || []), ...(m.extra_link_ids || [])])];
  return { email, name: m.name, isAdmin: !!m.is_admin, linkIds: ids, all: !!m.is_admin, group: g.name || "" };
}
const canUse = (me: Me, id: string) => me.all || me.linkIds.includes(id);
const ID_RE = /^[a-z0-9-]{1,40}$/;
const URL_RE = /^(https:\/\/|\/(?!\/)|\.\.\/)/;
const strArr = (v: unknown) => Array.isArray(v) ? v.map(String).filter((x) => ID_RE.test(x)).slice(0, 100) : [];

async function admin(action: string, body: Record<string, unknown>, me: Me) {
  if (action === "admin_load") {
    const [g, m, l] = await Promise.all([
      sb.from("hub_groups").select("*").order("name"),
      sb.from("hub_members").select("*").order("name"),
      sb.from("hub_links").select("*").order("sort"),
    ]);
    if (g.error || m.error || l.error) throw g.error || m.error || l.error;
    return json({ groups: g.data, members: m.data, links: l.data });
  }
  if (action === "group_save") {
    const name = String(body.name || "").trim().slice(0, 60);
    if (!name) return json({ error: "bad_request", message: "그룹 이름을 입력하세요." }, 400);
    const row = { name, link_ids: strArr(body.link_ids) };
    const q = body.id ? sb.from("hub_groups").update(row).eq("id", String(body.id)) : sb.from("hub_groups").insert(row);
    const { error } = await q;
    if (error) return json({ error: "bad_request", message: error.code === "23505" ? "같은 이름의 그룹이 있어요." : "저장하지 못했어요." }, 400);
    return json({ ok: true });
  }
  if (action === "group_delete") {
    const { error } = await sb.from("hub_groups").delete().eq("id", String(body.id));
    if (error) throw error;
    return json({ ok: true });
  }
  if (action === "member_save") {
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "bad_request", message: "이메일 형식이 맞지 않아요." }, 400);
    if (email === me.email && !body.is_admin) return json({ error: "bad_request", message: "내 관리자 권한은 끌 수 없어요." }, 400);
    const row = {
      email, name: String(body.name || "").trim().slice(0, 60),
      group_id: body.group_id ? String(body.group_id) : null,
      extra_link_ids: strArr(body.extra_link_ids), is_admin: !!body.is_admin,
    };
    const { error } = await sb.from("hub_members").upsert(row);
    if (error) throw error;
    return json({ ok: true });
  }
  if (action === "member_delete") {
    const email = String(body.email || "").toLowerCase();
    if (email === me.email) return json({ error: "bad_request", message: "나 자신은 지울 수 없어요." }, 400);
    const { error } = await sb.from("hub_members").delete().eq("email", email);
    if (error) throw error;
    return json({ ok: true });
  }
  if (action === "link_save") {
    const id = String(body.id || "").trim().toLowerCase();
    const url = String(body.url || "").trim();
    const title = String(body.title || "").trim().slice(0, 60);
    if (!ID_RE.test(id)) return json({ error: "bad_request", message: "버튼 ID는 영문 소문자, 숫자, - 만 쓸 수 있어요." }, 400);
    if (!title) return json({ error: "bad_request", message: "버튼 이름을 입력하세요." }, 400);
    if (!URL_RE.test(url)) return json({ error: "bad_request", message: "주소는 https:// 로 시작해야 해요." }, 400);
    const row = { id, title, url: url.slice(0, 1000), icon: String(body.icon || "").slice(0, 8), descr: String(body.descr || "").slice(0, 120), sort: Number(body.sort) || 0 };
    const { error } = await sb.from("hub_links").upsert(row);
    if (error) throw error;
    return json({ ok: true });
  }
  if (action === "link_delete") {
    const id = String(body.id || "");
    if (id === "scan") return json({ error: "bad_request", message: "스캐너 버튼은 지울 수 없어요. 권한에서 빼 주세요." }, 400);
    const { error } = await sb.from("hub_links").delete().eq("id", id);
    if (error) throw error;
    return json({ ok: true });
  }
  return json({ error: "unknown_action" }, 400);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const action = String(body.action || "");

  try {
    const me = await resolveMe(req);
    if (!me) return json({ error: "login_required", message: "로그인이 필요해요." }, 401);
    if (action === "me") {
      const { data, error } = await sb.from("hub_links").select("id,icon,title,descr,url").order("sort");
      if (error) throw error;
      const links = (data || []).filter((l) => canUse(me, l.id));
      return json({ email: me.email, name: me.name, group: me.group, isAdmin: me.isAdmin, registered: !!(me.name || me.isAdmin || me.linkIds.length || me.group), links });
    }
    if (action.startsWith("admin_") || /^(group|member|link)_/.test(action)) {
      if (!me.isAdmin) return json({ error: "forbidden", message: "관리자만 할 수 있어요." }, 403);
      return await admin(action, body, me);
    }
    if (!canUse(me, "scan")) return json({ error: "forbidden", message: "스캐너 사용 권한이 없어요. 관리자에게 요청하세요." }, 403);
    if (action === "scan") return await scan(body.images as { media_type: string; data: string }[]);
    if (action === "list") {
      const { data, error } = await sb.from("label_products").select("*").order("created_at", { ascending: false }).limit(2000);
      if (error) throw error;
      return json({ items: (data || []).map(fromRow) });
    }
    if (action === "save") {
      const row = { ...toRow(body.record as Record<string, unknown>) } as Record<string, string>;
      const thumb = String(body.thumb || "");
      row.thumb = thumb.startsWith("data:image/jpeg;base64,") && thumb.length < 120_000 ? thumb : "";
      if (!row.product_name && !row.manufacturer) return json({ error: "bad_request", message: "제품명이나 제조사가 필요해요." }, 400);
      const { data, error } = await sb.from("label_products").insert(row).select().single();
      if (error) throw error;
      return json({ item: fromRow(data) });
    }
    if (action === "update") {
      const { data, error } = await sb.from("label_products").update(toRow(body.record as Record<string, unknown>)).eq("id", String(body.id)).select().single();
      if (error) throw error;
      return json({ item: fromRow(data) });
    }
    if (action === "delete") {
      const { error } = await sb.from("label_products").delete().eq("id", String(body.id));
      if (error) throw error;
      return json({ ok: true });
    }
    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "server_error", message: "서버 오류가 났어요." }, 500);
  }
});
