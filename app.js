'use strict';
const STATUSES = ['요청', '검토', '진행', '완료', '보류'];
const SCOLOR = { '요청': 'var(--s-req)', '검토': 'var(--s-rev)', '진행': 'var(--s-prog)', '완료': 'var(--s-done)', '보류': 'var(--s-hold)' };
const PRIOS = ['상', '중', '하'];
const CATS = ['기능 개선', '오류 수정', '신규 개발', '디자인', '데이터/리포트', '인프라'];

const cfg = window.BMIT_CONFIG || {};
const $ = id => document.getElementById(id);

let sb = null, me = null, email = '';
let reqs = [], comments = [], items = [], votes = [], members = [];
let filter = '전체', query = '', openId = null, creating = false, dirty = false, loaded = false;

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) { if (k == null || k === false) continue; e.append(k.nodeType ? k : document.createTextNode(String(k))); }
  return e;
}
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const code = n => 'BM-' + String(n || 0).padStart(3, '0');
const isAdmin = () => !!(me && me.is_admin);
function dday(due, status) {
  if (!due) return null;
  const d = Math.round((new Date(due + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 864e5);
  if (status === '완료') return { t: '완료', over: false };
  if (d === 0) return { t: 'D-day', over: false };
  return d > 0 ? { t: 'D-' + d, over: false } : { t: (-d) + '일 지남', over: true };
}
function fmtTime(iso) { const d = new Date(iso); if (isNaN(d)) return ''; return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function note(msg) { const n = $('notice'); n.textContent = msg || ''; n.hidden = !msg; }
function errMsg(e) { return (e && (e.message || e.error_description)) || '알 수 없는 오류'; }

/* ---------- 로그인 ---------- */
let signupMode = false;
function setLoginMode(s) {
  signupMode = s;
  $('login-title').textContent = s ? '처음 비밀번호 만들기' : '로그인';
  $('l-submit').textContent = s ? '비밀번호 만들고 들어가기' : '로그인';
  $('l-pw2-wrap').hidden = !s;
  $('l-pw').autocomplete = s ? 'new-password' : 'current-password';
  $('l-switch').textContent = s ? '로그인하기' : '비밀번호 만들기';
  $('l-switch-wrap').firstChild.textContent = s ? '이미 비밀번호가 있나요? ' : '처음 오셨나요? ';
  $('l-err').textContent = '';
}
$('l-switch').onclick = () => setLoginMode(!signupMode);
$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const em = $('l-email').value.trim().toLowerCase(), pw = $('l-pw').value;
  $('l-err').textContent = '';
  $('l-submit').disabled = true;
  try {
    if (signupMode) {
      if (pw !== $('l-pw2').value) { $('l-err').textContent = '비밀번호 확인이 일치하지 않습니다.'; return; }
      const { data, error } = await sb.auth.signUp({ email: em, password: pw });
      if (error) {
        $('l-err').textContent = /database error|등록되지/i.test(error.message) ? '등록되지 않은 이메일입니다. 관리자에게 참여자 등록을 요청해 주세요.'
          : /already|registered/i.test(error.message) ? '이미 가입된 이메일입니다. 로그인해 주세요.' : '가입하지 못했습니다: ' + error.message;
        return;
      }
      if (!data.session) $('l-err').textContent = '가입 확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 로그인해 주세요.';
    } else {
      const { error } = await sb.auth.signInWithPassword({ email: em, password: pw });
      if (error) $('l-err').textContent = /invalid/i.test(error.message) ? '이메일 또는 비밀번호가 맞지 않습니다.' : '로그인하지 못했습니다: ' + error.message;
    }
  } finally { $('l-submit').disabled = false; }
});
$('logout').onclick = async () => { await sb.auth.signOut(); };

/* ---------- 데이터 ---------- */
async function loadAll() {
  const [r, c, s, v, m] = await Promise.all([
    sb.from('requests').select('*').order('no', { ascending: false }),
    sb.from('comments').select('*').order('created_at'),
    sb.from('survey').select('*').order('created_at', { ascending: false }),
    sb.from('votes').select('*'),
    sb.from('members').select('*').order('created_at'),
  ]);
  const err = [r, c, s, v, m].find(x => x.error);
  if (err) { note('데이터를 불러오지 못했습니다: ' + errMsg(err.error)); return; }
  reqs = r.data; comments = c.data; items = s.data; votes = v.data; members = m.data;
  loaded = true; note('');
  render();
}
let reloadTimer = null;
const scheduleReload = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(loadAll, 250); };
let channel = null;
function subscribe() {
  if (channel) return;
  channel = sb.channel('bmit-board');
  for (const t of ['requests', 'comments', 'survey', 'votes', 'members'])
    channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, scheduleReload);
  channel.subscribe();
}
async function run(promise, failMsg) {
  const { data, error } = await promise;
  if (error) { note(failMsg + ': ' + errMsg(error)); throw error; }
  scheduleReload();
  return data;
}

/* ---------- 요청 현황 ---------- */
function renderStrip() {
  const s = $('strip'); s.replaceChildren();
  for (const st of ['전체', ...STATUSES]) {
    const n = st === '전체' ? reqs.length : reqs.filter(r => r.status === st).length;
    s.append(h('button', { 'aria-pressed': String(filter === st), onclick: () => { filter = st; render(); } },
      h('span', { class: 'lab' }, st === '전체' ? null : h('span', { class: 'dot', style: 'background:' + SCOLOR[st] }), st),
      h('span', { class: 'num' }, n)));
  }
}
function renderRows() {
  const tb = $('rows'); tb.replaceChildren();
  const ql = query.trim().toLowerCase();
  const list = reqs.filter(r => (filter === '전체' || r.status === filter) &&
    (!ql || [r.title, r.category, r.requester, r.assignee, code(r.no)].join(' ').toLowerCase().includes(ql)));
  if (!list.length) {
    tb.append(h('tr', null, h('td', { colspan: 9, class: 'empty' },
      !loaded ? '불러오는 중입니다…' : reqs.length ? '조건에 맞는 요청이 없습니다.' : '아직 등록된 요청이 없습니다. "새 요청 등록"으로 첫 건을 올려 주세요.')));
    return;
  }
  for (const r of list) {
    const dd = dday(r.due_at, r.status);
    const cc = comments.filter(c => c.request_id === r.id).length;
    tb.append(h('tr', { tabindex: '0', onclick: () => openReq(r.id), onkeydown: e => { if (e.key === 'Enter') openReq(r.id); } },
      h('td', { class: 'mono' }, code(r.no)),
      h('td', null, h('div', { class: 'ttl' }, r.title), r.category ? h('div', { class: 'cat' }, r.category) : null),
      h('td', null, h('span', { class: 'pill st-' + r.status }, r.status)),
      h('td', null, h('span', { class: 'pr pr-' + r.priority }, r.priority)),
      h('td', null, r.requester || '—'),
      h('td', null, r.assignee || h('span', { style: 'color:var(--muted)' }, '미지정')),
      h('td', { class: 'mono' }, r.requested_at || '—'),
      h('td', { class: 'due mono' + (dd && dd.over ? ' over' : '') }, r.due_at || '—', dd ? h('small', null, dd.t) : null),
      h('td', { class: 'mono' }, cc || '—')));
  }
}

/* ---------- 상세 패널 ---------- */
const field = (label, el) => h('label', { class: 'f' }, label, el);
function sel(id, opts, val) { const s = h('select', { id, onchange: () => { dirty = true; } }); for (const o of opts) s.append(h('option', { value: o, selected: o === val }, o)); return s; }
function openReq(id) { openId = id; creating = false; dirty = false; renderPanel(); }
function newReq() { openId = null; creating = true; dirty = false; renderPanel(); }
function closePanel() { openId = null; creating = false; dirty = false; $('panel').hidden = true; $('scrim').hidden = true; }
function renderPanel() {
  const blank = { title: '', category: '', status: '요청', priority: '중', requester: me && me.side === '우리' ? me.name : '', assignee: '', requested_at: today(), due_at: '', description: '' };
  const r = creating ? blank : reqs.find(x => x.id === openId);
  if (!r) { closePanel(); return; }
  const inp = (id, v, type = 'text', extra = {}) => h('input', Object.assign({ id, type, value: v || '', oninput: () => { dirty = true; } }, extra));
  const saveMsg = h('span', { class: 'saved' });
  const form = h('form', { style: 'display:flex;flex-direction:column;gap:12px', onsubmit: e => { e.preventDefault(); saveReq(saveMsg); } },
    field('요청 제목', inp('p-title', r.title, 'text', { required: true, maxlength: 200, placeholder: '예: 회원가입 화면 휴대폰 인증 추가' })),
    h('div', { class: 'grid2' },
      field('상태', sel('p-status', STATUSES, r.status)),
      field('우선순위', sel('p-prio', PRIOS, r.priority)),
      field('분류', inp('p-cat', r.category, 'text', { list: 'cats', placeholder: '기능 개선 / 오류 수정 / 신규 개발' })),
      field('요청자 (우리 측)', inp('p-req', r.requester, 'text', { placeholder: '부서 또는 이름' })),
      field('BMIT 담당', inp('p-asg', r.assignee, 'text', { placeholder: '담당자 이름' })),
      h('div'),
      field('요청일', inp('p-reqat', r.requested_at, 'date')),
      field('기한', inp('p-due', r.due_at, 'date'))),
    field('상세 내용', h('textarea', { id: 'p-desc', oninput: () => { dirty = true; }, placeholder: '배경, 원하는 결과, 참고 화면 등' }, r.description || '')),
    h('datalist', { id: 'cats' }, CATS.map(c => h('option', { value: c }))),
    h('div', { class: 'row end' },
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, creating ? '요청 등록' : '변경 저장'), saveMsg),
      !creating && isAdmin() ? delBtn(r) : null));
  const body = h('div', { class: 'p-body' }, form);
  if (!creating) {
    if (r.updated_at) body.append(h('div', { class: 'cat' }, '마지막 수정 ' + fmtTime(r.updated_at) + (r.updated_by ? ' · ' + nameOf(r.updated_by) : '')));
    body.append(h('h3', { class: 'sec' }, '협의 기록'));
    const cs = comments.filter(c => c.request_id === r.id);
    if (!cs.length) body.append(h('div', { class: 'cat' }, '아직 기록이 없습니다. 회의 내용, 견적, 일정 변경 등을 남겨 두세요.'));
    for (const c of cs) body.append(h('div', { class: 'cm' + (c.side === 'BMIT' ? ' bmit' : '') },
      h('div', { class: 'meta' }, h('span', { class: 'side' }, c.side === 'BMIT' ? 'BMIT' : '우리 측'), h('span', null, c.author_name || c.author_email), h('span', { class: 'mono' }, fmtTime(c.created_at)),
        c.author_email === email || isAdmin() ? cmDel(c) : null),
      h('div', { class: 'txt' }, c.body)));
    const ta = h('textarea', { id: 'cm-body', placeholder: '협의 내용, 질문, 답변을 남겨 주세요', maxlength: 4000 });
    body.append(h('form', { class: 'cm-form', onsubmit: e => { e.preventDefault(); addComment(r.id, ta); } },
      field('기록 추가', ta),
      h('div', { class: 'row end' },
        h('span', { class: 'cat' }, (me.side === 'BMIT' ? 'BMIT' : '우리 측') + ' · ' + (me.name || email) + '(으)로 남겨집니다'),
        h('button', { class: 'btn primary', type: 'submit' }, '기록 남기기'))));
  }
  $('panel').replaceChildren(
    h('div', { class: 'p-head' },
      h('div', { style: 'min-width:0' }, h('div', { class: 'eyebrow mono' }, creating ? '새 요청' : code(r.no)), h('h2', { style: 'font-size:17px' }, creating ? 'BMIT에 새 개발 요청' : r.title)),
      h('button', { class: 'btn', onclick: closePanel }, '닫기')),
    body);
  $('panel').hidden = false; $('scrim').hidden = false;
}
function nameOf(em) { const m = members.find(x => x.email === em); return m ? m.name || em : em; }
function confirmBtn(label, armedLabel, action, style) {
  let armed = false;
  const b = h('button', { class: 'btn danger', type: 'button', style, onclick: async () => {
    if (!armed) { armed = true; b.classList.add('armed'); b.textContent = armedLabel; setTimeout(() => { armed = false; b.classList.remove('armed'); b.textContent = label; }, 4000); return; }
    b.disabled = true;
    try { await action(); } catch (e) { b.disabled = false; }
  } }, label);
  return b;
}
const delBtn = r => confirmBtn('삭제', '한 번 더 누르면 삭제', async () => { await run(sb.from('requests').delete().eq('id', r.id), '삭제하지 못했습니다'); closePanel(); });
const cmDel = c => confirmBtn('지우기', '한 번 더', () => run(sb.from('comments').delete().eq('id', c.id), '기록을 지우지 못했습니다'), 'padding:0 8px;font-size:11px;margin-left:auto');
async function saveReq(msg) {
  const v = id => $(id).value.trim();
  const data = { title: v('p-title'), category: v('p-cat'), status: $('p-status').value, priority: $('p-prio').value,
    requester: v('p-req'), assignee: v('p-asg'), requested_at: $('p-reqat').value || null, due_at: $('p-due').value || null, description: $('p-desc').value };
  if (!data.title) return;
  try {
    if (creating) {
      const rows = await run(sb.from('requests').insert(data).select(), '등록하지 못했습니다');
      reqs = [rows[0], ...reqs]; creating = false; openId = rows[0].id; dirty = false; renderPanel();
    } else {
      await run(sb.from('requests').update(data).eq('id', openId), '저장하지 못했습니다');
      dirty = false; msg.textContent = '저장했습니다';
    }
  } catch (e) { msg.textContent = ''; }
}
async function addComment(rid, ta) {
  const body = ta.value.trim(); if (!body) return;
  try { await run(sb.from('comments').insert({ request_id: rid, body }), '기록을 남기지 못했습니다'); ta.value = ''; } catch (e) {}
}

/* ---------- 수요조사 ---------- */
function renderSurvey() {
  const L = $('sv-list'); L.replaceChildren();
  if (!items.length) { L.append(h('div', { class: 'empty' }, loaded ? '아직 수요 항목이 없습니다. 위에서 첫 아이디어를 올려 주세요.' : '불러오는 중입니다…')); return; }
  const cnt = id => votes.filter(v => v.survey_id === id).length;
  const list = [...items].sort((a, b) => (!!a.converted_to - !!b.converted_to) || cnt(b.id) - cnt(a.id) || b.created_at.localeCompare(a.created_at));
  for (const it of list) {
    const mine = votes.some(v => v.survey_id === it.id && v.email === email);
    const conv = it.converted_to && reqs.find(r => r.id === it.converted_to);
    const voters = votes.filter(v => v.survey_id === it.id).map(v => nameOf(v.email));
    L.append(h('div', { class: 'sv-item' },
      h('button', { class: 'vote', 'aria-pressed': String(mine), onclick: () => toggleVote(it.id, mine), title: voters.join(', ') || '필요하다고 표시' },
        h('span', { class: 'n' }, cnt(it.id)), h('span', { class: 'l' }, '필요해요')),
      h('div', { style: 'min-width:0' }, h('div', { class: 'ttl' }, it.title), it.description ? h('div', null, it.description) : null,
        h('div', { class: 'sv-meta' }, nameOf(it.created_by) + ' · ' + it.created_at.slice(0, 10), conv ? ' · 요청 ' + code(conv.no) + '로 전환됨' : '')),
      h('div', { class: 'sv-actions' },
        conv ? h('button', { class: 'btn', onclick: () => { showTab('req'); openReq(conv.id); } }, '요청 보기')
          : h('button', { class: 'btn', onclick: () => convert(it) }, '요청으로 전환'),
        !conv && (it.created_by === email || isAdmin()) ? confirmBtn('삭제', '한 번 더', () => run(sb.from('survey').delete().eq('id', it.id), '삭제하지 못했습니다'), 'padding:4px 10px;font-size:12px') : null)));
  }
}
async function toggleVote(id, mine) {
  try {
    if (mine) await run(sb.from('votes').delete().eq('survey_id', id).eq('email', email), '반영하지 못했습니다');
    else await run(sb.from('votes').insert({ survey_id: id }), '반영하지 못했습니다');
  } catch (e) {}
}
async function convert(it) {
  try {
    const rows = await run(sb.from('requests').insert({ title: it.title, description: it.description || '', from_survey: it.id, requester: me.side === '우리' ? me.name : '' }).select(), '전환하지 못했습니다');
    await run(sb.from('survey').update({ converted_to: rows[0].id }).eq('id', it.id), '전환 표시를 남기지 못했습니다');
    reqs = [rows[0], ...reqs]; showTab('req'); openReq(rows[0].id);
  } catch (e) {}
}
$('sv-form').addEventListener('submit', async e => {
  e.preventDefault();
  const t = $('sv-title').value.trim(); if (!t) return;
  try { await run(sb.from('survey').insert({ title: t, description: $('sv-desc').value.trim() }), '추가하지 못했습니다'); $('sv-title').value = ''; $('sv-desc').value = ''; } catch (err) {}
});

/* ---------- 참여자 (관리자) ---------- */
function renderMembers() {
  const tb = $('mem-rows'); tb.replaceChildren();
  for (const m of members) tb.append(h('tr', { style: 'cursor:default' },
    h('td', null, m.name || '—'), h('td', { class: 'mono', style: 'font-size:13px' }, m.email),
    h('td', null, h('span', { class: 'side-badge' + (m.side === 'BMIT' ? ' bmit' : '') }, m.side === 'BMIT' ? 'BMIT' : '우리 측')),
    h('td', null, m.is_admin ? '관리자' : '참여자'),
    h('td', null, m.email === email ? h('span', { class: 'cat' }, '나') : confirmBtn('내보내기', '한 번 더', () => run(sb.from('members').delete().eq('email', m.email), '내보내지 못했습니다'), 'padding:4px 10px;font-size:12px'))));
}
$('mem-form').addEventListener('submit', async e => {
  e.preventDefault();
  const row = { email: $('m-email').value.trim().toLowerCase(), name: $('m-name').value.trim(), side: $('m-side').value, is_admin: $('m-admin').checked };
  try { await run(sb.from('members').upsert(row), '추가하지 못했습니다'); $('m-email').value = ''; $('m-name').value = ''; $('m-admin').checked = false; } catch (err) {}
});

/* ---------- 공통 ---------- */
function render() {
  renderStrip(); renderRows(); renderSurvey(); renderMembers();
  $('cnt-req').textContent = reqs.length; $('cnt-sv').textContent = items.length; $('cnt-mem').textContent = members.length;
  $('tab-mem').hidden = !isAdmin();
  if (!$('panel').hidden && !creating && !dirty && !$('panel').contains(document.activeElement)) renderPanel();
}
function showTab(t) {
  for (const k of ['req', 'sv', 'mem']) { $('tab-' + k).setAttribute('aria-selected', String(k === t)); $('view-' + k).hidden = k !== t; }
  try { localStorage.setItem('bmit-tab', t); } catch (e) {}
}
$('tab-req').onclick = () => showTab('req');
$('tab-sv').onclick = () => showTab('sv');
$('tab-mem').onclick = () => showTab('mem');
$('q').addEventListener('input', e => { query = e.target.value; renderRows(); });
$('new-req').onclick = newReq;
$('scrim').onclick = closePanel;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('panel').hidden) closePanel(); });

async function enter(session) {
  if (!session) {
    me = null; email = ''; loaded = false;
    if (channel) { sb.removeChannel(channel); channel = null; }
    $('view-app').hidden = true; $('view-login').hidden = false; closePanel();
    return;
  }
  email = (session.user.email || '').toLowerCase();
  const { data, error } = await sb.from('members').select('*').eq('email', email).maybeSingle();
  if (error || !data) {
    await sb.auth.signOut();
    $('l-err').textContent = '등록되지 않은 이메일입니다. 관리자에게 참여자 등록을 요청해 주세요.';
    return;
  }
  me = data;
  $('who').textContent = (me.name || email) + (me.side === 'BMIT' ? ' (BMIT)' : '') + ' 님';
  $('view-login').hidden = true; $('view-app').hidden = false;
  let tab = 'req'; try { tab = localStorage.getItem('bmit-tab') || 'req'; } catch (e) {}
  showTab(tab === 'mem' && !me.is_admin ? 'req' : tab);
  render(); await loadAll(); subscribe();
}

(function start() {
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || /YOUR_/.test(cfg.supabaseUrl) || !window.supabase) {
    $('view-login').hidden = false;
    $('l-err').textContent = '사이트 설정(config.js)이 아직 끝나지 않았습니다.';
    $('l-submit').disabled = true;
    return;
  }
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  let current = undefined;
  sb.auth.onAuthStateChange((_evt, session) => {
    const id = session ? session.user.id : null;
    if (id === current) return;
    current = id;
    setTimeout(() => enter(session), 0);
  });
})();
