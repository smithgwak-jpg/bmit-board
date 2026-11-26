// 서버 함수 호출과 접속 코드 보관 (메인 화면과 스캐너가 같이 씀)
const API = (window.LABEL_CONFIG || {}).apiUrl;
const CODE_KEY = "labelScannerCode";
let accessCode = ""; try { accessCode = localStorage.getItem(CODE_KEY) || ""; } catch {}
async function api(action, payload){
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", "x-access-code": accessCode }, body: JSON.stringify({ action, ...payload }) });
  let out = {}; try { out = await res.json(); } catch {}
  if (!res.ok) { const e = new Error(out.message || ("오류 " + res.status)); e.code = out.error || "http_" + res.status; throw e; }
  return out;
}
