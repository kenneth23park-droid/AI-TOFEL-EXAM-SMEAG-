# Supabase 백업 — 400MB 앞에서 받아 둔다

무료 플랜은 **DB 500MB · Storage 1GB** 다. DB 가 한도에 닿으면 쓰기가 막힌다.
막힌 뒤에 지우기 시작하면 이미 늦다 — 지우기 전에 원본이 손에 있어야 한다.
그래서 한도가 아니라 그 앞, **DB+Storage 합계 400MB** 에서 백업을 뜬다.

## 한 번만 해 두는 준비

Supabase 대시보드 [SQL Editor] 에 `supabase/usage.sql` 을 붙여넣고 Run.
함수 두 개가 생긴다. 둘 다 `service_role` 전용이다 — 학생 키로는 실행되지 않는다.

| 함수 | 하는 일 |
|---|---|
| `sg_usage()` | `pg_database_size` + `storage.objects` 합계, 테이블별 크기·행수·PK |
| `sg_storage_objects(after, limit)` | 녹음 목록을 `버킷/경로` 오름차순 키셋 페이지로 |

REST 로는 DB 크기도 Storage 목록도 못 읽는다. 그렇다고 백업 도구에 psql 접속을
따로 물리면 비밀이 하나 더 늘어난다. 그래서 `service_role` 키 하나로 끝나도록
`security definer` 함수로 감쌌다.

## 쓰는 법

```bash
cd studyground
export SUPABASE_URL=https://<ref>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=...        # 이 컴퓨터에만 둔다

python3 tools/backup_supabase.py --check    # 지금 몇 MB 쓰는지만
python3 tools/backup_supabase.py            # 400MB 넘었으면 받는다, 아니면 아무것도 안 한다
python3 tools/backup_supabase.py --force    # 임계값과 무관하게 지금
```

| 옵션 | |
|---|---|
| `--threshold-mb N` | 임계값 (기본 400) |
| `--out 경로` | 받을 폴더 (기본 `studyground/backups/`, git 에서 제외됨) |
| `--zip` | 받은 뒤 한 파일로 묶는다 |
| `--no-storage` | 녹음은 빼고 테이블만 |
| `--prune-recordings N` | 백업이 끝난 뒤 N 일 지난 녹음을 클라우드에서 지운다 |

`--check` 를 습관적으로 볼 필요는 없다. 아무 인자 없이 돌리면 임계값 미만일 때
그냥 끝나므로, cron 이나 시험 종료 후 루틴에 그대로 걸어 두면 된다.

## 받은 것의 모양

```
backups/smeag-backup-20260811-161301/
  manifest.json          파일 목록 · 크기 · sha256 · 행 수 · 그 시점 사용량
  usage.json             사용량 스냅숏
  tables/<테이블>.jsonl  public 스키마 전 테이블, 한 줄 = 한 행 (빈 테이블은 파일 없음)
  storage/<버킷>/<경로>  녹음 원본 그대로
```

JSONL 인 이유는 grep·부분 복구·이어붙이기가 되기 때문이다. 한 테이블이 통째로
JSON 배열 하나면 379 행 중 한 행을 보려고 파일 전체를 파싱해야 한다.

되돌릴 때는 한 줄씩 읽어 같은 테이블로 upsert 하면 된다. PK 를 그대로 담아 두므로
`Prefer: resolution=merge-duplicates` 로 몇 번을 밀어 넣어도 행이 늘지 않는다.

## 두 가지 안전장치

**페이지네이션은 키셋이다.** PK 가 있으면 `offset` 이 아니라 `pk=gt.<마지막값>` 으로
넘긴다. 백업 도중에도 시험은 돌아가고 행은 계속 들어온다 — `offset` 은 그 사이에
행이 늘면 같은 행을 두 번 받거나 하나를 건너뛴다.

**백업은 아무것도 지우지 않는다.** 자리를 비우는 건 `--prune-recordings N` 을 준
경우뿐이고, 그때도 ⑴ 방금 받은 백업에 **같은 크기로** 들어 있고 ⑵ N 일보다 오래된
녹음만 지운다. 받는 도중 실패가 하나라도 있었으면 정리 단계는 통째로 건너뛴다.
답안·점수 테이블은 어떤 경우에도 지우지 않는다.

녹음 보관 기간은 90 일로 잡혀 있다(`docs/review-and-roles.md`). 그 정책을 그대로
집행하려면:

```bash
python3 tools/backup_supabase.py --force --prune-recordings 90
```

## service_role 키

이 도구는 RLS 를 우회하는 키를 쓴다. 교실 서버·관리자 노트북에만 두고,
`sg2` 프런트엔드나 학생 기기에는 어떤 형태로도 내려보내지 않는다.
(같은 규칙이 `tools/sync_to_supabase.py` 에도 적용된다.)
