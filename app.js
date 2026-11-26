'use strict';
const STATUSES = ['요청', '검토', '진행', '완료', '보류'];
const SCOLOR = { '요청': 'var(--s-req)', '검토': 'var(--s-rev)', '진행': 'var(--s-prog)', '완료': 'var(--s-done)', '보류': 'var(--s-hold)' };
const PRIOS = ['상', '중', '하'];
const ORG = { '우리': '장학문구사', 'BMIT': '비엠아이티' };
const orgLabel = (side, team) => (ORG[side] || ORG['우리']) + (team ? ' ' + team : '');
const myRequester = () => me && me.side === '우리' ? [me.team, me.name].filter(Boolean).join(' ') : '';
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
let toastTimer = null;
function toast(msg, bad) {
  let t = $('toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = 'toast' + (bad ? ' bad' : ''); }, bad ? 6000 : 2500);
}
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
// 아이디 저장, 로그인 상태 유지 (비밀번호 자체는 저장하지 않고, 저장은 브라우저 비밀번호 관리자에 맡김)
const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} } };
const keepLogin = () => ls.get('bmit-keep') !== '0';
const authStorage = {
  getItem(k) { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch (e) { return null; } },
  setItem(k, v) { try { if (keepLogin()) { localStorage.setItem(k, v); sessionStorage.removeItem(k); } else { sessionStorage.setItem(k, v); localStorage.removeItem(k); } } catch (e) {} },
  removeItem(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) {} },
};
(() => {
  const saved = ls.get('bmit-email');
  $('l-save-id').checked = !!saved;
  if (saved) $('l-email').value = saved;
  $('l-keep').checked = keepLogin();
})();
$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const em = $('l-email').value.trim().toLowerCase(), pw = $('l-pw').value;
  $('l-err').textContent = '';
  ls.set('bmit-email', $('l-save-id').checked ? em : null);
  ls.set('bmit-keep', $('l-keep').checked ? null : '0');
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
  if (error) { note(failMsg + ': ' + errMsg(error)); toast(failMsg + ': ' + errMsg(error), true); throw error; }
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
    tb.append(h('tr', { class: r.hidden ? 'hid' : null, tabindex: '0', onclick: () => openReq(r.id), onkeydown: e => { if (e.key === 'Enter') openReq(r.id); } },
      h('td', { class: 'mono' }, code(r.no)),
      h('td', null, h('div', { class: 'ttl' }, r.hidden ? h('span', { class: 'hid-tag' }, '임시저장') : null, r.title, photoCount(r) ? h('span', { class: 'badge' }, '첨부 ' + photoCount(r)) : null), r.category ? h('div', { class: 'cat' }, r.category) : null),
      h('td', null, h('span', { class: 'pill st-' + r.status }, r.status)),
      h('td', null, h('span', { class: 'pr pr-' + r.priority }, r.priority)),
      h('td', null, r.requester || '—'),
      h('td', null, r.assignee || h('span', { style: 'color:var(--muted)' }, '미지정')),
      h('td', { class: 'mono' }, r.requested_at || '—'),
      h('td', { class: 'due mono' + (dd && dd.over ? ' over' : '') }, r.due_at || '—', dd ? h('small', null, dd.t) : null),
      h('td', { class: 'mono' }, cc || '—')));
  }
}

/* ---------- 사진 ---------- */
const BUCKET = 'attachments';
const urlCache = {};
async function signUrls(paths) {
  const need = paths.filter(p => !urlCache[p]);
  if (!need.length) return;
  const { data } = await sb.storage.from(BUCKET).createSignedUrls(need, 3600);
  (data || []).forEach(d => { if (d.signedUrl) urlCache[d.path] = d.signedUrl; });
}
function thumbs(paths, onRemove) {
  const box = h('div', { class: 'thumbs' });
  const items = paths.map(p => {
    const img = h('img', { alt: '첨부 사진', loading: 'lazy' });
    const a = h('a', { href: '#', class: 'thumb-link', title: '크게 보기', onclick: ev => { ev.preventDefault(); lightbox(paths, paths.indexOf(p)); } }, img);
    const wrap = h('div', { class: 'thumb' }, a, onRemove ? h('button', { type: 'button', class: 'x', 'aria-label': '사진 빼기', onclick: () => { onRemove(p); wrap.remove(); } }, '×') : null);
    box.append(wrap);
    return () => { if (urlCache[p]) { img.src = urlCache[p]; a.href = urlCache[p]; } };
  });
  signUrls(paths).then(() => items.forEach(f => f())).catch(() => {});
  return box;
}
function lightbox(paths, start) {
  let i = start;
  const img = h('img', { alt: '첨부 사진' });
  const count = h('span', { class: 'lb-count' });
  const show = () => { img.src = urlCache[paths[i]] || ''; count.textContent = paths.length > 1 ? (i + 1) + ' / ' + paths.length : ''; open.href = urlCache[paths[i]] || '#'; };
  const move = d => { i = (i + d + paths.length) % paths.length; show(); };
  const close = () => { box.remove(); document.removeEventListener('keydown', key, true); };
  const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } else if (e.key === 'ArrowRight') move(1); else if (e.key === 'ArrowLeft') move(-1); };
  const open = h('a', { class: 'lb-btn', target: '_blank', rel: 'noopener', title: '새 창에서 원본 보기' }, '원본');
  const box = h('div', { class: 'lightbox', onclick: e => { if (e.target === box || e.target === stage) close(); } },
    h('div', { class: 'lb-bar' }, count, h('span', { style: 'flex:1' }), open, h('button', { type: 'button', class: 'lb-btn', onclick: close }, '닫기 ✕')));
  const stage = h('div', { class: 'lb-stage' }, img);
  box.append(stage);
  if (paths.length > 1) box.append(h('button', { type: 'button', class: 'lb-nav prev', 'aria-label': '이전 사진', onclick: () => move(-1) }, '‹'), h('button', { type: 'button', class: 'lb-nav next', 'aria-label': '다음 사진', onclick: () => move(1) }, '›'));
  document.body.append(box); document.addEventListener('keydown', key, true);
  signUrls(paths).then(show).catch(() => {}); show();
}
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.5e6) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch (e) { return file; }
}
async function uploadImages(rid, files) {
  const out = [];
  for (const f0 of files) {
    const f = await shrink(f0);
    if (f.size > 10e6) { note('10MB가 넘는 사진은 올릴 수 없습니다: ' + f0.name); continue; }
    const ext = ((f.type.split('/')[1]) || 'jpg').replace('jpeg', 'jpg');
    const path = rid + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    const { error } = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type });
    if (error) { note('사진을 올리지 못했습니다: ' + errMsg(error)); throw error; }
    out.push(path);
  }
  return out;
}
const FILE_EXT = /\.(pdf|xlsx?|xlsm|csv|docx?|pptx?|hwpx?|zip|txt)$/i;
const isImg = f => /^image\/(png|jpeg|gif|webp)$/.test(f.type);
const fmtSize = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1e3)) + 'KB';
function picker(label, markDirty, any) {
  const files = [];
  const list = h('div', { class: 'thumbs' });
  const flist = h('div', { class: 'files' });
  const add = fs => {
    for (const f of fs) {
      const img = isImg(f);
      if (!img && !(any && FILE_EXT.test(f.name))) { if (any || !f.type.startsWith('image/')) toast((any ? '올릴 수 없는 형식입니다: ' : '사진만 올릴 수 있습니다: ') + f.name, true); continue; }
      if (f.size > (img ? 40e6 : 20e6)) { toast('파일이 너무 커서 올릴 수 없습니다(20MB까지): ' + f.name, true); continue; }
      files.push(f);
      const drop = () => { files.splice(files.indexOf(f), 1); chip.remove(); };
      let chip;
      if (img) {
        const url = URL.createObjectURL(f);
        chip = h('div', { class: 'thumb pending' }, h('img', { src: url, alt: '올릴 사진' }),
          h('button', { type: 'button', class: 'x', 'aria-label': '사진 빼기', onclick: () => { drop(); URL.revokeObjectURL(url); } }, '×'));
        list.append(chip);
      } else {
        chip = h('div', { class: 'file pending' }, h('span', { class: 'fi' }, extOf(f.name)), h('span', { class: 'fn' }, f.name), h('span', { class: 'fs' }, fmtSize(f.size)),
          h('button', { type: 'button', class: 'fx', 'aria-label': '파일 빼기', onclick: drop }, '×'));
        flist.append(chip);
      }
      if (markDirty) dirty = true;
    }
  };
  const inp = h('input', { type: 'file', accept: any ? null : 'image/*', multiple: true, hidden: true, onchange: e => { add([...e.target.files]); e.target.value = ''; } });
  const el = h('div', { class: 'picker' }, h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: () => inp.click() }, label),
    h('span', { class: 'cat' }, any ? '사진, 엑셀, PDF, 한글, 워드 등 · 끌어다 놓기 · Ctrl+V' : '또는 사진을 끌어다 놓기 · Ctrl+V'), inp), list, flist);
  return { el, files, add, clear() { files.length = 0; list.replaceChildren(); flist.replaceChildren(); } };
}
const extOf = name => ((name.match(/\.(\w+)$/) || [])[1] || 'FILE').toUpperCase().slice(0, 4);
const fileName = entry => { const i = entry.indexOf('|'); return i < 0 ? entry.split('/').pop() : entry.slice(i + 1); };
const filePath = entry => entry.split('|')[0];
function fileList(entries, onRemove) {
  const box = h('div', { class: 'files' });
  for (const e of entries) {
    const name = fileName(e);
    const a = h('a', { href: '#', class: 'file', title: name + ' 내려받기', onclick: async ev => {
      ev.preventDefault();
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(filePath(e), 600, { download: name });
      if (error) { toast('파일을 열지 못했습니다: ' + errMsg(error), true); return; }
      location.href = data.signedUrl;
    } }, h('span', { class: 'fi' }, extOf(name)), h('span', { class: 'fn' }, name), h('span', { class: 'fs' }, '내려받기'));
    const wrap = onRemove ? h('div', { class: 'file-wrap' }, a, h('button', { type: 'button', class: 'fx', 'aria-label': '파일 빼기', onclick: () => { onRemove(e); wrap.remove(); } }, '×')) : a;
    box.append(wrap);
  }
  return box;
}
async function uploadAll(rid, files) {
  const imgs = files.filter(isImg), others = files.filter(f => !isImg(f));
  const out = { images: await uploadImages(rid, imgs), files: [] };
  for (const f of others) {
    const ext = (f.name.match(/\.(\w+)$/) || [, 'bin'])[1].toLowerCase();
    const path = rid + '/f-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    const { error } = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream' });
    if (error) { note('파일을 올리지 못했습니다: ' + errMsg(error)); toast('파일을 올리지 못했습니다: ' + f.name + ' (' + errMsg(error) + ')', true); throw error; }
    out.files.push(path + '|' + f.name.replace(/\|/g, '_'));
  }
  return out;
}
function dropzone(el, add) {
  const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  el.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; el.classList.add('drop'); });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop'); });
  el.addEventListener('drop', e => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); el.classList.remove('drop'); add([...e.dataTransfer.files]); });
  return el;
}
// 칸 밖에 떨어뜨려도 브라우저가 사진 파일을 열어 화면이 바뀌지 않게
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());
const pastedImages = e => [...((e.clipboardData && e.clipboardData.files) || [])].filter(f => f.type.startsWith('image/'));
function photoCount(r) {
  return (r.images_before || []).length + (r.images_after || []).length + (r.files || []).length +
    comments.filter(c => c.request_id === r.id).reduce((n, c) => n + (c.images || []).length + (c.files || []).length, 0);
}

/* ---------- 상세 패널 ---------- */
let photoSlots = null, attachSlot = null;
const field = (label, el) => h('label', { class: 'f' }, label, el);
const BMIT_STAFF = ['허미라 책임', '함만식 수석'];
function asgSelect(val) {
  const names = [...BMIT_STAFF];
  for (const m of members) if (m.side === 'BMIT' && m.name && !names.some(n => n.startsWith(m.name))) names.push(m.name);
  if (val && !names.includes(val)) names.push(val);
  const s = h('select', { id: 'p-asg', onchange: () => { dirty = true; } }, h('option', { value: '' }, '미정'));
  for (const n of names) s.append(h('option', { value: n, selected: n === val }, n));
  return s;
}
function sel(id, opts, val) { const s = h('select', { id, onchange: () => { dirty = true; } }); for (const o of opts) s.append(h('option', { value: o, selected: o === val }, o)); return s; }
function openReq(id) { openId = id; creating = false; dirty = false; renderPanel(); }
function newReq() { openId = null; creating = true; dirty = false; renderPanel(); }
function closePanel() { openId = null; creating = false; dirty = false; $('panel').hidden = true; $('scrim').hidden = true; }
function renderPanel() {
  const blank = { title: '', category: '', status: '요청', priority: '중', requester: myRequester(), assignee: '허미라 책임', requested_at: today(), due_at: '', description: '' };
  const r = creating ? blank : reqs.find(x => x.id === openId);
  if (!r) { closePanel(); return; }
  const slot = (key, title, hint) => {
    const kept = [...(r[key] || [])];
    const pick = picker('사진 추가', true);
    const el = h('div', { class: 'slot', onpaste: e => { const fs = pastedImages(e); if (fs.length) { e.preventDefault(); pick.add(fs); } } },
      h('div', { class: 'slot-head' }, h('b', null, title), h('span', { class: 'cat' }, hint)),
      kept.length ? thumbs(kept, p => { kept.splice(kept.indexOf(p), 1); dirty = true; }) : null,
      pick.el);
    dropzone(el, pick.add);
    return { key, kept, pick, el };
  };
  const attach = (() => {
    const kept = [...(r.files || [])];
    const pick = picker('파일 첨부', true, true);
    const el = h('div', { class: 'slot attach' }, h('div', { class: 'slot-head' }, h('b', null, '첨부 파일'), h('span', { class: 'cat' }, '기획서, 엑셀, PDF 등')),
      kept.length ? fileList(kept, e => { kept.splice(kept.indexOf(e), 1); dirty = true; }) : null, pick.el);
    dropzone(el, pick.add);
    return { kept, pick, el };
  })();
  attachSlot = attach;
  photoSlots = { before: slot('images_before', '변경 전', '지금 화면, 문제 상황'), after: slot('images_after', '변경 후', '원하는 모습, 완료 결과') };
  const inp = (id, v, type = 'text', extra = {}) => h('input', Object.assign({ id, type, value: v || '', oninput: () => { dirty = true; } }, extra));
  const saveMsg = h('span', { class: 'saved' });
  const form = h('form', { style: 'display:flex;flex-direction:column;gap:12px', onsubmit: e => { e.preventDefault(); saveReq(e.submitter && e.submitter.dataset.hide === '1'); } },
    field('요청 제목', inp('p-title', r.title, 'text', { required: true, maxlength: 200, placeholder: '예: 회원가입 화면 휴대폰 인증 추가' })),
    h('div', { class: 'grid2' },
      field('상태', sel('p-status', STATUSES, r.status)),
      field('우선순위', sel('p-prio', PRIOS, r.priority)),
      field('분류', inp('p-cat', r.category, 'text', { list: 'cats', placeholder: '기능 개선 / 오류 수정 / 신규 개발' })),
      field('요청자 (장학문구사)', inp('p-req', r.requester, 'text', { placeholder: '부서 또는 이름' })),
      field('BMIT 담당', asgSelect(r.assignee)),
      h('div'),
      field('요청일', inp('p-reqat', r.requested_at, 'date')),
      field('기한', inp('p-due', r.due_at, 'date'))),
    field('상세 내용', dropzone(h('textarea', { id: 'p-desc', class: 'big', oninput: () => { dirty = true; }, onpaste: e => { const fs = pastedImages(e); if (fs.length) { e.preventDefault(); photoSlots.before.pick.add(fs); } }, placeholder: '배경, 원하는 결과, 참고 화면 등을 자세히 적어 주세요. 화면 캡처를 붙여넣거나(Ctrl+V) 사진을 끌어다 놓으면 변경 전 사진으로 올라갑니다.' }, r.description || ''), fs => photoSlots.before.pick.add(fs))),
    h('div', { class: 'photo-slots' }, photoSlots.before.el, photoSlots.after.el),
    attach.el,
    field('참고 링크 (한 줄에 하나씩)', h('textarea', { id: 'p-links', class: 'links', oninput: () => { dirty = true; }, placeholder: 'https://… 참고 사이트, 기획 문서, 디자인 시안 주소' }, (r.links || []).join('\n'))),
    (r.links || []).length ? h('div', { class: 'linklist' }, r.links.map(u => /^https?:\/\//i.test(u) ? h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, u) : h('span', null, u))) : null,
    h('datalist', { id: 'cats' }, CATS.map(c => h('option', { value: c }))),
    h('div', { class: 'row end' },
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'submit', 'data-hide': '0' }, creating ? '요청 등록' : r.hidden ? '공개하고 저장' : '변경 저장'),
        isOurs() ? h('button', { class: 'btn', type: 'submit', 'data-hide': '1', title: '비엠아이티에는 보이지 않게 저장합니다' }, creating || r.hidden ? '임시저장' : '숨기기') : null,
        saveMsg),
      !creating && isAdmin() ? delBtn(r) : null));
  const body = h('div', { class: 'p-body' }, r.hidden ? h('div', { class: 'hidden-note' }, '임시저장(숨김) 상태입니다. 장학문구사 참여자만 보고, 비엠아이티에는 보이지 않습니다. 다 쓰면 "공개하고 저장"을 눌러 주세요.') : null, form);
  if (!creating) {
    if (r.updated_at) body.append(h('div', { class: 'cat' }, '마지막 수정 ' + fmtTime(r.updated_at) + (r.updated_by ? ' · ' + nameOf(r.updated_by) : '')));
    body.append(h('h3', { class: 'sec' }, '협의 기록'));
    const cs = comments.filter(c => c.request_id === r.id);
    if (!cs.length) body.append(h('div', { class: 'cat' }, '아직 기록이 없습니다. 회의 내용, 견적, 일정 변경 등을 남겨 두세요.'));
    for (const c of cs) body.append(h('div', { class: 'cm' + (c.side === 'BMIT' ? ' bmit' : '') },
      h('div', { class: 'meta' }, h('span', { class: 'side' }, orgLabel(c.side, c.author_team)), h('span', null, c.author_name || c.author_email), h('span', { class: 'mono' }, fmtTime(c.created_at)),
        c.author_email === email || isAdmin() ? cmDel(c) : null),
      c.body ? h('div', { class: 'txt' }, c.body) : null,
      (c.images || []).length ? thumbs(c.images) : null,
      (c.files || []).length ? fileList(c.files) : null));
    const cpick = picker('파일·사진 첨부', false, true);
    const ta = h('textarea', { id: 'cm-body', placeholder: '협의 내용, 질문, 답변을 남겨 주세요. 캡처 붙여넣기(Ctrl+V)나 사진 끌어다 놓기로도 첨부됩니다.', maxlength: 4000,
      onpaste: e => { const fs = pastedImages(e); if (fs.length) { e.preventDefault(); cpick.add(fs); } } });
    body.append(dropzone(h('form', { class: 'cm-form', onsubmit: e => { e.preventDefault(); addComment(r.id, ta, cpick, e.submitter); } },
      field('기록 추가', ta), cpick.el,
      h('div', { class: 'row end' },
        h('span', { class: 'cat' }, orgLabel(me.side, me.team) + ' · ' + (me.name || email) + '(으)로 남겨집니다'),
        h('button', { class: 'btn primary', type: 'submit' }, '기록 남기기'))), cpick.add));
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
const isOurs = () => !!(me && me.side === '우리');
async function saveReq(hide) {
  const v = id => $(id).value.trim();
  const data = { title: v('p-title'), category: v('p-cat'), status: $('p-status').value, priority: $('p-prio').value,
    requester: v('p-req'), assignee: v('p-asg'), requested_at: $('p-reqat').value || null, due_at: $('p-due').value || null, description: $('p-desc').value,
    hidden: !!hide,
    links: $('p-links').value.split('\n').map(x => x.trim()).filter(Boolean).map(x => /^[\w.-]+\.[a-z]{2,}/i.test(x) && !/^https?:/i.test(x) ? 'https://' + x : x).slice(0, 20) };
  if (!data.title) return;
  const slots = photoSlots;
  const busy = slots.before.pick.files.length + slots.after.pick.files.length + attachSlot.pick.files.length;
  const btn = $('panel').querySelector('form button[data-hide="' + (hide ? 1 : 0) + '"]');
  const label = btn ? btn.textContent : '';
  const wasNew = creating;
  if (btn) { btn.disabled = true; btn.textContent = busy ? '사진 올리는 중…' : '저장 중…'; }
  try {
    let id = openId;
    if (creating) {
      const rows = await run(sb.from('requests').insert(data).select(), '등록하지 못했습니다');
      id = rows[0].id; reqs = [rows[0], ...reqs]; creating = false; openId = id;
    }
    const upd = {};
    for (const s of [slots.before, slots.after]) upd[s.key] = [...s.kept, ...await uploadImages(id, s.pick.files)];
    const att = await uploadAll(id, attachSlot.pick.files);
    if (att.images.length) upd.images_before = [...upd.images_before, ...att.images];
    upd.files = [...attachSlot.kept, ...att.files];
    await run(sb.from('requests').update(Object.assign(data, upd)).eq('id', id), '저장하지 못했습니다');
    const i = reqs.findIndex(x => x.id === id); if (i >= 0) reqs[i] = Object.assign({}, reqs[i], data);
    dirty = false; closePanel(); render();
    toast(hide ? (wasNew ? '임시저장했습니다 (비엠아이티에는 안 보임)' : '숨겼습니다 (비엠아이티에는 안 보임)') : wasNew ? '요청을 등록했습니다' : '저장했습니다');
  } catch (e) { if (btn) { btn.disabled = false; btn.textContent = label; } }
}
async function addComment(rid, ta, pick, btn) {
  const body = ta.value.trim(); if (!body && !pick.files.length) return;
  if (btn) { btn.disabled = true; btn.textContent = '올리는 중…'; }
  try {
    const up = await uploadAll(rid, pick.files);
    await run(sb.from('comments').insert(Object.assign({ request_id: rid, body, images: up.images }, up.files.length ? { files: up.files } : {})), '기록을 남기지 못했습니다');
    ta.value = ''; pick.clear(); toast('기록을 남겼습니다');
    if (document.activeElement) document.activeElement.blur();
  } catch (e) {} finally { if (btn) { btn.disabled = false; btn.textContent = '기록 남기기'; } }
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
    const rows = await run(sb.from('requests').insert({ title: it.title, description: it.description || '', from_survey: it.id, requester: myRequester() }).select(), '전환하지 못했습니다');
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
  members.forEach((m, i) => tb.append(h('tr', { style: 'cursor:default' },
    h('td', { class: 'mono' }, i + 1),
    h('td', null, m.name || '—'), h('td', { class: 'mono', style: 'font-size:13px' }, m.email),
    h('td', null, h('span', { class: 'side-badge' + (m.side === 'BMIT' ? ' bmit' : '') }, orgLabel(m.side, m.team))),
    h('td', null, m.is_admin ? '관리자' : '참여자'),
    h('td', null, m.email === email ? h('span', { class: 'cat' }, '나') : confirmBtn('내보내기', '한 번 더', () => run(sb.from('members').delete().eq('email', m.email), '내보내지 못했습니다'), 'padding:4px 10px;font-size:12px')))));
}
$('mem-form').addEventListener('submit', async e => {
  e.preventDefault();
  const row = { email: $('m-email').value.trim().toLowerCase(), name: $('m-name').value.trim(), side: $('m-side').value, team: $('m-team').value.trim(), is_admin: $('m-admin').checked };
  if (row.email === email) row.is_admin = true;
  try { await run(sb.from('members').upsert(row), '추가하지 못했습니다'); $('m-email').value = ''; $('m-name').value = ''; $('m-team').value = ''; $('m-admin').checked = false; } catch (err) {}
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
  $('who').textContent = (me.name || email) + ' (' + orgLabel(me.side, me.team) + ')' + ' 님';
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
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { storage: authStorage, persistSession: true, autoRefreshToken: true } });
  let current = undefined;
  sb.auth.onAuthStateChange((_evt, session) => {
    const id = session ? session.user.id : null;
    if (id === current) return;
    current = id;
    setTimeout(() => enter(session), 0);
  });
})();
