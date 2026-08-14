/* SMEAG StudyGround — service worker for full offline operation.
 *
 * Strategy:
 *   • App shell (HTML/CSS/JS/icons/data) is precached on install → instant offline.
 *   • Media (audio/images) is cached lazily on first play/view (cache-first), so
 *     the 12 MB of audio doesn't block install but is available offline once heard.
 *   • Navigation falls back to the cached page, then to index.html.
 */
// v4: SET 9 Listening M2 Q4-15 authored passages revised to rev3 and the four
//     set9-L2-*.mp3 regenerated at the SAME urls. The media cache is cache-first,
//     so without a version bump a returning device would keep serving the rev2
//     audio against rev3-corrected items. Bumping VERSION drops sg-media-sg-v3
//     in the activate handler and forces a re-fetch.
// v6: 시험 런타임 UI 를 녹화 프레임(docs/reference/screens/*) 기준으로 다시 맞췄다 —
//     exam.css / exam-runtime.html / exam-render-{instruction,listening,reading,writing,
//     speaking}.js 가 전부 바뀌었다. 이 파일들은 전부 SHELL_ASSETS(cache-first)라서
//     VERSION 을 올리지 않으면 재방문 기기가 옛 UI(빨간 중앙 pill 등)를 계속 본다.
// v9: 내부용 접근 게이트 추가(v53 에서 삭제). 모든 셸 HTML 의 <head> 가 바뀌었다.
// v10: 관리자 오디오 설정(admin-audio.html · assets/audio-config.js) 추가.
//      오프라인에서도 출제자가 문항별 오디오를 지정/미리듣기 할 수 있어야 하므로 프리캐시.
// v11: SET 별 관리자 계층 추가 — 관리자 로그인(assets/admin-session.js), 오디오
//      정지/일시정지 트랜스포트와 플로팅 바(assets/admin-bar.js — v18 에서 삭제), 문항 교체
//      스토어(assets/question-config.js), 오디오 목록(assets/audio-index.js),
//      그리고 두 관리자 화면(admin-audio-files.html · admin-questions.html).
//      set9.html / exam-runtime.html / tests.html / admin-audio.html 의 <script>
//      목록이 바뀌었으므로 VERSION 을 올려 셸 캐시를 새로 채운다.
// v12: 문항 스크립트 → 음성 생성. 서버리스 함수 api/tts.js (키는 Vercel 환경변수)와
//      클라이언트 assets/tts-client.js 추가. /api/* 는 프리캐시·런타임 캐시 모두 제외한다.
// v13: 대본↔오디오 대조 화면(admin-audio-sync.html)과 그 데이터
//      (config/audio-check.set9.json) 추가. 여러 셸 HTML 의 네비가 바뀌었다.
// v14: 회원 가입/로그인(Supabase Auth). assets/sg-auth.js 를 프리캐시에 넣고,
//      login.html · signup.html 과 네비가 있는 셸 HTML 의 <script> 목록이 바뀌었다.
//      인증 호출은 전부 POST 라 fetch 핸들러의 GET 필터에서 이미 걸러진다.
// v15: SET 9 리딩 진입 페이지(set9-reading.html) 추가 — set9.html 과 같은 셸이며
//      tests.html 카드에 링크가 붙었다.
// v16: 리딩 cloze 빈칸을 글자마다 끊어 그린다('_ _ _ _'). exam.css · exam-render-reading.js
//      가 함께 바뀌므로 캐시된 옛 CSS 와 새 렌더러가 섞이지 않도록 VERSION 을 올린다.
// v17: cloze 빈칸 밑줄을 다시 한 줄로 잇고 어간에 붙인다('popul______').
//      exam.css 만 바뀌지만 캐시된 옛 CSS 가 남으면 화면이 그대로라 VERSION 을 올린다.
// v18: 관리자 플로팅 바(assets/admin-bar.js) 삭제 — 오디오 트랜스포트·클립 즉시 교체를
//      걷어내고, 로그인 진입점(⚙ · Ctrl+Alt+A)만 assets/admin-entry.js 로 남긴다.
//      시험 셸 HTML 의 <script> 목록이 바뀌었으므로 VERSION 을 올려 캐시를 새로 채운다.
// v19: cloze 빈칸 — 칸은 끊어 보이되(자간 .1em) 어간에 붙여 한 낱말로 읽히게 하고,
//      낱말이 줄 끝에서 어간과 밑줄로 쪼개지지 않도록 nowrap 을 준다. exam.css 만 바뀐다.
// v20: SET 전체 열람(admin-set-view.html) · 관리자 변경 로그(admin-log.html ·
//      assets/admin-log.js) · 문항별 제한시간 오버라이드 추가.
// v21: cloze 빈칸이 잇달아 올 때 낱말 경계가 보이도록 빈칸 뒤에 낱말 간격(.34em)을 준다 —
//      칸 경계(.1em)보다 넓어야 'exper____ com___ soc__' 이 세 낱말로 읽힌다. exam.css 만 바뀐다.
// v22: 채점 리뷰 추가 — review.html(문항별 정오) · admin-results.html(선생님·관리자용
//      전체 학생 목록) · assets/sg-results.js 를 프리캐시에 넣는다. dashboard.html 이
//      예시 데이터 대신 실제 응시 기록을 그리고, exam-shell.js 가 제출 직후 채점·업로드를
//      하도록 바뀌었으므로 캐시된 옛 파일이 남으면 리뷰 문이 열리지 않는다.
// v23: 답안지 코멘트(선생님 · AI) — assets/sg-comments.js 추가, review.html 이 코멘트를
//      읽고(학생) 쓰고(선생님·관리자) AI 생성을 부른다. api/feedback.js 는 서버리스라
//      프리캐시 대상이 아니다(/api/* 는 fetch 핸들러에서 이미 제외).
// v24: QR 로그인 카드 — assets/sg-qr.js(자체 QR 인코더) 와 admin-qr.html(시험일별
//      카드 인쇄) 추가. login.html 은 스캔 버튼·#SG2 딥링크를, signup.html 은 발급된
//      아이디와 QR 을 그린다. 세 파일 모두 셸이라 VERSION 을 올려야 재방문 기기가
//      옛 화면(이메일·비밀번호 가입 폼)을 계속 보지 않는다.
// v25: 오프라인 사전 다운로드(assets/offline-prep.js · config/offline.set9.json). 미디어는
//      여전히 lazy cache-first 지만, 페이지가 열리면 그 SET 의 오디오 91개(25 MB)를 미리
//      끌어와 캐시에 넣는다. 셸 HTML 의 <script> 목록이 바뀌었고, 캐시 이름을 묻는
//      'sg-cache-names' 메시지 핸들러가 새로 생겼다.
// v26: 관리자 변경 로그를 Supabase(public.sg_admin_log)로 올린다 — assets/admin-log.js 가
//      기기 버퍼와 서버 합본 두 겹을 관리하고, admin-log.html 에 "이 기기 / 서버 합본"
//      토글이 생겼다. 문항 편집 화면은 화이트블루 바탕 + 어두운 편집 칸으로 바뀌었다.
// v27: 시험장 좌석 관리 — admin-seats.html(컴퓨터 1~30 의 연결 모드·코스·세트·문항·
//      오디오 배속·화면 언어 지정)과 저장소 assets/sg-seats.js, 그리고 흩어져 있던
//      관리자 화면을 한데 모은 admin.html 허브가 생겼다. 시험 당일 인터넷이 끊겨도
//      좌석 보드를 열 수 있어야 하므로 셋 다 셸에 넣는다.
// v28: 좌석 설정이 학생 화면까지 내려온다 — seat-setup.html(이 PC 는 몇 번인가)과
//      assets/seat-runtime.js(화면 언어 고정 · 시험 전용 모드 · 오디오 배속 · 좌석 배지).
//      login.html 은 배정된 시험으로 곧장 들어가고, exam-runtime.html · tests.html 의
//      <script> 목록이 바뀌었다.
// v29: 대본 대조 규칙을 공용 모듈로 뺐다 — assets/audio-script-check.js 를 프리캐시에
//      넣고, 이제 admin-audio-files.html · admin-audio-sync.html 둘 다 이 파일을 부른다.
//      두 화면의 <script> 목록이 바뀌었으므로 VERSION 을 올려 셸 캐시를 새로 채운다.
// v30: 등록의 주요 키가 학생아이디 · 이메일 · 이름 이 되었다. signup.html 이 이메일을
//      받고, login.html 은 아이디뿐 아니라 등록한 이메일로도 들어간다. admin-qr.html
//      카드에 이메일이 함께 찍힌다. 세 화면 모두 셸이라 VERSION 을 올려야 재방문
//      기기가 이메일 칸 없는 옛 폼을 계속 보지 않는다.
// v31: SET 9 짧은응답 화자 사진을 목소리 성별에 맞춰 다시 배정했다(assets/set9.js).
//      셸에 든 set9.js 가 바뀌었으므로 VERSION 을 올려야 재방문 기기가 남녀가
//      뒤바뀐 옛 배정을 계속 보지 않는다. 여성 얼굴 한 장(speaker-f)이 늘어
//      config/offline.set9.json 도 92개로 갱신되었다.
// v32: 화자 사진 맞추기 2차 — M2 강의 두 개(8-11 Oliver · 12-15 Henry)와 스피킹 Task 2
//      면접관까지 배역대로 바꿨다. 8-11 자리에는 남성 오디오에 여성 사진이, Task 2 에는
//      남성 오디오에 여성 면접관 캡처가 들어가 있었다. set9.js 가 또 바뀌어 판올림한다.
// v33: 제출하면 그 자리에서 채점한다 — exam-shell 이 AI 채점을 끝까지 기다리고
//      네 영역 밴드를 제출 화면에 편다. sg-band.js 가 시험 셸에도 실린다.
// v34: 영역별 문항 리뷰 모듈 — review.html 이 리스닝(assets/sg-review-listening.js)과
//      라이팅(assets/sg-review-writing.js)을 표 대신 문항 카드로 편다. 제출 직후
//      오프라인에서도 열려야 하므로 둘 다 셸에 넣고 VERSION 을 올린다.
// v35: 헤더가 "지금 누구로 들어와 있는지"를 말한다 — 계정 칩에 이름과 함께 로그인
//      아이디(smeag000)가 서고, 로그인 상태에서 남아 있던 Login/Sign Up 버튼이
//      제대로 접힌다. assets/sg-auth.js · assets/app.css 가 바뀌어 판올림한다.
// v36: 선생님은 자기 학생만 본다 — sg_profiles.teacher_id 와 RLS 의 sg_can_see() 가
//      열람 범위를 쥔다. signup.html 에 담당 선생님 드롭다운이 생겼고, 관리자용
//      admin-teachers.html(선생님 계정 만들기 · 담당 배정)이 추가됐다. sg-auth.js ·
//      admin-results.html · app.css 가 함께 바뀌어, 캐시된 옛 가입 폼이 남으면
//      담당 없이 등록됐다가 서버가 되돌려보낸다. 그래서 판올림한다.
// v37: 시험 중 Exit 은 관리자 승인이 있어야 열린다 — exam-shell.js 가 Exit 모달에
//      관리자 아이디·비밀번호 칸을 세우고 admin-session.js 의 verify() 로 확인한다
//      (세션은 만들지 않는다). exam.css 도 함께 바뀌므로, 캐시된 옛 셸이 남으면
//      학생이 그냥 나갈 수 있다. 그래서 판올림한다.
// v38: 미디어 캐시를 VERSION 에서 떼어 냈다. 여태 셸을 한 줄 고칠 때마다 미디어
//      캐시까지 통째로 버려져, 학생 기기가 25 MB 를 처음부터 다시 받았다. 이제
//      무엇이 바뀌었는지는 config/offline.set9.json 의 파일별 내용 해시가 가리고,
//      offline-prep.js 가 바뀐 파일만 다시 받는다(음성을 다시 생성해도 url 은
//      그대로라 주소만으로는 알 수 없다 — v4 가 VERSION 판올림으로 때우던 자리다).
//      이 판올림 한 번은 옛 sg-media-sg-v37 을 버리므로 마지막 전량 재수신이 있다.
//      config/offline.*.json 은 셸에 있어도 네트워크 우선으로 뺐다 — 목록까지
//      cache-first 로 붙들면 기기가 옛 목록을 보고 "최신"이라 답해 업데이트가
//      영영 도착하지 않는다. 오프라인이면 캐시된 목록으로 되돌아간다.
// v39: 스피킹도 문항 카드로 편다 — assets/sg-review-speaking.js 가 왼쪽에 들려준 것
//      (그림·원문·오디오)을, 오른쪽에 말한 것(녹음·전사)과 채점 근거를 세우고, 복창은
//      원문과 낱말 단위로 대조해 빠뜨림·덧붙임·바꿔 말함까지 보여 준다. set9.js 의
//      스피킹 문항에 들려준 문장(script)이 실렸다 — 이 값이 복창 채점의 원문이므로,
//      캐시된 옛 팩이 남으면 원문 없이 중앙값으로 채점되던 동작이 계속된다.
// v40: 스피킹은 응답 시간이 끝나면 스스로 넘어간다 — assets/exam-render-speaking.js 가
//      종료 안내만 띄운 채 Next 를 세우지 않고 다음 화면으로 간다(마이크 감시 문구도
//      함께 바뀌었다). 이 파일은 셸 자산이라 cache-first 다 — 판올림하지 않으면
//      재방문 기기가 캐시된 옛 렌더러의 Next 를 계속 보고, 누르지 않는 한 시험이
//      멈춰 선다. 그래서 판올림한다.
// v41: 녹음이 소리를 담았는지 그 자리에서 보인다 — exam-recorder.js 가 녹음 내내 입력
//      최대치를 재서 저장하고(peak·silent), exam-render-speaking.js 의 레벨 띠가 굵어지며
//      5초 넘게 아무것도 안 들어오면 말로 알린다. 리뷰 화면(sg-review-speaking.js ·
//      review.html)은 재생기 밑에 길이·용량·입력 최대치를 적는다. muted 트랙을 물고
//      있던 스트림도 버리고 다시 연다 — 길이만 있고 소리는 없는 파일의 원인이었다.
//      모두 셸 자산이라 판올림하지 않으면 재방문 기기가 옛 녹음기를 계속 쓴다.
// v42: 리딩 cloze 빈칸은 영어만 받는다 — exam-render-reading.js 가 ASCII 아닌 글자를
//      걷어내고(IME 조합이 끝난 뒤에) 입력칸에 lang="en" 을 준다. 한글 자판을 켠 채로
//      친 답이 그대로 저장돼 오답이 되던 자리다. 캐시된 옛 렌더러가 남으면 그대로라 판올림.
// v43: 학생은 로그인하는 순간 전체화면으로 들어가고, 시험 본문이 화면보다 길면
//      확대율을 낮춰 한 화면에 담는다 — assets/sg-fullscreen.js 를 새로 넣고 거의
//      모든 셸 HTML 의 <script> 목록이 바뀌었다(login.html 은 버튼을 누른 그 순간에
//      전체화면을 요청한다). 캐시된 옛 셸이 남으면 그 기기만 창 모드로 시험을 본다.
// v44: 학생 화면은 잠긴다 — assets/sg-fullscreen.js 가 전체화면이 풀리면 화면을 덮고,
//      오른쪽 클릭·F11·새로고침·새 탭·개발자 도구 단축키를 막는다. 창을 돌려받으려면
//      감독관이 관리자 아이디·비밀번호를 넣어야 하고(admin-session.js 의 verify —
//      학생 기기에 관리자 세션은 남지 않는다), 시험 셸의 전체화면 버튼도 같은 문을
//      지난다(assets/exam-shell.js). 캐시된 옛 셸이 남으면 그 기기만 잠기지 않는다.
// v45: 리딩도 문항 카드로 편다 — assets/sg-review-reading.js 가 왼쪽에 읽은 것(지문 ·
//      C-Test 문단 · 메신저 대화)을, 오른쪽에 고른 것과 정오를 세운다. 리딩에서 틀린
//      이유는 거의 늘 지문 안에 있어, 표 한 줄("내 답 C / 정답 A")로는 복기가 되지
//      않던 자리다. review.html · app.css 도 함께 바뀌었으므로, 캐시된 옛 셸이 남으면
//      그 기기만 리딩 탭에서 표를 계속 본다. 그래서 판올림한다.
// v46: 내려받은 사본이 자기가 낡은 줄을 안다 — assets/build-version.js(사본의 판
//      번호)와 assets/sg-update-check.js(라이브의 /version.json 과 대조)를 넣고,
//      index.html · tests.html 의 <script> 목록이 바뀌었다. 웹 사본에서는 검사기가
//      채널을 보고 그대로 물러난다(그 일은 이 서비스워커가 이미 한다). 캐시된 옛
//      셸이 남으면 그 기기만 판올림 알림 없는 화면을 계속 본다.
// v47: 시험이 끝난 자리에서 다시 친다 — 제출 화면에 전체 한 벌과 네 영역 버튼이 서고,
//      그 문은 관리자 승인이 있어야 열린다(assets/exam-shell.js · assets/exam.css).
//      캐시된 옛 셸이 남으면 그 기기만 끝난 화면에서 리뷰·성적 두 개만 계속 본다.
// v48: 시험 순서가 Reading · Listening · Writing · Speaking 로 선다
//      (config/timing.toefl.json 의 sectionOrder). 볼륨·마이크 준비 화면은 첫 섹션
//      앞이라는 자리를 지켜 리딩 앞으로 따라 옮겼다. 셸에 든 exam-timing.js ·
//      exam-compile.js · exam-shell.js 와 타이밍 config 가 함께 바뀌므로, 캐시된 옛
//      셸이 남으면 그 기기만 리스닝부터 시작하는 옛 순서로 계속 시험을 친다.
// v49: 학생도 네 영역을 본다 — 목록(tests.html)의 영역 칸이 학생에게도 선다.
//      (이때 붙었던 관리자 승인 칸은 v56 에서 없앴다.) 캐시된 옛 셸이 남으면
//      그 기기만 영역 칸 없는 옛 목록을 계속 보므로 판올림한다.
// v50: 학생의 행선지가 SET 9 리딩 한 영역이 된다. 로그인하면 목록을 지나지 않고
//      곧장 그 시험으로 떨어지고(assets/student-landing.js 가 주소를 갖는다),
//      리딩 앞의 볼륨·마이크 준비 화면 두 장은 config/timing.toefl.json 에서
//      내려갔다. 셸에 든 exam-timing.js 의 내장 폴백도 같이 바뀌므로, 캐시된 옛
//      사본이 남으면 그 기기만 목록으로 떨어지거나 점검 화면을 다시 만난다.
// v51: 문항 스크립트 → 음성은 ElevenLabs 로만 만든다. 시험 음성 정본이 전부 그
//      계정의 목소리라, 한 문항만 다른 엔진으로 다시 만들면 그 문항만 목소리가 튄다.
//      api/tts.js 에서 나머지 엔진을 걷어내고 assets/tts-client.js 의 폴백 목소리를
//      SET 9 배역표의 voice_id 로 갈았다. admin-questions.html 도 함께 바뀌었으므로
//      (저장 뒤 펼친 칸 유지, 속도 0.7–1.2), 캐시된 옛 사본이 남으면 그 기기만
//      Google 목소리 목록을 계속 보고 생성이 400 으로 떨어진다.
// v52: 학생 계정을 시트처럼 한 번에 뽑는다 — admin-students.html 이 학생 수를 받아
//      그만큼 줄을 세우고 아이디를 smeag000 부터 붙인다(실제 배정은 서버가 한다).
//      엑셀에서 이름·이메일을 그대로 붙여넣을 수 있고, 비워 두면 아이디가 이름이 된다.
//      sg-auth.js 에 keepSession 이 생겨 여러 명을 만들어도 관리자 세션이 학생
//      세션으로 덮이지 않는다. 두 파일 모두 셸이라 판올림해야 재방문 기기가 새 화면을
//      본다 — 옛 사본이 남으면 관리자 홈의 카드를 눌러도 없는 주소로 간다.
// v53: 공용 접속 게이트(gate.html · assets/gate.js)를 걷어냈다. 모든 셸 HTML 의
//      <head> 에서 그 한 줄이 빠졌고 두 파일도 사라졌다. 판올림하지 않으면 재방문
//      기기가 캐시된 옛 <head> 를 계속 읽어 없어진 게이트로 되돌아간다.
// v54: 리딩 Back 이 모듈 전체로 열렸다 — 지문 화면의 첫 문항에서 Back 을 누르면 같은
//      모듈의 앞 지문(그 마지막 문항)으로 돌아간다. 앞 모듈로는 못 넘어간다.
//      exam-engine.js · exam-shell.js · exam-render-reading.js 가 함께 바뀌므로,
//      캐시된 옛 엔진이 남으면 첫 문항에서 Back 이 계속 죽어 있다.
// v55.1 → v56: 학생 앞의 관리자 승인 칸이 사라진다. 한 영역만 진입(tests.html ·
//      exam-shell.js 의 gateSection)과 다시 응시가 승인 없이 바로 열리고,
//      assets/admin-approve.js 는 부르는 곳이 없어 지웠다. 시험을 뜨는 문(Exit Test)
//      만 그대로 감독관 승인을 받는다. 셸 HTML 의 <script> 목록이 함께 바뀌므로,
//      캐시된 옛 사본이 남으면 그 기기만 없어진 승인 칸을 계속 만난다.
// v57: 라이팅에도 Back 이 선다 — 답을 쓰다가 앞 문항으로 돌아가 문제를 다시 보고
//      고칠 수 있다. 열리는 범위는 리딩과 같은 규칙(같은 태스크 안, 시간이 남은 동안)이라
//      W1 의 문항 10개 사이만 오간다. Next 는 그 자리에 그대로 서서 다시 앞으로 나온다.
//      assets/exam-shell.js 한 파일이 바뀌므로, 캐시된 옛 셸이 남은 기기는 라이팅에서
//      Back 을 계속 못 본다.
// v58: 답안이 실시간으로 두 곳에 남는다 — 브라우저 로컬 DB(IndexedDB)와 Supabase.
//      화면이 넘어갈 때마다 스냅샷(체크포인트)을 남겨, 정전으로 꺼진 뒤 다시 켜면
//      '꺼지기 직전 · 2스텝 전 · 3스텝 전 · 이 코스 처음부터 · 전체 다시' 를 고른다.
//      새 파일 넷(exam-localdb.js · exam-cloud.js · exam-resume.js · exam-live-boot.js)이
//      셸에 들어오고 exam-store.js · exam-shell.js · exam-runtime.html 이 함께 바뀌므로,
//      캐시된 옛 사본이 남은 기기는 정전 뒤에도 옛 '이어서 응시' 두 칸만 본다.
// v59: 제출하고 인터넷이 있으면 리뷰까지 그 자리에서 나온다 — 총평·틀린 문항 해설에
//      더해 "무엇을 어떻게 공부하나"(학습 계획)가 함께 쓰여 sg_comments 에 남는다.
//      리뷰를 부르는 것이 선생님만이 아니게 되어(학생 본인·제출 화면) 저장은 서버가
//      한다(api/feedback.js + service_role). assets/sg-comments.js · exam-shell.js ·
//      review.html 이 함께 바뀌므로, 캐시된 옛 사본이 남은 기기는 예전 계약(attempt
//      본문을 보내고 브라우저가 저장)으로 계속 호출해 401 만 받는다.
// v60: 응시 화면이 시작하기 전에 "이 답안이 이 기기 밖에도 남는가"를 묻는다. 비로그인이면
//      클라우드 사본이 없다는 것을, 저장소가 막힌 창(시크릿 등)이면 창을 닫는 순간
//      답안이 사라진다는 것을 읽히고 나서 시작한다. 새 파일 assets/sg-storage-guard.js
//      가 셸에 들어오고, set9.html · set9-reading.html · en/test-nt/* 넷은 여태 빠져
//      있던 assets/sg-auth.js 를 함께 싣는다 — 그 화면들은 SG_AUTH 가 없어 exam-cloud.js
//      가 토큰을 못 얻었고, 그래서 답안이 아예 클라우드로 가지 않았다.
// v61: 학생 명단을 손으로 옮겨 적지 않는다 — admin-students.html 이 붙여넣기 칸과
//      엑셀 파일(.xlsx/.csv)을 받는다. 이름·아이디 순서는 알아서 가려 읽는다.
//      새 파일 assets/xlsx-read.js(zip 을 DecompressionStream 으로 푸는 순수 계산)와
//      빈 양식 assets/smeag-students-template.xlsx 가 셸에 들어온다. 캐시된 옛 사본이
//      남은 기기는 붙여넣기 칸 없이 인원수 방식만 보고, Import 를 눌러도 아무 일이 없다.
// v62: 학생의 행선지가 대시보드가 된다 — 로그인하면 시험으로 곧장 떨어지지 않고
//      자기 화면(dashboard.html)에 선다. 그 화면에는 SET 9 시작 버튼 하나와 SET 9
//      성적만 보인다(다른 세트 기록은 학생에게 세지 않는다). assets/student-landing.js
//      가 주소를 갖는다. 캐시된 옛 사본이 남으면 그 기기만 로그인하자마자 시험으로
//      떨어지고, 대시보드에 SET 9 버튼이 서지 않는다.
// v63: 겹치는 아이디를 만들기 전에 본다 — admin-students.html 이 날짜를 고를 때
//      그 시험일 명단(sg_exam_accounts)을 읽어 두고, 조회 칸·붙여넣기 요약·표의
//      상태 칸 세 자리에 같이 쓴다. 번호를 치는 순간 누가 그 자리를 쥐고 있는지
//      그 줄에 뜬다. 캐시된 옛 사본이 남은 기기는 조회 칸이 없고, 겹침을 Create 를
//      누른 뒤에야 안다.
// v64: 선생님도 관리자 홈으로 들어온다 — admin.html 이 관리자 비밀번호 말고
//      Supabase 선생님 계정도 문으로 받는다. 다만 그 자리에서는 '학생 응시 결과'
//      카드 하나만 남기고 나머지는 DOM 에서 지운다(읽기 전용). 성적을 고치는
//      권한은 종전대로 review.html 이, 정본은 RLS 가 가른다. 캐시된 옛 사본이
//      남은 기기는 선생님에게 관리자 비밀번호 창만 계속 띄운다.
// v65: 스피킹 녹음이 실제로 올라간다 — MediaRecorder 가 주는 타입은
//      'audio/webm;codecs=opus' 인데 버킷은 'audio/webm' 만 알고 있어, 2026-08-12
//      시험의 녹음 61건이 전부 400(InvalidMimeType)으로 거절당했다. 화면은 그동안
//      "계정에 저장되었습니다" 라고 했다. assets/sg-results.js 가 코덱을 떼고 보내고,
//      실패하면 그 이유를 들고 나온다. assets/exam-shell.js 는 녹음이 못 올라간 제출을
//      성공이라고 말하지 않는다. 회수용 recover-recordings.html 이 새로 들어온다 —
//      기기에 남은 녹음을 세어 파일로 내려받고(오프라인 가능) 클라우드로 올린다.
//      캐시된 옛 사본이 남은 기기는 여전히 코덱을 붙여 보내지만, 버킷 쪽도 함께
//      넓혔으므로(supabase/recordings_staff.sql) 그 기기의 업로드도 통과한다.
// v66: 밀린 녹음을 다시 올릴 수 있는 자리가 실제로 생긴다 — dashboard.html 이
//      assets/exam-store.js 를 싣는다. 이 파일이 없어 window.SG_STORE 가 없었고,
//      sg-results.js 의 uploadRecordings 는 첫 줄에서 조용히 돌아섰다. 그래서
//      "다시 로그인해서 성적 화면을 열면 올라간다"는 길이 여태 한 번도 열린 적이
//      없다(요청조차 나가지 않았다). 대시보드는 이제 올린 개수·실패 이유를 적는다.
//      캐시된 옛 사본이 남은 기기는 여전히 아무 말 없이 아무것도 올리지 않는다.
// v67: 응시 화면은 로그인 없이 열리지 않는다. v60 이 학생 화면에 세운 것은 경고였고
//      Start anyway 가 열려 있었는데, 그 문을 누르면 답안이 그 PC 안에만 남는다 —
//      경고로는 막지 못한다는 판단(2026-08-13). 이제 파생 페이지(set9.html ·
//      set9-reading.html · en/test-nt/*)도 원본 exam-runtime.html 의
//      <meta name="sg-auth" content="required"> 를 그대로 물려받는다
//      (tools/build_routes.py 의 soften_auth 를 걷어냈다). 오프라인 시험장은 세션이
//      localStorage 에 남아 통과한다 — 회선이 필요한 것은 새 로그인뿐이다.
//      assets/sg-auth.js 의 막도 함께 고쳤다: 문구가 "재부팅했다" 한 경우만 말하지
//      않고 왜 로그인해야 하는지를 말하고, 돌아갈 자리를 baseURI 기준으로 잡아
//      /en/test-nt/* 에서도 보던 화면으로 되돌아온다(여태는 빈 값이었다).
//      캐시된 옛 사본이 남은 기기는 로그인 없이 시험을 시작할 수 있다.
// v68: 시험장에서 난 일이 메일함까지 간다 — assets/sg-notify.js 와 서버리스
//      api/notify.js(Resend). 녹음 업로드 실패·오래 끊긴 회선·처음부터 다시 시작·
//      채점 거절은 난 그 자리에서 한 통씩(issue), 한 학생의 응시가 끝나면 제출 사실과
//      밴드 점수를 묶어 한 통(done)이 jitnet57@gmail.com · ai@smeagschool.com 으로
//      나간다. 화면에만 적어 두면 아무도 그날 모른다는 것을 2026-08-12 이 보여 줬다.
//      알림은 시험을 멈추지 않는다(F12): 로그인·회선이 없으면 기기 큐에 눌러 뒀다가
//      대시보드를 열 때 마저 보낸다. 그래서 dashboard.html 도 이 파일을 싣는다.
//      캐시된 옛 사본이 남은 기기는 아무 알림도 보내지 않는다 — 그 기기의 사고는
//      종전대로 그 PC 화면에만 적힌다. 그래서 판올림한다.
// v69: 라이팅 Task 1 의 1..10 문항 그리드가 앞 번호로도 열린다 —
//      assets/exam-render-writing.js. 상단바 Back 은 이미 같은 모듈 안에서 열려
//      있었는데(2026-08-12), 화면 안 그리드만 "You cannot go back" 으로 앞 번호를
//      회색으로 붙들고 있어 학생 눈에는 되돌아갈 길이 없어 보였다. 이제 앞 칸은
//      engine.back(), 뒤 칸은 engine.next() 로 한 칸씩 옮긴다 — 모듈 경계는 그대로
//      엔진이 막는다. 캐시된 옛 렌더러가 남은 기기는 계속 회색 칸을 본다.
// v70: AI 채점이 곧 성적이다 — 선생님의 확정을 기다리지 않는다. 라이팅·스피킹의
//      AI 점수와 채점 근거가 나오는 즉시 학생 성적표·리뷰·대시보드에 그대로 실리고,
//      "AI 초안 · 교사 확정 대기" 라는 상태(sg-band.js 의 'draft')는 사라졌다.
//      선생님은 여전히 점수를 고칠 수 있고, 고친 점수가 AI 를 이긴다(그 자리는
//      자동 재채점도 건드리지 않는다) — 다만 관문이 아니라 덮어쓰기다.
//      assets/sg-band.js · sg-review-writing.js · sg-review-speaking.js ·
//      exam-shell.js 와 dashboard.html · review.html 이 함께 바뀌므로, 캐시된 옛
//      사본이 남은 기기는 점수 밑에 "선생님이 아직 확정하지 않았습니다" 를 계속 본다.
// v71: AI 채점이 쓴 토큰과 금액을 볼 수 있다 — admin-usage.html 이 sg_task_scores 의
//      ai_usage 원장을 읽어 모델별·날짜별·영역별로 접고, 단가표를 태워 금액을 낸다.
//      admin.html 허브에 그 카드가 생겼다(허브는 셸 자산이라 판올림하지 않으면 재방문
//      기기가 옛 카드 목록을 계속 본다). 새 화면 자체는 서버 원장을 읽어야 의미가
//      있어 셸에 넣지 않는다 — 오프라인에서 열어 봐야 빈 표다.
// v72: 관리자가 새 컴퓨터에서 반쪽 화면을 보고 이유를 모르던 자리를 고친다 —
//      admin.html 이 잠긴 이유(계정이 아니라 이 브라우저에 관리자 비밀번호가 없다)를
//      본문 맨 위에 큰 카드로 세우고, 거기서 바로 비밀번호를 넣게 한다. 허브는 셸
//      자산이라 판올림하지 않으면 재방문 기기가 그 카드 없는 옛 화면을 계속 본다.
// v73: 관리 화면이 채점을 건다 — admin-results.html 이 보이는 응시의 미채점 과제를
//      한 번에 AI 채점으로 보낸다(아무도 열지 않은 응시는 영영 미채점이었다).
//      셸 자산이라 판올림해야 재방문 기기에 그 버튼이 도착한다.
//      (판올림 당시 이 줄이 빠져 있었다 — v74 에서 되메운다.)
// v74: 죽은 토큰을 한 번 되살려 본다 — AI 채점이 401 을 받으면 그 자리에서 강제로
//      토큰을 갱신해 다시 보내고, 그래도 거절이면 세션을 버려 헤더의 이름표를
//      내린다. assets/sg-auth.js(token(force) · invalidate) · assets/sg-results.js
//      (묶음마다 토큰을 새로 받는다) · review.html(로그인 문을 세운다)이 함께
//      바뀌었고 셋 다 셸 자산이다 — 판올림하지 않으면 재방문 기기는 캐시된 옛
//      사본으로 계속 "Sign-in is required" 만 본다. 이 화면을 쓰는 관리자 기기는
//      전부 재방문이라, 고쳐도 고쳐진 것이 도착하지 않는 자리였다.
// v75: 채점이 조용히 끝나지 않는다 — review.html 이 "한 건도 매기지 못했다" 는 답을
//      받고도 입을 닫던 자리 둘(자동 재의뢰 고삐에 걸렸을 때, 전부 no_transcript 로
//      건너뛰었을 때)을 막았다. 녹음도 있고 서버 키도 있는데 화면에는 "Not scored
//      yet" 만 남아, 왜 안 되는지 아무 데도 적히지 않던 자리다. 서버가 전사에서
//      잡은 예외(detail)를 그대로 편다. 셸 자산이라 판올림해야 도착한다.
// v76: 스피킹 녹음을 시험이 끝나는 그 자리에서 회수한다 — assets/sg-recordings.js 가
//      이 기기의 IndexedDB 를 뒤져 아이디_이름_응시날짜.zip 한 장으로 묶고, 그 한 장을
//      이 컴퓨터와 Supabase 두 곳에 남긴 뒤, 버킷의 **실제 목록**과 대조해 아직 없는
//      녹음만 올린다. "올렸다"는 localStorage 표를 믿지 않는다 — 그 표가 어긋난 채
//      버킷이 비어 있던 것이 2026-08-14 응시였다(기기에 11개, 서버에 0개).
//      exam-shell 이 push() 보다 먼저 이것을 부르고, review.html 은 스피킹 채점 앞에
//      세운다. 채점 버튼도 라이팅·스피킹으로 갈랐다 — 라이팅이 끝난 자리에서 스피킹만
//      두드릴 수 있어야, 무엇이 왜 안 되는지가 한 덩어리로 뭉개지지 않는다.
//      exam-shell.js · review.html · sg-results.js 가 함께 바뀌었고 새 파일이 셸에
//      들어왔으므로 판올림한다.
// v77: 녹음 회수 도구를 스피킹 리뷰 옆에 세운다. 여태 그 도구는 admin 허브 카드로만
//      있어서, "녹음이 없다"는 문구를 보고 무엇을 해야 하는지 아는 사람만 찾아갔다.
//      이제 sg-review-speaking.js 가 녹음이 없다고 말하는 자리마다(제출 안 됨 · 이 기기에
//      없음 · 버킷에서 안 열림) 선생님·관리자에게 문을 세우고, 채점 카드에도 문 하나를
//      둔다 — 스피킹이 통째로 비어 있으면 문항을 넘겨 볼 것도 없이 거기가 첫 화면이다.
//      recover-recordings.html 은 ?session= 을 받으면 그 응시만 추려 스스로 스캔한다.
//      셋 다 셸 자산이라 판올림해야 재방문 기기에 도착한다.
// v78: 미로그인 제출이 조용히 끝나지 않는다. 로그인이 없으면 답안은 이 브라우저
//      프로필 밖으로 한 발도 못 나가는데, 여태 그 자리는 "이 기기에 저장되었습니다"
//      한 줄로 지나갔다 — 2026-08-12 smeag007(PAI JUN YUAN)이 그렇게 사라졌다.
//      이제 exam-shell.js 가 붉은 막을 세우고, 녹음은 토큰 없이도 파일 한 장으로
//      쥐여 주고, 지금 로그인해 올릴 문을 그 자리에 연다. admin-results.html 에는
//      시험일 명단 대조를 얹었다 — 배부한 아이디에서 도착한 것을 빼면 빈칸이
//      이름을 갖는다. 그날은 9명 중 8명만 도착했고 아무도 세지 않았다.
//      둘 다 셸 자산이라 판올림해야 시험장 PC 에 도착한다.
// v79: AI 채점·리뷰가 확인할 수 있는 것만 말한다. 셋이 함께 바뀌었다.
//      1) 채점(api/score.js) — 온도 0, 복창은 원문과 견주어 **세고**(_rubric_toefl.js
//         compareRepeat) 루브릭이 그 셈에 허락하지 않는 점수는 내린다. 채점 근거로
//         붙는 인용은 답안에 글자 그대로 있는지 확인하고 없으면 지운다.
//      2) 리뷰(api/feedback.js) — 오답에 그 문항이 딛고 선 원문(리딩 지문·리스닝
//         대본)을 함께 실어 보낸다. 여태 모델이 본 것은 문제문 한 줄뿐이라, 해설이
//         "지문을 다시 읽어 보세요" 아니면 지어낸 근거였다. 받은 인용은 서버가
//         응시와 대조해 지어낸 것을 걷어 낸다.
//      3) 화면 — 확인된 인용(내가 쓴 답 · 지문 근거)과 복창의 셈을 학생에게 그대로
//         보여 준다.
//      sg-results.js · sg-comments.js · exam-shell.js · review.html ·
//      sg-review-writing.js · sg-review-speaking.js · app.css 가 모두 셸 자산이라
//      판올림해야 재방문 기기에 도착한다. 시험 셸에 audio-script-check.js 가 새로
//      실린다 — 문항마다 음원이 따로 붙는 리스닝은 학생이 들은 말이 그 인덱스에만 있다.
const VERSION = 'sg-v79';
const SHELL = 'sg-shell-' + VERSION;
// 판올림과 무관하게 살아남는다 — 갱신은 해시가, 정리는 offline-prep 의 prune 이 한다.
const MEDIA = 'sg-media-v2';

const SHELL_ASSETS = [
  'index.html', 'npz.html', 'tests.html', 'dashboard.html', 'learning.html',
  'community.html', 'tools.html', 'purchase.html', 'login.html', 'signup.html', 'exam.html',
  'set9.html', 'set9-reading.html', 'admin-audio.html', 'admin-audio-files.html', 'admin-questions.html',
  'admin-audio-sync.html', 'admin-set-view.html', 'config/audio-check.set9.json',

  // 채점 리뷰 — 제출 직후 오프라인에서도 자기 답안을 문항별로 볼 수 있어야 한다.
  'review.html', 'admin-results.html', 'assets/sg-results.js', 'assets/sg-comments.js',
  /* 녹음 회수 — 시험이 끝나는 자리에서 원본을 손에 쥐는 일이라, 회선이 없는
     시험장에서도 반드시 있어야 한다. 그래서 셸에 넣는다. */
  'assets/sg-recordings.js',
  // 녹음 회수 — 업로드가 실패한 PC 앞에서 여는 도구다. 그 PC 가 오프라인일 수도 있고
  // (스캔·저장은 회선 없이 된다), 회수는 미룰수록 브라우저 정리에 지워진다.
  'recover-recordings.html',
  'assets/sg-review-reading.js', 'assets/sg-review-listening.js',
  'assets/sg-review-writing.js', 'assets/sg-review-speaking.js',
  // 밴드 환산 — 제출 화면이 채점 직후 네 영역 점수를 그 자리에서 편다.
  'assets/sg-band.js',

  'assets/audio-config.js',

  // SET 별 관리자 계층 — 오프라인 수업 중에도 로그인·문항 교체가 되어야 한다.
  'assets/admin-session.js', 'assets/admin-entry.js', 'assets/tts-client.js',
  // 학생의 행선지 — index.html · login.html 이 <head>·로그인 직후에 읽는다.
  // 빠지면 오프라인에서 학생이 로그인해도 갈 곳을 모른다.
  'assets/student-landing.js',
  'assets/question-config.js', 'assets/audio-index.js', 'assets/audio-script-check.js',

  // 회원 세션 — 온라인에서 로그인해 둔 상태를 오프라인에서도 헤더가 그려야 한다.
  'assets/sg-auth.js',

  // QR 로그인 카드 — 인코더는 순수 계산이라 오프라인에서도 카드가 그려진다.
  'assets/sg-qr.js', 'admin-qr.html',

  // 관리자 홈과 좌석 관리 — 시험장에서 회선이 없어도 좌석을 다시 짤 수 있어야 한다.
  'admin.html', 'admin-seats.html', 'assets/sg-seats.js', 'admin-teachers.html',
  // 학생 계정 대량 발급 — 시험 당일 아침에 회선이 흔들려도 화면 자체는 떠야 한다
  // (계정 생성은 서버가 하므로 오프라인에서는 만들지 못한다).
  'admin-students.html', 'assets/xlsx-read.js', 'assets/smeag-students-template.xlsx',
  'seat-setup.html', 'assets/seat-runtime.js',

  // 오프라인 사전 다운로드 — 목록 자체가 캐시에 있어야, 두 번째 방문이 오프라인이어도
  // "무엇이 빠졌는지"를 판단해 알려줄 수 있다.
  'assets/offline-prep.js', 'config/offline.set9.json',

  // 전체화면 자동 진입 · 화면 맞춤 — 오프라인 시험장에서도 첫 화면부터 적용돼야 한다.
  'assets/sg-fullscreen.js',

  // 시작 전 저장 위험 확인 — 셸이 이 파일을 기다렸다가 boot 하므로 오프라인에서도 있어야 한다.
  'assets/sg-storage-guard.js',

  // 판올림 확인 — 사본이 지니고 다니는 판 번호와, 그것을 라이브와 대조하는 검사기.
  // 검사기는 오프라인이면 조용히 물러나므로 프리캐시해도 시험장에서 걸리지 않는다.
  'assets/build-version.js', 'assets/sg-update-check.js',

  'assets/app.css', 'assets/app.js', 'assets/set1.js', 'assets/set9.js', 'assets/set9-audio.js',
  'assets/icon-192.png', 'assets/icon-512.png', 'assets/favicon.svg',
  'manifest.webmanifest',

  // Exam runtime (Epic 1–2). The shell must be fully precached: a test that starts
  // online and loses the network mid-section still has to reach the submit screen.
  'exam-runtime.html', 'assets/exam.css',
  'assets/exam-types.js', 'assets/exam-media.js', 'assets/exam-timing.js',
  'assets/exam-compile.js', 'assets/exam-clock.js', 'assets/exam-store.js',
  'assets/exam-render.js', 'assets/exam-engine.js', 'assets/exam-recorder.js',
  'assets/exam-render-instruction.js', 'assets/exam-render-listening.js',
  'assets/exam-render-reading.js', 'assets/exam-render-writing.js',
  'assets/exam-render-speaking.js', 'assets/exam-sync.js', 'assets/exam-sync-boot.js',

  // 실시간 저장과 정전 복구 — 전원이 끊긴 뒤 다시 켰을 때 되감기 화면이 떠야 하므로
  // 이 네 파일은 오프라인에서도 반드시 캐시에 있어야 한다.
  'assets/exam-localdb.js', 'assets/exam-cloud.js', 'assets/exam-resume.js',
  'assets/exam-live-boot.js',
  // 알림 — 사고는 오프라인에서 난다. 보내지 못한 알림을 큐에 눌러 두는 일 자체가
  // 회선 없이 돌아야 하므로 이 파일도 캐시에 있어야 한다(/api/notify 는 서버리스라 제외).
  'assets/sg-notify.js',

  // Timing profiles — exam-timing.js falls back to an inline default if these are
  // missing, but precaching them keeps offline timings identical to online ones.
  'config/timing.toefl.json', 'config/timing.ielts.json',

  // 시험 셸 스크립트 — exam-runtime.html 과 라우트 페이지가 공유한다.
  'assets/exam-shell.js',

  // /en/test-nt/{section} 라우트 페이지 (tools/build_routes.py 가 생성).
  // 응시자가 이 주소로 진입할 수 있으므로 오프라인에서도 열려야 한다.
  'en/test-nt/reading/index.html', 'en/test-nt/listening/index.html',
  'en/test-nt/speaking/index.html', 'en/test-nt/writing/index.html'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL && k !== MEDIA).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 사전 다운로드(assets/offline-prep.js)는 미디어 캐시에 직접 파일을 넣는다. 캐시 이름은
// VERSION 에 묶여 있고 판올림 때마다 옛 것이 지워지므로, 페이지가 이름을 짐작하게 두면
// 판올림 직후 이미 버려진 캐시를 채우게 된다. 그래서 여기서 알려준다.
self.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'sg-cache-names') return;
  const reply = { shell: SHELL, media: MEDIA, version: VERSION };
  if (e.ports && e.ports[0]) e.ports[0].postMessage(reply);
});

function isMedia(url) {
  return url.pathname.includes('/media/');
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // offline-prep.js 가 "바뀐 파일을 다시 받는" 요청에 붙이는 표식. 미디어 분기는
  // cache-first 라, 이 표식이 없으면 갱신하러 보낸 요청조차 캐시에 있는 옛 파일로
  // 되돌아온다 — 받아 와서 제자리에 옛 것을 도로 넣는 꼴이 된다. 그대로 통과시킨다.
  if (req.headers.get('x-sg-refresh')) return;

  // "지금 라이브는 몇 판인가"를 묻는 쪽지는 캐시를 지나지 않는다. 한 번이라도
  // 캐시에 담기면 그 뒤로는 캐시가 답하고, 그 답은 언제나 "최신"이다 —
  // 판올림 알림을 만들어 놓고 스스로 침묵시키는 셈이 된다.
  if (url.pathname.endsWith('/version.json')) return;

  // 서버리스 함수(/api/*)는 캐시 대상이 아니다 — TTS 생성 결과가 굳어버리면 안 된다.
  if (url.pathname.startsWith('/api/') || url.pathname.endsWith('/api/tts')) return;

  // 오프라인 목록은 "무엇이 바뀌었는지"를 알리는 쪽지다. 이것까지 cache-first 로
  // 붙들면 업데이트가 영영 도착하지 않는다 — 기기는 옛 목록을 보고 "최신"이라 답한다.
  // 네트워크를 먼저 보고, 안 되면(오프라인) 캐시된 목록으로 되돌아간다.
  if (/\/config\/offline\.[^/]+\.json$/.test(url.pathname)) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok && res.status === 200) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Media: cache-first, then network, then store for next time (supports range requests).
  if (isMedia(url)) {
    e.respondWith(
      caches.open(MEDIA).then((cache) =>
        cache.match(req).then((hit) =>
          hit || fetch(req).then((res) => {
            if (res.ok && res.status === 200) cache.put(req, res.clone());
            return res;
          }).catch(() => hit)
        )
      )
    );
    return;
  }

  // Navigation & shell: cache-first with network refresh, fallback to index.
  e.respondWith(
    caches.match(req).then((hit) =>
      hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() =>
        req.mode === 'navigate' ? caches.match('index.html') : undefined
      )
    )
  );
});
