// 로그인과 서버 함수 호출 (메인 화면과 스캐너가 같이 씀)
const CFG = window.LABEL_CONFIG || {};
const sbc = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);

async function api(action, payload){
  const { data } = await sbc.auth.getSession();
  const token = data.session ? data.session.access_token : "";
  const res = await fetch(CFG.apiUrl, { method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
    body: JSON.stringify({ action, ...(payload || {}) }) });
  let out = {}; try { out = await res.json(); } catch {}
  if (!res.ok) { const e = new Error(out.message || ("오류 " + res.status)); e.code = out.error || "http_" + res.status; throw e; }
  return out;
}

// 로그인 화면. 페이지의 #app을 숨기고 로그인 카드를 띄웁니다.
const Gate = {
  onReady: null,
  el: null,
  build(){
    if (this.el) return this.el;
    const wrap = document.createElement("div"); wrap.className = "wrap"; wrap.hidden = true;
    wrap.innerHTML = `
      <section class="card gate">
        <h2>로그인</h2>
        <p class="hint" id="gateHint">등록된 이메일로 들어오세요. 처음이면 비밀번호 만들기를 눌러 비밀번호를 정합니다.</p>
        <form id="gateForm" style="display:flex;flex-direction:column;gap:10px">
          <input id="gEmail" type="email" autocomplete="username" placeholder="이메일" required>
          <input id="gPw" type="password" autocomplete="current-password" placeholder="비밀번호 (6자 이상)" minlength="6" required>
          <button class="primary" type="submit" id="gLogin">로그인</button>
          <button type="button" id="gSignup">처음이에요, 비밀번호 만들기</button>
        </form>
        <div class="status" id="gateStatus" role="status"></div>
      </section>`;
    document.body.prepend(wrap);
    const st = wrap.querySelector("#gateStatus");
    const say = (m, err) => { st.textContent = m || ""; st.classList.toggle("err", !!err); };
    const creds = () => ({ email: wrap.querySelector("#gEmail").value.trim().toLowerCase(), password: wrap.querySelector("#gPw").value });
    wrap.querySelector("#gateForm").addEventListener("submit", async e => {
      e.preventDefault(); say("확인하는 중…");
      const { error } = await sbc.auth.signInWithPassword(creds());
      if (error) return say("이메일이나 비밀번호가 맞지 않아요. 처음이면 '비밀번호 만들기'를 누르세요.", true);
      say(""); this.hide(); this.onReady && this.onReady();
    });
    wrap.querySelector("#gSignup").addEventListener("click", async () => {
      const c = creds();
      if (!c.email || c.password.length < 6) return say("이메일과 6자 이상 비밀번호를 입력하세요.", true);
      say("만드는 중…");
      const { data, error } = await sbc.auth.signUp(c);
      if (error) {
        const m = /registered|already/i.test(error.message) ? "이미 비밀번호가 있는 이메일이에요. 로그인을 누르세요."
          : /등록되지 않은|Database error/i.test(error.message) ? "등록되지 않은 이메일이에요. 관리자에게 등록을 요청하세요."
          : "만들지 못했어요. (" + error.message + ")";
        return say(m, true);
      }
      if (!data.session) return say("가입은 됐지만 이메일 확인이 필요해요. 관리자에게 알려 주세요.", true);
      say(""); this.hide(); this.onReady && this.onReady();
    });
    this.el = wrap; return wrap;
  },
  show(msg){
    this.build(); const app = document.getElementById("app"); if (app) app.hidden = true;
    this.el.hidden = false;
    const st = this.el.querySelector("#gateStatus"); st.textContent = msg || ""; st.classList.toggle("err", !!msg);
    this.el.querySelector("#gEmail").focus();
  },
  hide(){ if (this.el) this.el.hidden = true; const app = document.getElementById("app"); if (app) app.hidden = false; },
  async start(onReady){
    this.onReady = onReady;
    const { data } = await sbc.auth.getSession();
    if (!data.session) return this.show();
    this.hide(); onReady();
  },
  async signOut(){ await sbc.auth.signOut(); this.show(); },
};
