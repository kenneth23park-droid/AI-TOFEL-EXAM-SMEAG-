/* SMEAG · StudyGround — 학생의 행선지 한 곳.
 *
 * 학생이 로그인한 뒤(그리고 로그인해 있는 채로 index.html 로 들어왔을 때) 도착할 주소다.
 * 세트를 고르는 목록(tests.html)을 지나지 않고 지금 치를 시험으로 곧장 들어간다 —
 * SET 9 전체 한 벌(리딩 · 리스닝 · 스피킹 · 라이팅).
 *
 *   exam-runtime.html  · 시험 셸. set·profile 을 쿼리로 받는다
 *   ?mode=exam         · 네 영역을 순서대로 잇는다. tests.html 의 Full Test 버튼과 같은 주소다.
 *
 * 관리자 승인 칸은 지나지 않는다 — 학생 앞의 승인은 전부 걷어냈고, 감독관 승인은
 * 시험을 뜨는 문(Exit Test)에만 남는다(assets/exam-shell.js).
 *
 * 값을 바꾸는 곳은 여기 하나다. index.html 은 <head> 에서, login.html 은 로그인 뒤
 * 갈 곳(landing())에서 이 전역을 읽는다. login.html 의 ?next= 검사식이 받는 모양
 * (`이름.html?쿼리`)을 지켜야 한다 — 경로 구분자(/)가 들어가면 거기서 걸러진다.
 *
 * 선생님·관리자는 이 값을 쓰지 않는다(랜딩과 목록을 그대로 본다).
 * 시험장 좌석 배정(sg-seats.js)이 있으면 그쪽이 이긴다 — login.html 의 landing() 참고.
 */
window.SG_STUDENT_LANDING = 'exam-runtime.html?mode=exam&profile=toefl&set=set9';
