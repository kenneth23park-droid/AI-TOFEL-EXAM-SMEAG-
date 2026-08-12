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
// v9: 내부용 접근 게이트(gate.html · assets/gate.js) 추가. 모든 셸 HTML 의 <head> 가
//     바뀌었고, 오프라인에서도 게이트를 통과해야 하므로 두 파일을 프리캐시에 넣는다.
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
const VERSION = 'sg-v47';
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
  'assets/sg-review-reading.js', 'assets/sg-review-listening.js',
  'assets/sg-review-writing.js', 'assets/sg-review-speaking.js',
  // 밴드 환산 — 제출 화면이 채점 직후 네 영역 점수를 그 자리에서 편다.
  'assets/sg-band.js',

  // 내부용 접근 게이트 — 오프라인 진입도 이 화면을 먼저 지난다.
  'gate.html', 'assets/gate.js', 'assets/audio-config.js',

  // SET 별 관리자 계층 — 오프라인 수업 중에도 로그인·문항 교체가 되어야 한다.
  'assets/admin-session.js', 'assets/admin-entry.js', 'assets/tts-client.js',
  'assets/question-config.js', 'assets/audio-index.js', 'assets/audio-script-check.js',

  // 회원 세션 — 온라인에서 로그인해 둔 상태를 오프라인에서도 헤더가 그려야 한다.
  'assets/sg-auth.js',

  // QR 로그인 카드 — 인코더는 순수 계산이라 오프라인에서도 카드가 그려진다.
  'assets/sg-qr.js', 'admin-qr.html',

  // 관리자 홈과 좌석 관리 — 시험장에서 회선이 없어도 좌석을 다시 짤 수 있어야 한다.
  'admin.html', 'admin-seats.html', 'assets/sg-seats.js', 'admin-teachers.html',
  'seat-setup.html', 'assets/seat-runtime.js',

  // 오프라인 사전 다운로드 — 목록 자체가 캐시에 있어야, 두 번째 방문이 오프라인이어도
  // "무엇이 빠졌는지"를 판단해 알려줄 수 있다.
  'assets/offline-prep.js', 'config/offline.set9.json',

  // 전체화면 자동 진입 · 화면 맞춤 — 오프라인 시험장에서도 첫 화면부터 적용돼야 한다.
  'assets/sg-fullscreen.js',

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
  'assets/exam-render-speaking.js', 'assets/exam-sync.js',

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
