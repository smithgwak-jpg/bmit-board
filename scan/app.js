const FIELDS = [
  ["productName","제품명",""],
  ["category","식품유형 / 품목",""],
  ["netContent","내용량",""],
  ["manufacturer","제조사 (제조원)",""],
  ["manufacturerAddress","제조사 주소","full"],
  ["seller","판매원 / 유통전문판매원",""],
  ["sellerAddress","판매원 주소",""],
  ["importer","수입원 / 수입판매원",""],
  ["origin","원산지 / 제조국",""],
  ["phone","고객센터 전화",""],
  ["barcode","바코드 번호",""],
  ["expiry","소비기한 / 유통기한",""],
  ["storage","보관방법",""],
  ["ingredients","원재료명 및 함량","full area"],
  ["allergens","알레르기 유발물질","full"],
  ["nutrition","영양정보 (요약)","full area"],
  ["certifications","인증 (HACCP 등)",""],
  ["reportNo","품목보고번호",""],
  ["notes","기타 / 주의사항","full area"],
  ["mfrRevenue","제조사 매출",""],
  ["mfrFounded","제조사 설립일",""],
  ["mfrEmployees","제조사 직원수",""],
  ["mfrSource","제조사 정보 출처","full"],
  ["lowPrice","온라인 최저가",""],
  ["lowPriceStore","최저가 판매처",""],
  ["lowPriceUrl","최저가 링크","full"],
  ["lowPriceAt","최저가 확인일",""],
];
const $ = id => document.getElementById(id);
let photos = [];          // {blob, url}
let editingId = null;     // db doc id while editing an existing item
let thumbForSave = "";
let items = [];
function blobToBase64(blob){ return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); }); }

function setStatus(el, msg, err){ el.textContent = msg || ""; el.classList.toggle("err", !!err); }

/* ---------- image handling ---------- */
function loadImage(blob){
  return new Promise((res, rej) => { const u = URL.createObjectURL(blob); const im = new Image();
    im.onload = () => { res(im); }; im.onerror = () => rej(new Error("이미지를 열 수 없어요")); im.src = u; });
}
async function resize(blob, max, q){
  const im = await loadImage(blob);
  const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
  c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
  return { blob: await new Promise(r => c.toBlob(r, "image/jpeg", q)), dataUrl: max <= 300 ? c.toDataURL("image/jpeg", q) : "" };
}
async function addFiles(list){
  const files = [...list].filter(f => f.type.startsWith("image/"));
  for (const f of files){
    if (photos.length >= 4) { setStatus($("status"), "사진은 한 번에 4장까지 넣을 수 있어요."); break; }
    try { const r = await resize(f, 1800, .88); photos.push({ blob: r.blob, url: URL.createObjectURL(r.blob), src: f }); }
    catch(e){ setStatus($("status"), e.message, true); }
  }
  renderThumbs();
}
function renderThumbs(){
  const t = $("thumbs"); t.replaceChildren();
  photos.forEach((p, i) => {
    const fig = document.createElement("figure");
    const im = document.createElement("img"); im.src = p.url; im.alt = "사진 " + (i+1);
    const b = document.createElement("button"); b.type = "button"; b.textContent = "✕"; b.setAttribute("aria-label","사진 빼기");
    b.onclick = () => { photos.splice(i,1); renderThumbs(); };
    fig.append(im, b); t.append(fig);
  });
  $("analyzeBtn").disabled = !photos.length;
}
// 사진을 찍거나 고르면 바로 정보 읽기를 시작합니다.
async function addAndRead(input){
  const files = input.files; await addFiles(files); input.value = "";
  if (photos.length && !$("analyzeBtn").disabled) $("analyzeBtn").click();
}
$("camIn").onchange = e => addAndRead(e.target);

/* ---------- 무음 촬영: 페이지 안에서 카메라 화면을 띄우고 찍습니다 (셔터음 없음) ---------- */
let camStream = null, camTrack = null, camDevices = [], camIdx = 0;
const CAM_KEY = "labelScannerCam";
async function startStream(deviceId){
  if (camStream) camStream.getTracks().forEach(t => t.stop());
  const video = { width: { ideal: 1920 }, height: { ideal: 1440 } };
  if (deviceId) video.deviceId = { exact: deviceId }; else video.facingMode = { ideal: "environment" };
  camStream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
  camTrack = camStream.getVideoTracks()[0];
  const v = $("camVideo"); v.srcObject = camStream; try { await v.play(); } catch {}
  setupFocusZoom();
}
function caps(){ try { return camTrack && camTrack.getCapabilities ? camTrack.getCapabilities() : {}; } catch { return {}; } }
async function applyAdv(c){ try { await camTrack.applyConstraints({ advanced: [c] }); return true; } catch { return false; } }
async function setupFocusZoom(){
  const c = caps();
  if ((c.focusMode || []).includes("continuous")) await applyAdv({ focusMode: "continuous" });
  const z = $("camZoom");
  if (c.zoom && c.zoom.max > c.zoom.min) {
    z.min = c.zoom.min; z.max = Math.min(c.zoom.max, c.zoom.min * 8); z.step = c.zoom.step || 0.1;
    z.value = (camTrack.getSettings().zoom) || c.zoom.min; $("camZoomBox").hidden = false;
  } else $("camZoomBox").hidden = true;
  $("camSwitch").hidden = camDevices.length < 2;
}
$("camZoom").addEventListener("input", e => applyAdv({ zoom: Number(e.target.value) }));
// 화면을 누르면 그 위치에 초점을 다시 맞춥니다.
$("camVideo").addEventListener("click", async e => {
  if (!camTrack) return;
  const r = e.currentTarget.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  const ring = $("camRing"); ring.style.left = (e.clientX - r.left) + "px"; ring.style.top = (e.clientY - r.top) + "px";
  ring.classList.remove("on"); void ring.offsetWidth; ring.classList.add("on");
  const c = caps(); const modes = c.focusMode || [];
  const adv = {};
  if (c.pointsOfInterest || "pointsOfInterest" in (camTrack.getSettings() || {})) adv.pointsOfInterest = [{ x, y }];
  if (modes.includes("single-shot")) adv.focusMode = "single-shot";
  if (Object.keys(adv).length) await applyAdv(adv);
  if (modes.includes("continuous")) setTimeout(() => applyAdv({ focusMode: "continuous" }), 1500);
});
async function openCam(){
  if (!navigator.mediaDevices?.getUserMedia) return $("camIn").click();
  try {
    let saved = ""; try { saved = localStorage.getItem(CAM_KEY) || ""; } catch {}
    try { await startStream(saved || undefined); } catch { await startStream(); }
    // 권한을 받은 뒤에야 카메라 이름이 보입니다. 후면 카메라만 골라 둡니다.
    const all = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
    const back = all.filter(d => /back|rear|environment|후면/i.test(d.label));
    camDevices = back.length ? back : all;
    const cur = camTrack.getSettings().deviceId;
    camIdx = Math.max(0, camDevices.findIndex(d => d.deviceId === cur));
    setupFocusZoom();
  } catch (e) {
    setStatus($("status"), "카메라를 열 수 없어서 기본 카메라로 찍어요. (브라우저에서 카메라 권한을 허용하면 무음으로 찍을 수 있어요)");
    return $("camIn").click();
  }
  $("camModal").hidden = false; document.body.style.overflow = "hidden";
}
$("camSwitch").onclick = async () => {
  if (camDevices.length < 2) return;
  camIdx = (camIdx + 1) % camDevices.length;
  const id = camDevices[camIdx].deviceId;
  try { await startStream(id); try { localStorage.setItem(CAM_KEY, id); } catch {} } catch {}
};
function closeCam(){
  if (camStream) camStream.getTracks().forEach(t => t.stop()); camStream = null; camTrack = null;
  $("camVideo").srcObject = null; $("camModal").hidden = true; document.body.style.overflow = "";
}
async function snap(){
  const v = $("camVideo"); if (!v.videoWidth) return;
  $("camShot").disabled = true;
  let blob = null;
  // 카메라 사진 모드(takePhoto)는 기기에 따라 셔터음이 나서, 화면을 그대로 잘라 씁니다.
  {
    const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    blob = await new Promise(r => c.toBlob(r, "image/jpeg", .92));
  }
  $("camShot").disabled = false;
  closeCam();
  await addFiles([new File([blob], "camera.jpg", { type: blob.type || "image/jpeg" })]);
  if (photos.length && !$("analyzeBtn").disabled) $("analyzeBtn").click();
}
$("camBtn").onclick = openCam;
$("camShot").onclick = snap;
$("camClose").onclick = closeCam;
$("camNative").onclick = () => { closeCam(); $("camIn").click(); };
document.addEventListener("visibilitychange", () => { if (document.hidden && camStream) closeCam(); });
$("fileIn").onchange = e => addAndRead(e.target);
const drop = $("drop");
drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); addFiles(e.dataTransfer.files); });
document.addEventListener("paste", e => { if (e.clipboardData?.files?.length) addFiles(e.clipboardData.files); });

/* ---------- AI extraction ---------- */
$("analyzeBtn").onclick = async () => {
  if (!photos.length) return;
  const btn = $("analyzeBtn"); btn.disabled = true;
  const st = $("status");
  st.replaceChildren(); const sp = document.createElement("span"); sp.className = "spin"; sp.textContent = "◐";
  st.append(sp, " 사진을 읽는 중… (10~30초)"); st.classList.remove("err");
  try {
    const images = await Promise.all(photos.map(async p => ({ media_type: "image/jpeg", data: await blobToBase64(p.blob) })));
    const { data } = await api("scan", { images });
    const t = await resize(photos[0].blob, 240, .7);
    thumbForSave = t.dataUrl;
    editingId = null;
    openReview(data && typeof data === "object" ? data : {}, "새 상품");
    lookupExtras();
    setStatus(st, "다 읽었어요. 아래에서 확인 후 저장하세요.");
  } catch (e) {
    if (e.code === "login_required") return Gate.show("다시 로그인해 주세요.");
    const msg = e.code === "rate_limited" ? "잠시 사용량이 많아요. 조금 뒤 다시 시도해 주세요."
      : e.code === "invalid_json" ? "결과를 정리하지 못했어요. 사진을 더 선명하게 찍어 다시 시도해 주세요."
      : e.code === "server_not_ready" ? "서버 설정이 아직 끝나지 않았어요. 관리자에게 알려 주세요."
      : "사진을 읽지 못했어요. " + (e.message || "다시 시도해 주세요.");
    setStatus(st, msg, true);
  } finally { btn.disabled = !photos.length; }
};

$("manualBtn").onclick = async () => {
  editingId = null;
  thumbForSave = photos[0] ? (await resize(photos[0].blob, 240, .7)).dataUrl : "";
  openReview({}, "직접 입력");
};

/* ---------- review form ---------- */
let reviewSeq = 0, savedFor = null;
function openReview(data, tag){
  reviewSeq++; setStatus($("extraStatus"), "");
  const form = $("form"); form.replaceChildren();
  const unsure = String(data.confidence || "").split(/[,\s]+/).filter(Boolean);
  FIELDS.forEach(([key, label, cls]) => {
    const wrap = document.createElement("div"); wrap.className = "field" + (cls.includes("full") ? " full" : "");
    const lab = document.createElement("label"); lab.htmlFor = "f_" + key; lab.textContent = label;
    if (unsure.includes(key)) { const c = document.createElement("span"); c.className = "chip"; c.textContent = "확인 필요"; c.style.color = "var(--warn)"; lab.append(c); }
    const inp = document.createElement(cls.includes("area") ? "textarea" : "input");
    inp.id = "f_" + key; inp.name = key; inp.value = data[key] == null ? "" : String(data[key]);
    const mark = () => inp.classList.toggle("empty", !inp.value.trim());
    inp.addEventListener("input", mark); mark();
    wrap.append(lab, inp); form.append(wrap);
  });
  $("reviewTag").textContent = tag;
  $("review").hidden = false;
  $("review").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}
$("form").addEventListener("submit", e => e.preventDefault());

/* ---------- 제조사 정보·온라인 최저가 (웹 검색) ---------- */
const formVal = k => ($("f_" + k) ? $("f_" + k).value.trim() : "");
function fillEmpty(info){
  Object.entries(info).forEach(([k, v]) => { const el = $("f_" + k); if (el && v && (!el.value.trim() || k.startsWith("lowPrice"))) { el.value = v; el.classList.remove("empty"); } });
}
async function lookupExtras(){
  const seq = reviewSeq;
  const rec = {}; FIELDS.forEach(([k]) => rec[k] = formVal(k));
  const jobs = [];
  if (rec.manufacturer) jobs.push(api("company", { name: rec.manufacturer, address: rec.manufacturerAddress })
    .then(r => ({ mfrRevenue: r.info.revenue, mfrFounded: r.info.founded, mfrEmployees: r.info.employees, mfrSource: r.info.source })));
  if (rec.productName) jobs.push(api("price", { record: rec }).then(r => r.info));
  if (!jobs.length) return setStatus($("extraStatus"), "제조사나 제품명이 있어야 찾을 수 있어요.", true);
  $("extraBtn").disabled = true;
  setStatus($("extraStatus"), "제조사 정보와 온라인 최저가를 찾는 중… (30초~1분, 먼저 저장해도 돼요)");
  const results = await Promise.allSettled(jobs);
  $("extraBtn").disabled = false;
  const found = Object.assign({}, ...results.filter(r => r.status === "fulfilled").map(r => r.value));
  const failed = results.filter(r => r.status === "rejected").length;
  if (seq === reviewSeq && !$("review").hidden) {
    fillEmpty(found);
    setStatus($("extraStatus"), failed ? "일부를 찾지 못했어요. 다시 찾기를 눌러 보세요." : "제조사 정보와 최저가를 채웠어요. 확인 후 저장하세요.", !!failed);
  } else if (savedFor && savedFor.seq === seq) {
    // 찾는 동안 이미 저장했으면, 비어 있던 칸만 채워서 저장한 항목을 고칩니다.
    const it = items.find(x => x.id === savedFor.id); if (!it) return;
    const merged = { ...it }; let changed = false;
    Object.entries(found).forEach(([k, v]) => { if (v && !merged[k]) { merged[k] = v; changed = true; } });
    if (!changed) return;
    try { const { item } = await api("update", { id: it.id, record: merged }); items = items.map(x => x.id === item.id ? item : x); renderList(); } catch {}
  }
}
$("extraBtn").onclick = lookupExtras;
$("cancelBtn").onclick = () => { $("review").hidden = true; editingId = null; };

$("saveBtn").onclick = async () => {
  const rec = {};
  FIELDS.forEach(([k]) => rec[k] = $("f_" + k).value.trim());
  if (!rec.productName && !rec.manufacturer) { setStatus($("status"), "제품명이나 제조사 중 하나는 입력해 주세요.", true); return; }
  const btn = $("saveBtn"); btn.disabled = true;
  try {
    if (editingId) {
      const { item } = await api("update", { id: editingId, record: rec });
      items = items.map(x => x.id === item.id ? item : x);
    } else {
      const { item } = await api("save", { record: rec, thumb: thumbForSave || "" });
      items = [item, ...items]; savedFor = { seq: reviewSeq, id: item.id };
      photos = []; renderThumbs();
    }
    $("review").hidden = true; editingId = null; renderList();
    setStatus($("status"), "저장했어요. 다음 상품을 찍어 주세요.");
  } catch (e) {
    setStatus($("status"), "저장하지 못했어요. " + (e.message || "다시 시도해 주세요."), true);
  } finally { btn.disabled = false; }
};

/* ---------- list ---------- */
function renderList(){
  const q = $("search").value.trim().toLowerCase();
  const shown = items.filter(it => !q || FIELDS.some(([k]) => String(it[k]||"").toLowerCase().includes(q)));
  $("count").textContent = items.length + "개";
  const list = $("list"); list.replaceChildren();
  if (!items.length) { const d = document.createElement("div"); d.className = "empty-state"; d.textContent = "아직 저장한 상품이 없어요. 위에서 첫 상품 뒷면을 찍어 보세요."; list.append(d); return; }
  if (!shown.length) { const d = document.createElement("div"); d.className = "empty-state"; d.textContent = "검색 결과가 없어요."; list.append(d); return; }
  shown.forEach(it => {
    const row = document.createElement("div"); row.className = "row";
    let pic;
    if (typeof it.thumb === "string" && it.thumb.startsWith("data:image/jpeg;base64,")) { pic = document.createElement("img"); pic.src = it.thumb; pic.alt = ""; }
    else { pic = document.createElement("div"); pic.className = "noimg"; }
    const body = document.createElement("div"); body.style.minWidth = "0";
    const name = document.createElement("div"); name.className = "name"; name.textContent = it.productName || "(제품명 없음)";
    if (it.netContent) { const c = document.createElement("span"); c.className = "chip"; c.textContent = it.netContent; name.append(c); }
    const meta = document.createElement("div"); meta.className = "meta";
    const add = (lab, val) => { if (!val) return; if (meta.childNodes.length) meta.append(" · "); const b = document.createElement("b"); b.textContent = lab + " "; meta.append(b, val); };
    add("제조", it.manufacturer); add("판매", it.seller); add("수입", it.importer); add("☎", it.phone);
    add("매출", it.mfrRevenue); add("직원", it.mfrEmployees); add("최저가", it.lowPrice ? it.lowPrice + (it.lowPriceStore ? " (" + it.lowPriceStore + ")" : "") : "");
    if (!meta.childNodes.length) meta.textContent = it.category || "";
    body.append(name, meta);
    const acts = document.createElement("div"); acts.className = "acts";
    const edit = document.createElement("button"); edit.className = "ghost"; edit.textContent = "수정";
    edit.onclick = () => { editingId = it.id; openReview(it, "수정 중"); };
    const del = document.createElement("button"); del.className = "ghost danger"; del.textContent = "삭제";
    del.onclick = () => {
      acts.replaceChildren();
      const box = document.createElement("span"); box.className = "confirm"; box.textContent = "지울까요?";
      const y = document.createElement("button"); y.className = "ghost danger"; y.textContent = "지우기";
      y.onclick = async () => { try { await api("delete", { id: it.id }); items = items.filter(x => x.id !== it.id); renderList(); } catch { setStatus($("listStatus"), "지우지 못했어요.", true); renderList(); } };
      const n = document.createElement("button"); n.className = "ghost"; n.textContent = "취소"; n.onclick = renderList;
      box.append(y, n); acts.append(box);
    };
    acts.append(edit, del);
    row.append(pic, body, acts); list.append(row);
  });
}
$("search").addEventListener("input", renderList);

/* ---------- export ---------- */
function rows(){ return items.map((it, i) => { const r = { "번호": i + 1 }; FIELDS.forEach(([k, l]) => r[l] = it[k] || ""); r["등록일"] = it.createdAt ? new Date(it.createdAt).toLocaleString("ko-KR") : ""; return r; }); }
function stamp(){ const d = new Date(); return d.getFullYear() + String(d.getMonth()+1).padStart(2,"0") + String(d.getDate()).padStart(2,"0"); }
async function save(filename, data){
  const url = URL.createObjectURL(data); const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
$("csvBtn").onclick = () => {
  if (!items.length) return setStatus($("listStatus"), "내보낼 상품이 없어요.");
  const rs = rows(); const head = Object.keys(rs[0]);
  const esc = v => { v = String(v ?? ""); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g,'""') + '"' : v; };
  const csv = "﻿" + [head.map(esc).join(","), ...rs.map(r => head.map(h => esc(r[h])).join(","))].join("\r\n");
  save("상품목록_" + stamp() + ".csv", new Blob([csv], { type: "text/csv" }));
};
$("xlsxBtn").onclick = () => {
  if (!items.length) return setStatus($("listStatus"), "내보낼 상품이 없어요.");
  if (!window.XLSX) return setStatus($("listStatus"), "엑셀 모듈을 불러오지 못했어요. CSV로 받아 주세요.", true);
  const ws = XLSX.utils.json_to_sheet(rows());
  ws["!cols"] = Object.keys(rows()[0]).map(h => ({ wch: /원재료|영양|주소|기타/.test(h) ? 50 : 18 }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "상품목록");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  save("상품목록_" + stamp() + ".xlsx", new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
};

/* ---------- boot ---------- */
async function loadList(){
  setStatus($("listStatus"), "");
  try { const { items: got } = await api("list", {}); items = got || []; renderList(); }
  catch (e) {
    if (e.code === "login_required") return Gate.show("다시 로그인해 주세요.");
    $("list").replaceChildren(); setStatus($("listStatus"), "목록을 불러오지 못했어요. " + (e.message || ""), true);
  }
}
async function start(){
  try {
    const me = await api("me", {});
    $("who").textContent = (me.name || me.email) + (me.group ? " · " + me.group : "");
    if (!(me.links || []).some(l => l.id === "scan")) {
      $("capture").hidden = true; $("listCard").hidden = true;
      setStatus($("noAccess"), "스캐너 사용 권한이 없어요. 관리자에게 요청하세요.", true); return;
    }
    renderThumbs(); loadList();
  } catch (e) {
    if (e.code === "login_required") return Gate.show("다시 로그인해 주세요.");
    setStatus($("noAccess"), "서버에 연결하지 못했어요. 잠시 후 새로고침해 주세요.", true);
  }
}
$("logoutBtn").onclick = () => Gate.signOut();
Gate.start(start);
