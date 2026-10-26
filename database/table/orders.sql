-- V1 order schema. This proposal assumes authenticated checkout; guest access is not implemented.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  order_number text not null unique,
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  shipping_address jsonb not null default '{}'::jsonb,
  currency text not null default 'IDR' check (currency = 'IDR'),
  subtotal_amount bigint not null check (subtotal_amount >= 0),
  shipping_cost bigint not null default 0 check (shipping_cost >= 0),
  total_amount bigint not null check (total_amount >= 0),
  order_status text not null default 'pending' check (order_status in ('pending','confirmed','cancelled','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (total_amount = subtotal_amount + shipping_cost)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price bigint not null check (unit_price >= 0),
  line_total bigint generated always as (unit_price * quantity::bigint) stored,
  created_at timestamptz not null default now()
);

create index if not exists orders_user_created_idx on public.orders (user_id, created_at desc);
create index if not exists order_items_order_idx on public.order_items (order_id);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
-- No client policies are created; the Edge Function API is the intended access boundary.
