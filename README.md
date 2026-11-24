# 비엠아이티 개발협의 현황

비엠아이티(BMIT)에 요청한 개발 건의 진행 상황, 협의 기록, 수요조사를 함께 보는 웹사이트입니다.

- **요청 현황**: 상태(요청/검토/진행/완료/보류)별 건수, 요청 목록, 기한 D-day, 건별 협의 기록
- **수요조사**: 아이디어 등록, "필요해요" 투표, 정식 요청으로 전환
- **참여자** (관리자만): 들어올 수 있는 이메일과 소속(우리 측 / BMIT) 관리

구성은 단순한 정적 사이트(HTML, CSS, JS)이고, 로그인과 데이터 저장은 Supabase, 호스팅은 Vercel을 씁니다. 빌드 과정이 없습니다.

## 처음 설치하기

### 1. Supabase (데이터베이스와 로그인)

1. https://supabase.com 에 가입하고 **New project**를 만듭니다. Region은 `Northeast Asia (Seoul)`을 고릅니다.
2. 왼쪽 메뉴 **SQL Editor**를 열고 `supabase/schema.sql` 내용을 통째로 붙여넣습니다.
   맨 아래 `YOUR_EMAIL@example.com`과 `관리자 이름`을 본인 것으로 바꾼 뒤 **Run**을 누릅니다.
3. **Authentication → Sign In / Providers → Email**에서 **Confirm email**을 끕니다.
   (Supabase 기본 메일 발송은 외부 주소로 잘 가지 않아서, 비밀번호 방식으로 바로 가입되게 합니다. 등록되지 않은 이메일은 DB에서 가입을 막습니다.)
4. **Project Settings → API**에서 `Project URL`과 `anon public` 키를 복사해 `config.js`에 넣습니다.
   `service_role` 키는 절대 넣지 마세요.

### 2. Vercel (사이트 올리기)

1. https://vercel.com 에 GitHub 계정으로 가입합니다.
2. **Add New → Project**에서 이 저장소를 Import 하고, 설정은 그대로 두고 **Deploy**를 누릅니다.
3. 배포된 주소(`…vercel.app`)로 들어가 로그인 화면이 나오면 성공입니다.

### 3. 회사 도메인 연결

1. Vercel 프로젝트의 **Settings → Domains**에서 쓸 주소(예: `bmit.회사도메인.com`)를 추가합니다.
2. Vercel이 알려주는 DNS 값을 도메인 관리 화면(가비아, 카페24 등)에 추가합니다. 보통 아래와 같습니다.
   - 종류 `CNAME`, 호스트 `bmit`, 값 `cname.vercel-dns.com`
3. 몇 분에서 몇 시간 뒤 주소가 열리고, HTTPS 인증서는 Vercel이 자동으로 붙입니다.
4. Supabase **Authentication → URL Configuration**의 Site URL을 새 주소로 바꿉니다.

## 사용하기

1. 관리자가 **참여자** 탭에서 BMIT 담당자의 이메일, 이름, 소속(BMIT)을 등록합니다.
2. 담당자에게 사이트 주소를 보내면, 담당자는 **비밀번호 만들기**로 처음 한 번 비밀번호를 정하고 들어옵니다.
3. 협의 기록은 작성자의 이름과 소속이 자동으로 붙습니다.

비밀번호를 잊은 사람은 Supabase **Authentication → Users**에서 해당 사용자를 지운 뒤 다시 **비밀번호 만들기**를 하게 하면 됩니다.

## 권한

| 할 수 있는 일 | 참여자 | 관리자 |
| --- | --- | --- |
| 요청 보기, 등록, 수정 | ✓ | ✓ |
| 협의 기록 남기기 | ✓ | ✓ |
| 내 기록, 내 수요 항목 지우기 | ✓ | ✓ |
| 요청 삭제, 다른 사람 기록 지우기 | | ✓ |
| 참여자 추가, 내보내기 | | ✓ |

권한은 브라우저가 아니라 Supabase의 RLS 정책(`supabase/schema.sql`)이 지킵니다.
