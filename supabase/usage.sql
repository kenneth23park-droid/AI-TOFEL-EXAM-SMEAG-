-- =============================================================
-- 사용량 조회 — 백업 도구(tools/backup_supabase.py)가 쓰는 두 함수
-- =============================================================
--
-- [적용]  Supabase 대시보드 [SQL Editor] 에 이 파일 전체를 붙여넣고 Run.
--         멱등하다 — 몇 번을 다시 돌려도 안전하다.
--
-- [왜 함수인가]
--   pg_database_size() 와 storage.objects 는 REST 로 바로 못 읽는다.
--   그렇다고 백업 도구에 psql 접속 정보를 따로 물리고 싶지도 않다.
--   service_role 키 하나로 REST(/rest/v1/rpc/...) 만 쓰게 하려고
--   security definer 함수 두 개로 감싼다.
--
-- [권한]  둘 다 service_role 전용이다. anon/authenticated 에서 실행하면
--         전체 응시 수·녹음 경로가 새 나간다 — 아래에서 명시적으로 revoke 한다.
-- =============================================================


-- -------------------------------------------------------------
-- 1. sg_usage() — 프로젝트가 지금 몇 바이트를 쓰고 있나
-- -------------------------------------------------------------
-- 반환:
--   { db_bytes, storage_bytes, storage_objects, total_bytes,
--     tables: [ { name, bytes, rows, pk } ... ] }
--
-- tables[].pk 는 백업 도구가 페이지네이션할 때 정렬 기준으로 쓴다.
-- 복합 PK 면 첫 컬럼만 나온다 — 순서만 안정적이면 되므로 충분하다.
create or replace function public.sg_usage()
returns json
language sql
security definer
set search_path = public, pg_catalog
as $$
  with t as (
    select
      c.relname::text                                as name,
      pg_total_relation_size(c.oid)                  as bytes,
      greatest(c.reltuples, 0)::bigint               as rows,
      (
        select a.attname::text
          from pg_index i
          join pg_attribute a
            on a.attrelid = i.indrelid
           and a.attnum   = i.indkey[0]
         where i.indrelid = c.oid
           and i.indisprimary
         limit 1
      )                                              as pk
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')          -- 일반 테이블 · 파티션 부모
  ),
  s as (
    select
      coalesce(sum((metadata->>'size')::bigint), 0) as bytes,
      count(*)                                      as objects
    from storage.objects
  )
  select json_build_object(
    'db_bytes',        pg_database_size(current_database()),
    'storage_bytes',   (select bytes   from s),
    'storage_objects', (select objects from s),
    'total_bytes',     pg_database_size(current_database()) + (select bytes from s),
    'tables', (
      select coalesce(json_agg(json_build_object(
               'name',  name,
               'bytes', bytes,
               'rows',  rows,
               'pk',    pk
             ) order by bytes desc), '[]'::json)
      from t
    )
  );
$$;

revoke all on function public.sg_usage() from public, anon, authenticated;
grant execute on function public.sg_usage() to service_role;


-- -------------------------------------------------------------
-- 2. sg_storage_objects(p_after, p_limit) — 녹음 목록을 키셋으로
-- -------------------------------------------------------------
-- Storage API 의 /object/list 는 폴더 단위라 재귀를 돌아야 하고,
-- 응답에 size 가 빠지는 경우가 있다. 여기서는 storage.objects 를
-- 그대로 읽어 (bucket/name) 오름차순으로 한 페이지씩 돌려준다.
--
--   1페이지:  p_after = ''
--   다음:     p_after = 직전 페이지 마지막 행의 key
--
-- offset 이 아니라 키셋이라 백업 도중 파일이 늘거나 줄어도
-- 건너뛰거나 두 번 받는 일이 없다.
create or replace function public.sg_storage_objects(
  p_after text default '',
  p_limit int  default 1000
)
returns table (
  key         text,
  bucket_id   text,
  name        text,
  size        bigint,
  mime        text,
  updated_at  timestamptz
)
language sql
security definer
set search_path = public, pg_catalog
as $$
  select
    o.bucket_id || '/' || o.name              as key,
    o.bucket_id::text,
    o.name::text,
    coalesce((o.metadata->>'size')::bigint, 0),
    o.metadata->>'mimetype',
    o.updated_at
  from storage.objects o
  where o.bucket_id || '/' || o.name > coalesce(p_after, '')
  order by 1
  limit least(greatest(coalesce(p_limit, 1000), 1), 5000);
$$;

revoke all on function public.sg_storage_objects(text, int) from public, anon, authenticated;
grant execute on function public.sg_storage_objects(text, int) to service_role;
