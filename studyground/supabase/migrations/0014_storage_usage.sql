-- 0014_storage_usage.sql — 남은 용량을 화면이 물어볼 수 있게 한다.
--
-- 녹음은 응시가 늘수록 선형으로 쌓이는데(응시 1건에 약 1.4 MB), 얼마나 찼는지
-- 아무도 몰랐다. Supabase 대시보드를 열어야만 보이는 숫자였고, 시험 당일 아침에
-- 그걸 열어 보는 사람은 없다. 꽉 차면 조용히 업로드가 실패한다 — 학생은 다 말했고
-- 서버에는 아무것도 없는, 가장 나쁜 실패다.
--
-- 두 저장소를 한 번에 답한다. 성격이 다르므로 합치지 않는다.
--   · storage.objects — 스피킹 녹음(파일). 한도에 실제로 다가가는 쪽.
--   · pg_database_size — 점수·밴드·답안 텍스트(행). 응시당 수십 KB라 훨씬 여유롭다.
--
-- 한도(1 GB / 500 MB)는 여기 적지 않는다. 그건 요금제 사실이지 DB 사실이 아니고,
-- 유료로 올라가면 이 함수를 고쳐야 하는 이유가 없다 — 화면이 상수로 안다.
--
-- 90일 지난 녹음을 따로 세는 이유: 그건 이미 지우기로 한 몫이다(SET 9 결정).
-- "923 MB 남음" 보다 "지금 지워도 되는 게 40 MB 있다" 가 당장 쓸모 있다.
--
-- security definer 인 건 storage.objects 가 학생·선생님에게 열려 있지 않기 때문이다.
-- 대신 첫 줄에서 관리자인지 묻고, 아니면 **행을 하나도 돌려주지 않는다**(null).
-- 0 이나 빈 객체를 주면 "비어 있다" 로 읽혀 잘못된 안심이 된다.

create or replace function public.sg_storage_usage()
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'at',       now(),
    'db_bytes', pg_database_size(current_database()),
    'buckets',  coalesce((
      select jsonb_agg(b.j order by b.j ->> 'bucket')
        from (
          select jsonb_build_object(
                   'bucket',      k.id,
                   'public',      k.public,
                   'files',       count(o.id),
                   'bytes',       coalesce(sum((o.metadata ->> 'size')::bigint), 0),
                   'oldest',      min(o.created_at),
                   'newest',      max(o.created_at),
                   -- 90일 지난 몫 = 보관 규칙상 이미 지워도 되는 몫.
                   'stale_files', count(o.id) filter (where o.created_at < now() - interval '90 days'),
                   'stale_bytes', coalesce(sum((o.metadata ->> 'size')::bigint)
                                    filter (where o.created_at < now() - interval '90 days'), 0)
                 ) as j
            from storage.buckets k
            left join storage.objects o on o.bucket_id = k.id
           group by k.id, k.public
        ) b
    ), '[]'::jsonb)
  )
   where public.sg_is_admin();
$$;

comment on function public.sg_storage_usage() is
  '관리자에게만: 버킷별 파일 수·용량(90일 경과분 포함)과 DB 크기. 관리자가 아니면 null.';

revoke all on function public.sg_storage_usage() from public, anon;
grant execute on function public.sg_storage_usage() to authenticated;
