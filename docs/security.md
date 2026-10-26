# Security Model

> Status: proposed controls; implementation and verification are pending.

## Trust boundaries

- Client requests are untrusted, including order IDs, amount, payment method, idempotency key, return URL, and claimed payment status.
- Duitku Create Invoice requests and callback signatures are separate contracts. Do not reuse signing logic without distinct tests.
- Only validated HTTP callbacks may drive payment-state transitions.
- Supabase service-role and Duitku API key are privileged secrets and must remain server-side.

## Authentication and authorization

- Customer-facing functions validate Supabase Auth JWT and verify the authenticated user owns the order.
- A valid JWT alone does not authorize access to arbitrary order IDs.
- The callback is server-to-server and does not require a customer JWT; it requires strict request parsing, HMAC verification, merchant identity checks and internal transaction matching.
- Do not use IP allowlisting as the only callback authentication. It may be supplementary, based on current provider-published IP ranges and infrastructure support.

## Signature verification

Create Invoice request:
- Exact source formula: merchantCode + timestamp.
- HMAC-SHA256 with merchant API key.
- Timestamp in UNIX milliseconds.
- Official example emits lowercase hex.

HTTP callback:
- Exact source formula: merchantCode + amount + merchantOrderId.
- HMAC-SHA256 with merchant API key.
- Callback signature is compared against the computed signature.
- Legacy SHA-256/MD5 approach is marked obsolete in the official English changelog.

Implementation requirements:
- Preserve exact string values and concatenation order.
- Do not parse/reformat amount before signature calculation; use the original callback field representation for signing.
- Reject missing or malformed critical fields.
- Compare digests using a safe constant-time comparison where the runtime supports it.
- Never log API keys, full payment URLs with tokens, card data, or full callback payloads by default.

## Input and response validation

- Server calculates order totals from trusted persisted order lines.
- Use integer amounts only; validate positive amount, quantity bounds and item total consistency.
- Use allowlisted payment methods supported for the merchant.
- Validate Create Invoice HTTP status and JSON schema, including expected merchant code, status code, reference and payment URL.
- Accept only HTTPS payment URLs on approved Duitku domains; confirm current hostnames from provider docs/config before enforcing an allowlist.
- Never let client choose callback URL, return URL, API endpoint, or production/sandbox environment.
- Sanitize errors returned to clients and preserve internal correlation IDs.

## Database protection

- Enable RLS on exposed tables and configure least-privilege grants separately.
- Revoke client mutation privileges on payment and callback audit tables.
- Restrict callback transition RPC execution to trusted server credentials.
- Lock payment rows and insert callback audit events atomically.
- Use unique constraints and idempotency keys to protect against concurrent duplicate requests.
- Prevent state regression from paid to pending or failed.

## Abuse resistance and operations

- Apply request body size limits, input validation, CORS allowlists for browser APIs, and rate limits where supported.
- Use bounded provider request timeouts and avoid retry storms.
- Monitor callback signature failures, unknown result codes, amount/reference mismatches, provider 4xx/5xx, unresolved timeouts and callback delivery gaps.
- Store minimal, sanitized audit events with defined retention and access controls.
- Rotate secrets through Supabase secret management; never commit actual values.
- Use sandbox credentials for tests; production credentials only in production secret storage and never in test fixtures.

## Deployment gates

- Confirm callback failure result code with Duitku because current docs conflict (01 vs 02).
- Verify exact POP callback URL, merchant code and secrets in sandbox.
- Verify RLS, grants, function JWT configuration, CORS and callback reachability.
- Run signature, callback idempotency, concurrent callback, ownership and database-failure tests.
- Complete real sandbox end-to-end test before any production consideration.
- Production readiness requires reviewed migrations, monitoring/alerting, incident/reconciliation runbook and explicit authorization.
