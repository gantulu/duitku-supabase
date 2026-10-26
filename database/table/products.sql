-- V1 product catalog. Apply manually only after schema review; this file is not executed by this repository change.
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 255),
  slug text not null unique check (length(trim(slug)) between 1 and 255),
  description text,
  price bigint not null check (price >= 0),
  stock integer not null default 0 check (stock >= 0),
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_active_idx on public.products (is_active);
alter table public.products enable row level security;
-- No client policies are created: access remains denied unless reviewed grants/policies are added deliberately.
