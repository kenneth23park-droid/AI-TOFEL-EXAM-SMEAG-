# CI 워크플로 (적용 대기)

이 폴더의 `.yml` 두 개는 **아직 켜져 있지 않다.** `.github/workflows/` 로 옮겨야 돈다.

## 왜 여기 있나

이 저장소를 미는 Personal Access Token 에 `workflow` 권한이 없어서
`.github/workflows/` 아래 파일을 푸시하면 GitHub 이 거절한다:

```
! [remote rejected] main -> main (refusing to allow a Personal Access Token to
  create or update workflow `.github/workflows/check-sg2.yml` without `workflow` scope)
```

거절당한 커밋을 main 에 얹어 두면 **다른 사람 푸시까지 같이 막히므로**, 워크플로를
여기 두고 적용은 사람 손에 맡긴다. 파일 내용은 그대로 쓸 수 있는 완성본이다.

## 켜는 법

1. 토큰에 `workflow` 권한을 준다 — GitHub → Settings → Developer settings →
   Personal access tokens → 해당 토큰 → `workflow` 체크. (fine-grained 토큰이면
   저장소 권한에서 **Workflows: Read and write**.) 그 뒤 `gh auth login` 이나
   원격 URL 의 토큰을 갱신한다.
2. 파일을 제자리로 옮긴다.

   ```sh
   cp studyground/tools/ci/check-sg2.yml  .github/workflows/check-sg2.yml
   cp studyground/tools/ci/deploy-sg2.yml .github/workflows/deploy-sg2.yml
   git add .github/workflows && git commit -m "ci: 겹침 검사·회귀 테스트를 CI 에 세운다"
   git push
   ```

3. GitHub → Actions 에서 `check sg2` 가 도는지 확인한다.

`deploy-sg2.yml` 은 **기존 파일에 단계 하나를 더한 것**이다(겹침 검사 → 실패 시 배포 중단).
그 사이 원본이 바뀌었다면 그대로 덮어쓰지 말고 아래 단계만 옮겨 붙일 것:

```yaml
      - name: 겹침 검사 (배포 차단)
        run: node studyground/tools/dup_check.js
```

## 무엇을 하는 워크플로인가

| 파일 | 언제 | 하는 일 |
|---|---|---|
| `check-sg2.yml` | sg2·tools·tests 가 바뀐 push/PR | 겹침 검사 · 리포트 신선도 가드 · 회귀 테스트 26개 |
| `deploy-sg2.yml` | main 에 sg2 변경 push | 배포 **직전에** 겹침 검사 → high 면 배포 중단 |

**리포트 신선도 가드**가 이 중 제일 조용한 값을 한다. `config/dup-report.*` 는 사람이
`dup_check.js` 를 돌려 커밋하는 파일이라 낡기 쉽고, 낡은 리포트는 화면에
"겹침 없음"이라고 **거짓말을 한다**. 실제로 SET9 스피킹 지시문 겹침이 그렇게 며칠
묻혀 있었다. 가드는 커밋된 리포트가 지금 콘텐츠로 다시 만든 것과 다르면 실패시키고
고치는 명령을 알려 준다.

## 지금 당장 돌고 있는 것 — pre-commit 훅

CI 가 켜지기 전에도 자동생성은 동작한다. `studyground/tools/hooks/` 의 pre-commit 훅이
문항 팩·대본·허용목록·검사기가 든 커밋에서 겹침 검사를 돌리고, 갱신된 리포트를 그
커밋에 담고, 겹침이 있으면 커밋을 멈춘다.

```sh
sh studyground/tools/hooks/install.sh
```

훅은 사람마다 한 번 켜야 하고 `--no-verify` 로 우회할 수 있다. CI 는 우회할 수 없다 —
그래서 둘 다 있어야 한다.

## 아직 안 들어간 것

파이썬 테스트(`studyground/tests/*.py`)는 CI 에 없다. venv 와 패키지가 필요하고
이 저장소의 CI 에 그 준비가 아직 없다. 로컬에서 `pytest studyground/tests` 로 돌린다.
