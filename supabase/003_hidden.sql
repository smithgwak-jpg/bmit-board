-- 3차 업데이트: 임시저장·숨기기. hidden = true 인 요청은 장학문구사 쪽 참여자만 보고, 비엠아이티에는 보이지 않습니다. 여러 번 실행해도 안전합니다.

alter table public.requests add column if not exists hidden boolean not null default false;

create or replace function public.my_side() returns text
language sql stable security definer set search_path = public as $$
  select side from public.members where email = public.my_email()
$$;
grant execute on function public.my_side() to authenticated;

drop policy if exists r_read on public.requests;
drop policy if exists r_ins  on public.requests;
drop policy if exists r_upd  on public.requests;
create policy r_read on public.requests for select to authenticated
  using (public.is_member() and (not hidden or public.my_side() = '우리'));
create policy r_ins  on public.requests for insert to authenticated
  with check (public.is_member() and (not hidden or public.my_side() = '우리'));
create policy r_upd  on public.requests for update to authenticated
  using (public.is_member() and (not hidden or public.my_side() = '우리'))
  with check (public.is_member() and (not hidden or public.my_side() = '우리'));

-- 숨긴 요청의 협의 기록도 같이 가려집니다 (요청을 볼 수 있어야 기록도 보임)
drop policy if exists c_read on public.comments;
drop policy if exists c_ins  on public.comments;
create policy c_read on public.comments for select to authenticated
  using (public.is_member() and exists (select 1 from public.requests r where r.id = request_id));
create policy c_ins  on public.comments for insert to authenticated
  with check (public.is_member() and exists (select 1 from public.requests r where r.id = request_id));
