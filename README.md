# duitku-supabase

Backend-only V1 integration proposal for Duitku POP and Supabase Edge Functions. No storefront is included.

## Repository layout

- `database/table/`: products, orders/order items, payment attempts and callback audit tables.
- `database/function/payment-rpc.sql`: server-only idempotent payment reservation and atomic callback application.
- `edge-functions/`: Create Invoice, provider callback, order status and shared utilities.
- `tests/`: deterministic unit tests for signature, endpoint and validation behavior.
- `.env.example`: variable names and placeholders only.

## Contract decisions implemented

- Create Invoice: POST JSON to the official sandbox/production endpoint; request signature is HMAC-SHA256 over `merchantCode + timestamp`.
- Callback: form-urlencoded POST; HMAC-SHA256 over `merchantCode + amount + merchantOrderId`; verify merchant code, amount, merchant order identity and reference before applying state.
- Only callback `resultCode=00` can transition a payment to `paid`.
- Non-success/unknown callback results remain `needs_review` because the current official POP page is inconsistent about failure codes. Do not infer `failed` until clarified with Duitku.
- Provider timeouts/5xx or malformed successful responses are treated as ambiguous; do not automatically create a second merchant order ID.
- Browser redirect is not payment proof. Status endpoint reports internal database state and does not invent an inquiry endpoint.
- Payment URL must be HTTPS and match `DUITKU_ALLOWED_PAYMENT_HOSTS`, which must be populated with verified hostnames for the merchant account.

## Local checks

Requires Deno:

```sh
deno task check
deno task test
```

Tests are offline/unit-level; they do not contact Duitku, mutate a database, or verify a live merchant account.

## Environment and security

Copy `.env.example` into your local environment setup and replace placeholders; never commit populated environment files. Supabase Edge Functions read local secrets through `supabase/functions/.env` when using the standard Supabase CLI workflow. Production secrets belong in Supabase Function Secrets. `SUPABASE_SERVICE_ROLE_KEY` and `DUITKU_API_KEY` must remain server-only.

This repository change does **not** apply SQL, alter active database state, configure secrets, deploy functions, execute real payments, or merge a pull request.

## Important integration boundaries

- The schema assumes authenticated checkout and newly-owned `public.orders` / `public.order_items` tables. Guest checkout and integration with an existing product/order schema require a separate design decision.
- The requested `edge-functions/` layout is not the default Supabase CLI directory. Before deployment, add a reviewed copy/relocation mapping to `supabase/functions/`.
- Callback RPC access must be restricted to the service role; test grants and RLS in a disposable local project before any live application.
- The callback result-code discrepancy remains a blocker for mapping failures to terminal `failed`.
