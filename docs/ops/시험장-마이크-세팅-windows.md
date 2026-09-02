# 시험장 PC 마이크 세팅 (Windows)

스피킹 도중 브라우저 마이크 권한 창이 뜨면, 학생이 Allow 를 누르는 몇 초가 그대로
답변 시간에서 깎인다(2026-09-02 관찰). 앱 쪽 방어는 넣어 두었지만
**권한 창 자체는 웹 페이지가 없앨 수 없다.** 없애려면 PC 를 이렇게 세팅한다.

이 문서대로 하면 시험 도메인에서 권한 창이 **한 번도 뜨지 않는다.**
시험 전날 세팅하고, 시험 당일 아침에 §4 로 확인한다.

---

## 1. Windows 시스템 마이크 권한

이게 꺼져 있으면 브라우저 설정을 아무리 만져도 소용없다. 창도 안 뜨고 그냥 실패한다.

`설정 → 개인 정보 및 보안 → 마이크`

- **마이크 액세스** : 켬
- **앱이 마이크에 액세스하도록 허용** : 켬
- **데스크톱 앱이 마이크에 액세스하도록 허용** : 켬  ← Chrome 은 여기에 걸린다

## 2. Chrome 정책으로 자동 허용

관리자 권한으로 아래 내용을 `mic-allow.reg` 로 저장해 더블클릭한다.
(도메인이 바뀌면 값도 같이 바꾼다.)

```reg
Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Google\Chrome\AudioCaptureAllowedUrls]
"1"="https://smeag-test.vercel.app"
```

- `AudioCaptureAllowedUrls` 에 적힌 주소는 **묻지 않고 바로 허용**된다.
- 시험장 PC 를 더 잠그고 싶으면 다른 사이트의 마이크를 아예 막을 수 있다.
  같은 파일에 아래를 더한다 — 이러면 위 목록의 주소 말고는 마이크를 못 쓴다.

```reg
[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Google\Chrome]
"AudioCaptureAllowed"=dword:00000000
```

Edge 를 쓴다면 경로만 다르다:
`HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge\AudioCaptureAllowedUrls`

적용하려면 **Chrome 을 완전히 종료했다가 다시 연다**(창만 닫지 말고 작업 관리자에서 확인).

> 도메인이 여러 개면 `"2"`, `"3"` 으로 줄을 늘린다.
> 성적 조회(smeag.com)는 마이크를 쓰지 않으므로 넣을 필요 없다.

## 3. AD/GPO 로 여러 대에 한 번에

같은 정책을 그룹 정책으로 배포해도 된다.
`Google Chrome → 콘텐츠 설정 → 마이크 사용을 허용할 사이트 URL 패턴`
(ADMX 템플릿이 필요하면 Chrome Enterprise 번들에서 받는다.)

## 4. 세팅이 먹었는지 확인 (시험 당일 아침, PC 한 대씩)

1. 주소창에 `chrome://policy` → **AudioCaptureAllowedUrls** 에 시험 주소가 보이는가.
   안 보이면 Chrome 을 완전히 껐다 켠다.
2. 시험 사이트를 열고 마이크 점검 화면까지 간다.
   → **권한 창이 뜨지 않고** 레벨 미터가 바로 움직이면 성공이다.
3. 창이 뜬다면 정책이 안 먹은 것이다. 그 PC 는 §1 부터 다시 본다.

## 5. 세팅이 안 된 PC 에서 (예외 상황)

정책 없이도 시험은 돌아간다. 다만 학생에게 이것만 알린다.

- 권한 창에서 **`Allow while visiting the site`** 를 누른다.
  `Allow this time` 을 누르면 다음 문항에서 창이 또 뜬다.
- 실수로 차단했다면 주소창 자물쇠 아이콘 → 마이크 → 허용.

앱은 이 경우를 이렇게 막는다(`studyground/sg2/assets/exam-render-speaking.js`).

- 스피킹 문항에 들어서면 **녹음 시작 전에 미리** 권한을 잡는다.
- 마이크가 없으면 **문항을 시작하지 않는다.** 응답 시계도 안 걸린다 —
  기다리는 동안 답변 시간은 1초도 줄지 않는다.
- 녹음 직전에 장치를 잃어도 다시 열릴 때까지 시계를 걸지 않고,
  8초를 넘기면 그 문항만 NOT SUBMIT 으로 두고 시험은 계속한다.
