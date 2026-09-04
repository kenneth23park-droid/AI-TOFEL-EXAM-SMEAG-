#!/bin/sh
# SMEAG StudyGround — 문서 3장 → 시험 음성 전부. 세트 번호 하나만 준다.
#
#   cd studyground/sg2
#   ELEVENLABS_API_KEY=... sh tools/make_set_audio.sh 11
#
# 하는 일은 둘이다.
#   1) 원본 docx 를 파서에 물려 배역 매니페스트를 짓는다(build_voices_manifest.mjs).
#   2) 그 매니페스트로 mp3 를 뽑고, 만든 음성을 받아쓰기해 대본과 대조한다
#      (tts_multivoice.py — 끝의 검산이 FAIL 이면 여기서도 0 이 아닌 값으로 끝난다).
#
# 문항 자체(콘텐츠 팩)는 관리자 화면의 "세트 가져오기" 에서 같은 파서로 저장한다.
# 음성 파일 이름을 팩이 가리키는 경로 그대로 쓰므로, 둘은 따로 만들어도 서로를 찾는다.
set -e

N="${1:?세트 번호를 주세요 — 예: sh tools/make_set_audio.sh 11}"
# 세트 번호는 여기서 소비한다. 남은 인자만 생성기로 넘긴다 —
# "$@" 를 그대로 넘기면 번호가 위치 인자로 다시 들어가 tts_multivoice.py 가
# 'unrecognized arguments: 12' 로 멈춘다(SET 12 에서 실제로 그랬다).
shift
MANIFEST="tts-voices-set${N}exam-11labs.json"

# 듣기 화자 사진도 같은 배역표에서 나온다 — 음성만 만들고 사진을 잊으면
# 듣기 화면만 그림 없이 뜬다. 세트 하나를 끝내는 명령은 하나여야 한다.
node tools/build_voices_manifest.mjs --set "$N"
echo
node tools/build_listening_images.mjs --set "$N"
echo
python3 tools/tts_multivoice.py --manifest "$MANIFEST" "$@"
