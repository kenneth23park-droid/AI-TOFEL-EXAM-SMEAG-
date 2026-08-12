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

## 시험 당일 — 학생 한 명 = 파일 하나

전체 덤프는 "그날 DB 가 이랬다" 를 말해 준다. 그런데 시험 당일 실제로 터지는
질문은 언제나 한 명 단위다 — *"3번 학생 스피킹이 안 들어갔다는데요."* 그때
379행짜리 테이블 덤프에서 그 학생 행을 골라내는 일을, 사고가 난 뒤에 하고
싶지는 않다. 그래서 **시험 날에는 학생별로 미리 갈라 둔다.**

```bash
cd studyground
export SUPABASE_URL=https://<ref>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=...

python3 tools/backup_students.py                 # 오늘 응시분 — 로컬 저장 + 클라우드 업로드
python3 tools/backup_students.py --dry-run       # 누가 몇 KB 인지만
python3 tools/backup_students.py --date 2026-08-12
python3 tools/backup_students.py --source local  # 교실 SQLite 로 친 시험이면
```

받는 모양:

```
backups/students/2026-08-12/
  manifest.json                     그날 만든 파일 목록 · 크기 · sha256
  smeag006-265a7c80-HAYUL KIM/
    bundle.json                     응시 · 점수 · 답안 · 과제채점 · 코멘트 · 녹음 메타
    media/set9-S1-q01.webm          스피킹 녹음 원본
Supabase Storage  sg-backups/2026-08-12/smeag006-265a7c80.json    ← bundle.json 과 동일
```

| 옵션 | |
|---|---|
| `--date YYYY-MM-DD` | 시험 날짜 (기본 오늘, 이 컴퓨터의 시간대 기준) |
| `--source cloud\|local` | sg2 실전 응시(기본) / 교실 SQLite |
| `--no-upload` | 로컬에만 |
| `--no-media` | 녹음은 빼고 |
| `--zip` | 학생 폴더를 각각 한 파일로 |

### 왜 두 곳에 두는가

로컬(관리자 노트북)은 빠르지만 그 노트북이 죽으면 같이 죽는다. Supabase 는
살아남지만 회선이 끊기면 그날은 못 만든다. 그래서 **로컬을 먼저 완성하고,
그다음 같은 바이트를 올린다.** 업로드가 실패해도 백업은 이미 손에 있고,
같은 날짜로 다시 돌리면 같은 경로를 덮어쓴다(멱등).

녹음은 **내려받기만 하고 올리지는 않는다.** 원본은 이미 `toefl-recordings` 에
있으니 두 벌 둘 이유가 없다. 반대로 로컬 사본은 반드시 필요하다 — 녹음은
90일 뒤 클라우드에서 지워지고(`purge_after`), 그때 남는 건 이 파일뿐이다.

### 파일을 가르는 열쇠는 학번이 아니라 owner 다

`sg_exam_accounts.student_id`(smeag000…) 는 **유일하지 않다.** 실제로 smeag000
하나를 서로 다른 사람 셋이 쓰고 있다. 학번으로만 파일을 가르면 남남의 답안이
한 파일에 합쳐진다. 그래서 폴더·객체 이름은 `<학번>-<owner 앞 8자>` 다.
같은 이유로 `sg_task_scores`·`sg_comments` 는 session 이 아니라
**(owner, session)** 으로 붙인다 — session 은 응시자끼리 겹친다.

## service_role 키

이 도구는 RLS 를 우회하는 키를 쓴다. 교실 서버·관리자 노트북에만 두고,
`sg2` 프런트엔드나 학생 기기에는 어떤 형태로도 내려보내지 않는다.
(같은 규칙이 `tools/sync_to_supabase.py` 에도 적용된다.)
