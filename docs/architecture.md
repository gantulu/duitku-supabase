# Architecture — Duitku POP × Supabase

> Status: design proposal, 2026-10-26. No integration code or database migration has been implemented by this document.

## Scope and boundaries

This repository is a backend integration layer, not a storefront. The calling application owns checkout UX; this backend owns trusted order/payment state. Duitku POP official documentation defines the provider contract. Supabase official documentation defines Edge Function, PostgreSQL, RLS, and secret-handling behavior.

## Components

- **Client application**: submits an internal order identifier and permitted payment options; never submits a trusted amount or provider status.
- **Supabase Auth**: authenticates customer-facing create/check requests. The backend verifies JWT and order ownership. Guest checkout, if required later, needs a separate high-entropy, scoped order-access token flow.
- **Supabase Edge Functions**:
  - **create-payment**: authenticate/authorize, load order data, create or reuse a payment attempt, call Create Invoice, persist validated response.
  - **duitku-callback**: public server-to-server callback; parse the documented form-urlencoded body, validate required fields/signature/merchant/order/amount/reference, then invoke one atomic database transition.
  - **check-payment**: authenticate/authorize and return a minimal internal payment status. It does not claim to query Duitku.
- **Supabase PostgreSQL**: authoritative order/payment records, unique constraints, transaction RPC for callback application, callback event audit.
- **Duitku POP**: external Create Invoice and browser payment flow. HTTP callback is the provider notification used for payment-state updates.
- **Reconciliation**: deferred. No provider inquiry/status endpoint is approved until its current official POP contract is verified.

## Sequence

1. Client calls create-payment with an order ID and idempotency key.
2. Function validates JWT and ownership, then loads order lines/prices from PostgreSQL.
3. A database transaction reserves a stable internal payment attempt and unique merchantOrderId; amount is computed server-side.
4. Function calls the verified sandbox/production Create Invoice endpoint with HMAC-SHA256 request signature and a bounded timeout.
5. Validate HTTP status, JSON shape, statusCode, reference, and paymentUrl. Persist provider identifiers. If result is ambiguous, mark attempt needs_review; do not issue a new merchant order ID automatically.
6. Return only safe payment fields to the client.
7. Client uses the payment URL or approved POP frontend flow. Browser JS callback/redirect is informational only.
8. Duitku posts the callback to duitku-callback.
9. Function validates signature and identity before any write, then calls a single PostgreSQL RPC that records the event and applies the allowed transition atomically.
10. Client polls check-payment for internal status.

## Function security configuration

- Customer-facing functions require JWT validation and application-level order ownership checks.
- The provider callback is server-to-server and cannot depend on a customer JWT. Configure the Supabase gateway/function so Duitku can reach the handler without a user JWT, then perform provider signature and transaction validations inside the handler.
- Keep the Duitku merchant API key and server-side Supabase credentials in Edge Function secrets.
- Use restrictive CORS for browser-facing functions. Callback does not need browser CORS.
- Do not expose tables directly unless grants and RLS are deliberately designed and tested.

## Persistence and atomicity

Proposed tables: orders, order_items, payments, and payment_callback_events. Unique constraints cover merchant_order_id, non-null Duitku reference, idempotency scope, and callback event fingerprint. A database RPC must lock the payment row, validate current state, insert the event, and update status in one transaction. No external HTTP request occurs inside a database transaction.

## Failure handling

- Provider 4xx: return a sanitized actionable error; retain correlation ID and safe provider status.
- Provider 5xx or network timeout after request transmission: result may be ambiguous; keep the attempt unresolved and require verified reconciliation/manual review.
- Malformed HTTP 200 response: treat as unresolved; never invent a reference or payment URL.
- Callback signature or identity mismatch: no mutation; log a sanitized security event.
- Database failure: callback must not return success acknowledgement if durable processing did not complete; allow provider retry.
- Duplicate callback: acknowledge after recognizing an already-applied valid event, without repeating side effects.

## Blocking contract issue

The current official POP page has a result-code inconsistency: Callback parameter table says 01 = Failed, while Errors → API Response → Callback says 02 = Failed. This blocks implementation of terminal failure mapping. Success 00 can be considered only after full signature and transaction validation; unknown/non-success values must not cause a terminal transition until clarified by Duitku.

## Source references

- https://docs.duitku.com/pop/id/ — Create Invoice, Callback, JS Callback, Redirect, Errors, Payment Method, Changelog.
- https://docs.duitku.com/pop/en/ — corresponding English reference and April 2026 signature changelog.
- https://supabase.com/docs/guides/functions
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/functions/secrets
