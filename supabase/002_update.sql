-- 2차 업데이트: 사진(변경 전/후, 기록 첨부), 참고 링크, 회사·팀 표시. SQL Editor에 붙여넣고 Run 하세요. 여러 번 실행해도 안전합니다.

alter table public.requests add column if not exists images_before text[] not null default '{}';
alter table public.requests add column if not exists images_after  text[] not null default '{}';
alter table public.requests add column if not exists links         text[] not null default '{}';
alter table public.comments add column if not exists images        text[] not null default '{}';

-- 사진만 있는 기록도 남길 수 있게
alter table public.comments drop constraint if exists comments_body_check;
alter table public.comments drop constraint if exists comments_body_or_images;
alter table public.comments add constraint comments_body_or_images
  check (length(body) <= 4000 and (length(body) > 0 or cardinality(images) > 0));

-- 사진 저장소 (참여자만 보기·올리기, 비공개)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 10485760, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists bmit_att_read on storage.objects;
drop policy if exists bmit_att_ins  on storage.objects;
drop policy if exists bmit_att_del  on storage.objects;
create policy bmit_att_read on storage.objects for select to authenticated using (bucket_id = 'attachments' and public.is_member());
create policy bmit_att_ins  on storage.objects for insert to authenticated with check (bucket_id = 'attachments' and public.is_member());
create policy bmit_att_del  on storage.objects for delete to authenticated using (bucket_id = 'attachments' and public.is_admin());

-- 회사·팀 표시 (예: 장학문구사 영업팀)
alter table public.members  add column if not exists team        text not null default '';
alter table public.comments add column if not exists author_team text not null default '';

create or replace function public.stamp_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare m public.members;
begin
  select * into m from public.members where email = public.my_email();
  new.author_email := public.my_email();
  new.author_name  := coalesce(nullif(m.name, ''), new.author_email);
  new.author_team  := coalesce(m.team, '');
  new.side         := coalesce(m.side, '우리');
  new.created_at   := now();
  return new;
end $$;
