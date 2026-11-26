// 상품 라벨 스캐너 API
// 브라우저는 이 함수만 부릅니다. Anthropic API 키와 DB 권한은 서버(이 함수)에만 있습니다.
// 필요한 시크릿: ANTHROPIC_API_KEY. 접속 코드와 권한은 hub_roles 테이블, 메인 버튼은 hub_links 테이블.
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
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-access-code, x-client-info",
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

// 권한: hub_roles 테이블에 코드가 하나도 없으면 누구나 전부 사용, 있으면 코드에 맞는 권한만.
type Role = { name: string; all: boolean; ids: string[]; canScan: boolean; needsCode: boolean };
async function resolveRole(code: string): Promise<Role | null> {
  const { count } = await sb.from("hub_roles").select("code", { count: "exact", head: true });
  if (!count) return { name: "", all: true, ids: [], canScan: true, needsCode: false };
  if (!code) return null;
  const { data } = await sb.from("hub_roles").select("*").eq("code", code).maybeSingle();
  if (!data) return null;
  return { name: data.name, all: !!data.all_links, ids: data.link_ids || [], canScan: !!data.can_scan, needsCode: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const action = body.action;

  try {
    const role = await resolveRole(req.headers.get("x-access-code") || "");
    if (!role) return json({ error: "bad_code", message: "접속 코드가 맞지 않아요." }, 401);
    if (action === "ping") return json({ ok: true, needsCode: role.needsCode, role: role.name, canScan: role.canScan });
    if (action === "home") {
      const { data, error } = await sb.from("hub_links").select("id,icon,title,descr,url").order("sort");
      if (error) throw error;
      const links = (data || []).filter((l) => role.all || role.ids.includes(l.id))
        .filter((l) => l.id !== "scan" || role.canScan);
      return json({ role: role.name, needsCode: role.needsCode, links });
    }
    if (!role.canScan) return json({ error: "forbidden", message: "이 코드로는 스캐너를 쓸 수 없어요." }, 403);
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
