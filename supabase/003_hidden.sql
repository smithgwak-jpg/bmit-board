-- 3차 업데이트: 임시저장·숨기기 + 파일 첨부. SQL Editor에 붙여넣고 Run 하세요. 여러 번 실행해도 안전합니다. 데이터는 지워지지 않습니다.

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

drop policy if exists c_read on public.comments;
drop policy if exists c_ins  on public.comments;
create policy c_read on public.comments for select to authenticated
  using (public.is_member() and exists (select 1 from public.requests r where r.id = request_id));
create policy c_ins  on public.comments for insert to authenticated
  with check (public.is_member() and exists (select 1 from public.requests r where r.id = request_id));

alter table public.requests add column if not exists files text[] not null default '{}';
alter table public.comments add column if not exists files text[] not null default '{}';
alter table public.comments drop constraint if exists comments_body_or_images;
alter table public.comments drop constraint if exists comments_body_or_attach;
alter table public.comments add constraint comments_body_or_attach
  check (length(body) <= 4000 and (length(body) > 0 or cardinality(images) > 0 or cardinality(files) > 0));

update storage.buckets set file_size_limit = 20971520, allowed_mime_types = array[
  'image/png','image/jpeg','image/gif','image/webp',
  'application/pdf','text/plain','text/csv',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/x-hwp','application/haansofthwp','application/vnd.hancom.hwp','application/vnd.hancom.hwpx',
  'application/zip','application/x-zip-compressed','application/octet-stream']
where id = 'attachments';
