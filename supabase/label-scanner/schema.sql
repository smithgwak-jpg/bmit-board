-- 상품 라벨 스캐너: 상품 목록 테이블
-- 브라우저는 직접 접근하지 않고, Edge Function(label-api)이 service role로만 읽고 씁니다.
create table if not exists public.label_products (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  product_name text not null default '',
  brand text not null default '',
  category text not null default '',
  net_content text not null default '',
  manufacturer text not null default '',
  manufacturer_address text not null default '',
  seller text not null default '',
  seller_address text not null default '',
  importer text not null default '',
  origin text not null default '',
  phone text not null default '',
  barcode text not null default '',
  expiry text not null default '',
  storage text not null default '',
  ingredients text not null default '',
  allergens text not null default '',
  nutrition text not null default '',
  certifications text not null default '',
  report_no text not null default '',
  notes text not null default '',
  thumb text not null default ''
);
alter table public.label_products enable row level security;
-- 정책 없음: anon/authenticated는 읽기·쓰기 불가, service role(Edge Function)만 접근
revoke all on public.label_products from anon, authenticated;
create index if not exists label_products_created_at on public.label_products (created_at desc);

-- 2026-11-27: 브랜드 칸은 화면에서 뺌(brand 열은 남아 있음). 제조사 정보·온라인 최저가 열 추가
alter table public.label_products
  add column if not exists mfr_revenue text not null default '', add column if not exists mfr_founded text not null default '',
  add column if not exists mfr_employees text not null default '', add column if not exists mfr_source text not null default '',
  add column if not exists low_price text not null default '', add column if not exists low_price_store text not null default '',
  add column if not exists low_price_url text not null default '', add column if not exists low_price_at text not null default '';
create table if not exists public.label_companies (key text primary key, name text not null, revenue text not null default '',
  founded text not null default '', employees text not null default '', source text not null default '', updated_at timestamptz not null default now());
alter table public.label_companies enable row level security;
revoke all on public.label_companies from anon, authenticated;
