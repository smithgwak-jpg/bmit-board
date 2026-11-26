const $ = id => document.getElementById(id);
const el = (tag, props, ...kids) => { const e = document.createElement(tag); Object.assign(e, props || {}); kids.forEach(k => e.append(k)); return e; };
const SAFE_URL = /^(https:\/\/|\/(?!\/)|\.\.\/)/;
let A = { groups: [], members: [], links: [] };
let tab = "members";

function say(id, msg, err){ $(id).textContent = msg || ""; $(id).classList.toggle("err", !!err); }

function renderTiles(links){
  const box = $("tiles"); box.replaceChildren();
  if (!links.length) { say("homeStatus", "아직 볼 수 있는 메뉴가 없어요. 관리자에게 권한을 요청하세요."); return; }
  links.forEach(l => {
    const url = String(l.url || ""); if (!SAFE_URL.test(url)) return;
    const ext = url.startsWith("https://");
    const a = el("a", { className: "tile" + (ext ? " ext" : ""), href: url },
      el("div", { className: "ic", textContent: l.icon || "🔗" }),
      el("b", { textContent: l.title }),
      el("span", { textContent: l.descr || "" }));
    if (ext) { a.target = "_blank"; a.rel = "noopener"; }
    box.append(a);
  });
}

async function start(){
  say("homeStatus", "");
  try {
    const me = await api("me", {});
    $("who").textContent = (me.name || me.email) + (me.group ? " · " + me.group : "") + (me.isAdmin ? " · 관리자" : "");
    renderTiles(me.links || []);
    $("admin").hidden = !me.isAdmin;
    if (me.isAdmin) loadAdmin();
  } catch (e) {
    if (e.code === "login_required") return Gate.show("다시 로그인해 주세요.");
    say("homeStatus", "서버에 연결하지 못했어요. 잠시 후 새로고침해 주세요.", true);
  }
}

/* ---------- 관리 ---------- */
async function loadAdmin(){
  try { A = await api("admin_load", {}); renderAdmin(); }
  catch (e) { say("admStatus", "관리 정보를 불러오지 못했어요. " + (e.message || ""), true); }
}
const HINTS = {
  members: "메인 앱을 쓸 사람의 이메일을 등록하세요. 등록된 사람은 처음 들어올 때 '비밀번호 만들기'로 비밀번호를 정합니다. 그룹 권한에 더해 개인별로 메뉴를 더 열어 줄 수 있어요.",
  groups: "그룹마다 보이는 메뉴 버튼을 정하세요. 사람을 그룹에 넣으면 그 그룹의 메뉴가 보여요.",
  links: "메인 화면에 보이는 버튼이에요. 주소는 https:// 로 시작하는 바깥 사이트이거나 이 사이트 안의 /경로 입니다.",
};
function renderAdmin(){
  document.querySelectorAll("[data-tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  $("tabHint").textContent = HINTS[tab];
  $("formBox").replaceChildren();
  const list = $("admList"); list.replaceChildren();
  const groupName = id => (A.groups.find(g => g.id === id) || {}).name || "그룹 없음";
  const linkTitles = ids => ids.map(id => (A.links.find(l => l.id === id) || {}).title).filter(Boolean).join(", ") || "없음";
  const rows = tab === "members" ? A.members.map(m => [m.name || m.email, m.email + " · " + groupName(m.group_id) + (m.is_admin ? " · 관리자" : "") + (m.extra_link_ids.length ? " · 추가: " + linkTitles(m.extra_link_ids) : ""), m])
    : tab === "groups" ? A.groups.map(g => [g.name, "메뉴: " + linkTitles(g.link_ids) + " · " + A.members.filter(m => m.group_id === g.id).length + "명", g])
    : A.links.map(l => [(l.icon ? l.icon + " " : "") + l.title, l.url, l]);
  if (!rows.length) list.append(el("div", { className: "empty-state", textContent: "아직 없어요. '+ 추가'를 눌러 만드세요." }));
  rows.forEach(([title, sub, item]) => {
    const acts = el("div", { className: "acts" });
    const edit = el("button", { className: "ghost", type: "button", textContent: "수정", onclick: () => openForm(item) });
    const del = el("button", { className: "ghost danger", type: "button", textContent: "삭제" });
    del.onclick = () => {
      acts.replaceChildren(el("span", { className: "confirm", textContent: "지울까요?" },
        el("button", { className: "ghost danger", type: "button", textContent: "지우기", onclick: () => remove(item) }),
        el("button", { className: "ghost", type: "button", textContent: "취소", onclick: renderAdmin })));
    };
    acts.append(edit, del);
    list.append(el("div", { className: "adm-row" }, el("div", { className: "t" }, el("b", { textContent: title }), el("small", { textContent: sub })), acts));
  });
}
function field(label, input, full){ const w = el("div", { className: "field" + (full ? " full" : "") }); const id = "a_" + Math.random().toString(36).slice(2); input.id = id; w.append(el("label", { htmlFor: id, textContent: label }), input); return w; }
function linkChecks(selected){
  const box = el("div", { className: "checks" });
  A.links.forEach(l => { const c = el("input", { type: "checkbox", value: l.id, checked: selected.includes(l.id) }); box.append(el("label", {}, c, (l.icon ? l.icon + " " : "") + l.title)); });
  return box;
}
const checked = box => [...box.querySelectorAll("input:checked")].map(c => c.value);

function openForm(item){
  const f = el("form", { className: "adm-form" });
  let collect;
  if (tab === "members") {
    const email = el("input", { type: "email", value: item?.email || "", required: true, readOnly: !!item });
    const name = el("input", { value: item?.name || "", placeholder: "홍길동" });
    const group = el("select"); group.append(el("option", { value: "", textContent: "그룹 없음" }));
    A.groups.forEach(g => group.append(el("option", { value: g.id, textContent: g.name, selected: item?.group_id === g.id })));
    const extra = linkChecks(item?.extra_link_ids || []);
    const adm = el("input", { type: "checkbox", checked: !!item?.is_admin });
    f.append(field("이메일", email), field("이름", name), field("그룹", group),
      el("div", { className: "field full" }, el("label", { textContent: "개인별로 더 열어 줄 메뉴" }), extra),
      el("label", { className: "full", style: "display:flex;gap:6px;align-items:center" }, adm, "관리자 (모든 메뉴와 관리 화면)"));
    collect = () => ["member_save", { email: email.value, name: name.value, group_id: group.value || null, extra_link_ids: checked(extra), is_admin: adm.checked }];
  } else if (tab === "groups") {
    const name = el("input", { value: item?.name || "", placeholder: "예: 직원, 거래처", required: true });
    const links = linkChecks(item?.link_ids || []);
    f.append(field("그룹 이름", name, true), el("div", { className: "field full" }, el("label", { textContent: "이 그룹에 보이는 메뉴" }), links));
    collect = () => ["group_save", { id: item?.id, name: name.value, link_ids: checked(links) }];
  } else {
    const id = el("input", { value: item?.id || "", placeholder: "예: shop", required: true, readOnly: !!item });
    const title = el("input", { value: item?.title || "", required: true });
    const icon = el("input", { value: item?.icon || "", placeholder: "🛒" });
    const sort = el("input", { type: "number", value: item?.sort ?? (A.links.length + 1) * 10 });
    const url = el("input", { value: item?.url || "", placeholder: "https://", required: true });
    const descr = el("input", { value: item?.descr || "" });
    f.append(field("버튼 ID (영문)", id), field("버튼 이름", title), field("아이콘", icon), field("순서", sort), field("주소", url, true), field("설명", descr, true));
    collect = () => ["link_save", { id: id.value, title: title.value, icon: icon.value, sort: sort.value, url: url.value, descr: descr.value }];
  }
  f.append(el("div", { className: "btns full", style: "justify-content:flex-start" },
    el("button", { className: "primary", type: "submit", textContent: "저장" }),
    el("button", { type: "button", textContent: "취소", onclick: () => $("formBox").replaceChildren() })));
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const [action, payload] = collect();
    say("admStatus", "저장하는 중…");
    try { await api(action, payload); say("admStatus", "저장했어요."); await loadAdmin(); start(); }
    catch (err) { say("admStatus", err.message || "저장하지 못했어요.", true); }
  });
  $("formBox").replaceChildren(f);
  f.querySelector("input:not([readonly])")?.focus();
}
async function remove(item){
  const [action, payload] = tab === "members" ? ["member_delete", { email: item.email }] : tab === "groups" ? ["group_delete", { id: item.id }] : ["link_delete", { id: item.id }];
  try { await api(action, payload); say("admStatus", "지웠어요."); await loadAdmin(); start(); }
  catch (err) { say("admStatus", err.message || "지우지 못했어요.", true); renderAdmin(); }
}
document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; say("admStatus", ""); renderAdmin(); });
$("addBtn").onclick = () => openForm(null);
$("logoutBtn").onclick = () => Gate.signOut();
Gate.start(start);
