-- 비엠아이티 개발협의 현황: Supabase SQL Editor에 통째로 붙여넣고 Run 하세요.
-- 맨 아래 첫 관리자 이메일을 본인 이메일로 바꾼 뒤 실행해야 합니다.

create extension if not exists pgcrypto;

-- 참여자 (여기 등록된 이메일만 가입·열람 가능)
create table if not exists public.members (
  email      text primary key check (email = lower(email)),
  name       text not null default '',
  side       text not null default '우리' check (side in ('우리', 'BMIT')),
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.my_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where email = public.my_email())
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where email = public.my_email() and is_admin)
$$;

-- 요청 건
create table if not exists public.requests (
  id           uuid primary key default gen_random_uuid(),
  no           bigint generated always as identity unique,
  title        text not null check (length(title) between 1 and 200),
  category     text not null default '',
  status       text not null default '요청' check (status in ('요청', '검토', '진행', '완료', '보류')),
  priority     text not null default '중' check (priority in ('상', '중', '하')),
  requester    text not null default '',
  assignee     text not null default '',
  requested_at date default current_date,
  due_at       date,
  description  text not null default '',
  from_survey  uuid,
  created_by   text not null default public.my_email(),
  created_at   timestamptz not null default now(),
  updated_by   text,
  updated_at   timestamptz not null default now()
);

create or replace function public.touch_request() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := public.my_email();
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  else
    new.created_by := public.my_email();
  end if;
  return new;
end $$;
drop trigger if exists touch_request on public.requests;
create trigger touch_request before insert or update on public.requests
  for each row execute function public.touch_request();

-- 협의 기록 (작성자 이름·소속은 참여자 정보에서 자동으로 채움)
create table if not exists public.comments (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.requests(id) on delete cascade,
  body         text not null check (length(body) between 1 and 4000),
  author_email text not null default public.my_email(),
  author_name  text not null default '',
  side         text not null default '우리',
  created_at   timestamptz not null default now()
);

create or replace function public.stamp_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare m public.members;
begin
  select * into m from public.members where email = public.my_email();
  new.author_email := public.my_email();
  new.author_name  := coalesce(nullif(m.name, ''), new.author_email);
  new.side         := coalesce(m.side, '우리');
  new.created_at   := now();
  return new;
end $$;
drop trigger if exists stamp_comment on public.comments;
create trigger stamp_comment before insert on public.comments
  for each row execute function public.stamp_comment();

-- 수요조사
create table if not exists public.survey (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(title) between 1 and 200),
  description  text not null default '',
  created_by   text not null default public.my_email(),
  converted_to uuid references public.requests(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists public.votes (
  survey_id  uuid not null references public.survey(id) on delete cascade,
  email      text not null default public.my_email(),
  created_at timestamptz not null default now(),
  primary key (survey_id, email)
);

-- 접근 권한 (RLS)
alter table public.members  enable row level security;
alter table public.requests enable row level security;
alter table public.comments enable row level security;
alter table public.survey   enable row level security;
alter table public.votes    enable row level security;

drop policy if exists m_read  on public.members;
drop policy if exists m_write on public.members;
create policy m_read  on public.members for select to authenticated using (public.is_member());
create policy m_write on public.members for all    to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists r_read on public.requests;
drop policy if exists r_ins  on public.requests;
drop policy if exists r_upd  on public.requests;
drop policy if exists r_del  on public.requests;
create policy r_read on public.requests for select to authenticated using (public.is_member());
create policy r_ins  on public.requests for insert to authenticated with check (public.is_member());
create policy r_upd  on public.requests for update to authenticated using (public.is_member()) with check (public.is_member());
create policy r_del  on public.requests for delete to authenticated using (public.is_admin());

drop policy if exists c_read on public.comments;
drop policy if exists c_ins  on public.comments;
drop policy if exists c_del  on public.comments;
create policy c_read on public.comments for select to authenticated using (public.is_member());
create policy c_ins  on public.comments for insert to authenticated with check (public.is_member());
create policy c_del  on public.comments for delete to authenticated using (author_email = public.my_email() or public.is_admin());

drop policy if exists s_read on public.survey;
drop policy if exists s_ins  on public.survey;
drop policy if exists s_upd  on public.survey;
drop policy if exists s_del  on public.survey;
create policy s_read on public.survey for select to authenticated using (public.is_member());
create policy s_ins  on public.survey for insert to authenticated with check (public.is_member() and created_by = public.my_email());
create policy s_upd  on public.survey for update to authenticated using (public.is_member()) with check (public.is_member());
create policy s_del  on public.survey for delete to authenticated using (created_by = public.my_email() or public.is_admin());

drop policy if exists v_read on public.votes;
drop policy if exists v_ins  on public.votes;
drop policy if exists v_del  on public.votes;
create policy v_read on public.votes for select to authenticated using (public.is_member());
create policy v_ins  on public.votes for insert to authenticated with check (public.is_member() and email = public.my_email());
create policy v_del  on public.votes for delete to authenticated using (email = public.my_email());

-- 등록되지 않은 이메일은 가입 자체를 막음
create or replace function public.guard_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.members where email = lower(new.email)) then
    raise exception '등록되지 않은 이메일입니다';
  end if;
  return new;
end $$;
drop trigger if exists guard_signup on auth.users;
create trigger guard_signup before insert on auth.users
  for each row execute function public.guard_signup();

-- 실시간 반영
do $$
declare t text;
begin
  foreach t in array array['requests', 'comments', 'survey', 'votes', 'members'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- 첫 관리자: 아래 이메일과 이름을 본인 것으로 바꾸세요.
insert into public.members (email, name, side, is_admin)
values (lower('YOUR_EMAIL@example.com'), '관리자 이름', '우리', true)
on conflict (email) do update set is_admin = true;
