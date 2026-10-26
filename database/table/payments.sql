-- Internal payment attempts and sanitized callback audit events.
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  merchant_order_id varchar(50) not null unique,
  duitku_reference text unique,
  payment_method text,
  amount bigint not null check (amount > 0),
  currency text not null default 'IDR' check (currency = 'IDR'),
  status text not null default 'pending' check (status in ('pending','paid','failed','needs_review')),
  payment_url text,
  provider_status_code text,
  idempotency_key text not null check (length(idempotency_key) between 16 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (order_id, idempotency_key)
);

create table if not exists public.payment_callback_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references public.payments(id) on delete restrict,
  event_fingerprint text not null unique,
  result_code text not null,
  signature_valid boolean not null,
  processing_outcome text not null check (processing_outcome in ('applied','duplicate','ignored','rejected','needs_review')),
  received_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists payments_order_created_idx on public.payments (order_id, created_at desc);
create index if not exists payments_status_created_idx on public.payments (status, created_at);
create index if not exists callback_events_payment_received_idx on public.payment_callback_events (payment_id, received_at desc);

alter table public.payments enable row level security;
alter table public.payment_callback_events enable row level security;
-- No client policies are created. Do not grant anon/authenticated write access to these tables.
