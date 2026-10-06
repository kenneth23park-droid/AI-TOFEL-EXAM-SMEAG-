---
title: TOEFL Set 5 구현 및 검증
date: 2026-10-06
area: TOEFL
status: complete-local
tags: [SMEAG-AI, TOEFL, Set5]
---

문항 팩 `studyground/sg2/assets/set5.js` 및 builder/test 생성. 총 93문항, 원문/정답 검산 0개 문제. UI 79개 화면 및 이미지 검증 통과. 사용자 원본 문서는 보존했다.

사진·음성 배역·오프라인 목록·관리자/학생 화면 등록 완료. 33개 음성 배역 매니페스트의 대본이 교정된 작업 스크립트와 일치함을 재생성 대조로 확인했다.

최종 로컬 구현 완료: Kokoro ONNX로 음원 33개 생성, 실제 small.en ASR 전수 대조 및 strict 재검증 PASS 33 / WARN 0 / FAIL 0. 누락·무음·길이·피크·대본 경고 없음. 29개 WER 0%, 나머지 최대 1.30%. ASR 원본 `config/audio-asr.set5.json`, 엄격 검사 `config/audio-verify.set5.json`, 관리자용 전사 `config/audio-check.set5.json` 보존.

Chrome 시험 화면 79개 모두 렌더, MP3 33개 모두 브라우저 디코딩 통과, JS 오류/깨진 이미지 0. 52개 미디어(음원 33 + 이미지 19) 오프라인 목록 갱신. 시험 목록 음원 완료 표시, SW v115. Set5 원본 회귀·실제 음원 해시 리포트 회귀·전체 9개 세트 등록/미디어 검사 통과. 최종 빌드 Problems 0 / Checks 0 / Unscored 0 / Audio missing 0 / Audio failing 0.

제약: DOCX 페이지 렌더 도구 부재로 작업 사본 Word 페이지 시각 검증 미실시. XML 대상 문단 외 ZIP 항목 바이트 보존 및 웹 시험 화면 검증 수행. 기존 Set11 테스트는 원본 경로 부재, Set12 테스트는 Windows ESM 경로 문제로 실행 불가; 이번에 기존 팩은 변경하지 않음.

원본 교정 내역: `studyground/docs/set5-source-corrections.md`. 빌드 리포트: `studyground/docs/set-reports/set5.md`.

음성 선택: ElevenLabs sensitive 키를 재조회할 수 없어 사용자에게 선택지를 제시하고 기다린 뒤, 계속 진행 요청에 따라 전체 Set5에 로컬 Kokoro 엔진을 적용했다. AU-Lily만 영국 bf_lily로 대응; 원본 대사는 동일. 생성/ASR Python3.12 환경 분리, ASR faster-whisper 1.2.1 + av 16.1.0 + small.en CPU/int8, CPU 스레드 2. 배포·Drive 동기화는 수행하지 않았다. 재생성 절차: `studyground/docs/set5-audio.md`.
