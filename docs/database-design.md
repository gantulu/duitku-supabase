# Database Design

> Status: proposal only. No migration has been applied or created in this phase.

## Design goals

- PostgreSQL is the source of truth for internal order/payment status.
- Never accept amount, owner ID, payment status, Duitku reference, or merchant order ID from an untrusted client as authoritative.
- Persist IDR amounts as integers (no floating point).
- Use constraints for uniqueness and valid values; use RLS and grants together.
- Apply callback event and payment state atomically in one database transaction.

## Proposed entities

### orders

| Column | Type | Notes |
|---|---|---|
| id | uuid primary key | Generated server-side |
| user_id | uuid | FK to auth.users(id); required for authenticated V1 |
| currency | text | V1 allowlist: IDR |
| subtotal_amount | bigint | Non-negative integer |
| total_amount | bigint | Trusted amount due |
| order_status | constrained text | Business lifecycle, separate from payment status |
| created_at, updated_at | timestamptz | Server timestamps |

Order lines should be stored in a normalized order_items table with product reference/snapshot, quantity, unit price and line total. The create-payment function calculates amount from persisted order data and validates arithmetic.

### payments

| Column | Type | Notes |
|---|---|---|
| id | uuid primary key | Internal attempt ID |
| order_id | uuid not null references orders(id) | Parent order |
| merchant_order_id | varchar(50) not null unique | Merchant-generated, stable for this attempt |
| duitku_reference | text unique null | Unique when returned by Duitku |
| payment_method | text null | Must be in configured allowlist |
| amount | bigint not null check (amount > 0) | Immutable amount for this attempt |
| currency | text not null check (currency = 'IDR') | V1 only |
| status | constrained text | Proposed: pending, paid, failed, needs_review |
| payment_url | text null | Validate expected HTTPS host before returning |
| provider_status_code | text null | Safe response metadata |
| idempotency_key | text not null | Unique within defined order/user scope |
| created_at, updated_at, paid_at | timestamptz | Audit times |

Use a unique constraint on (order_id, idempotency_key) or a dedicated idempotency table. Do not reuse a merchant_order_id with a different amount. Payment attempt amount/order identity should be immutable after the provider request is sent.

### payment_callback_events

| Column | Type | Notes |
|---|---|---|
| id | uuid primary key | Event row |
| payment_id | uuid references payments(id) | Null only for rejected/unmatched events if policy permits |
| event_fingerprint | text not null unique | Stable hash of selected normalized callback fields |
| result_code | text | Provider value as received |
| signature_valid | boolean not null | Do not store secret or computed signing key |
| processing_outcome | constrained text | Applied, duplicate, ignored, rejected, needs_review |
| received_at | timestamptz not null default now() | Receipt time |
| metadata | jsonb | Allowlist only; omit sensitive/token fields unless explicitly required |

Do not store the full raw callback by default. If forensic retention requires it, define access controls, retention, redaction and encryption first.

## Constraints and indexes

- Unique payments.merchant_order_id.
- Unique non-null payments.duitku_reference.
- Unique idempotency scope.
- Foreign keys with explicit deletion behavior; financial records should not cascade-delete with user/order cleanup.
- Check constraints for positive amounts, IDR currency and allowed internal statuses.
- Index orders.user_id, payments.order_id, payments.status, and payments.created_at.
- Unique callback fingerprint for deduplication.

## Atomic callback RPC

A narrowly scoped Postgres function/RPC should:
1. receive already-validated normalized callback fields and signature-verification result from trusted Edge Function code;
2. locate and lock the payment row by merchant order ID;
3. compare merchant code configuration, amount, reference, and stored order identity;
4. insert the event idempotently;
5. apply only an allowed transition;
6. commit event and payment update together.

The RPC must not trust arbitrary client invocation. Revoke execute from anon and ordinary authenticated users; grant only to the server role used by the callback function. Use a fixed safe search_path and avoid dynamic SQL. A database function cannot independently prove that the caller verified an HMAC unless invocation is restricted to trusted server credentials.

## RLS and grants

- Enable RLS on all exposed tables.
- Customer role may read only their own order and safe payment projection, if direct table reads are enabled at all.
- No client INSERT/UPDATE/DELETE access to payment rows or callback events.
- Prefer Edge Functions as the API boundary; keep payment/internal tables outside broad client access where feasible.
- Service-role credentials bypass RLS: server-only, never shipped to a browser.
- Test grants and RLS separately.

## Unresolved decisions before migration

1. Confirm whether V1 requires authenticated-only orders or guest access.
2. Confirm order schema ownership: this repository may need a minimal order schema or integrate with an existing application schema.
3. Confirm official callback failure code with Duitku (01 vs 02 conflict).
4. Confirm provider inquiry/reconciliation contract before adding columns/flows that depend on it.
5. Define retention and access policy for callback audit events.
