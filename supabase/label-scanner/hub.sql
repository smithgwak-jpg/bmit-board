-- 업무 메인(/hub) 권한 테이블. 브라우저는 직접 접근하지 않고 Edge Function(label-api)만 읽고 씁니다.
create table if not exists public.hub_links (id text primary key, sort int not null default 0, icon text not null default '', title text not null, descr text not null default '', url text not null);
create table if not exists public.hub_groups (id uuid primary key default gen_random_uuid(), name text not null unique, link_ids text[] not null default '{}', created_at timestamptz not null default now());
create table if not exists public.hub_members (email text primary key check (email = lower(email)), name text not null default '', group_id uuid references public.hub_groups(id) on delete set null, extra_link_ids text[] not null default '{}', is_admin boolean not null default false, created_at timestamptz not null default now());
alter table public.hub_links enable row level security;
alter table public.hub_groups enable row level security;
alter table public.hub_members enable row level security;
revoke all on public.hub_links, public.hub_groups, public.hub_members from anon, authenticated;
-- 가입 허용: 게시판 참여자(members) 또는 메인 앱 사용자(hub_members)
create or replace function public.guard_signup() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.members where email = lower(new.email))
     and not exists (select 1 from public.hub_members where email = lower(new.email)) then
    raise exception '등록되지 않은 이메일입니다';
  end if;
  return new;
end $$;
