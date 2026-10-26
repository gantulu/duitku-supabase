# Edge Functions

Handlers are TypeScript for the Deno-compatible Supabase Edge Runtime.

- `duitku-create-invoice`: authenticated customer endpoint; accepts `order_id`, `idempotency_key`, optional `payment_method`. Amount is derived from persisted order data via a server-only RPC.
- `duitku-callback`: public provider webhook; accepts form-urlencoded callbacks, validates HMAC-SHA256 and merchant code, and calls the atomic database RPC.
- `order-status`: authenticated owner-scoped status read; it does not query an undocumented provider inquiry endpoint.
- `_shared`: signature, API client, response, and input validation helpers.

**Deployment note:** this baseline keeps the requested `edge-functions/` directory. The standard Supabase CLI convention is `supabase/functions/<function-name>/index.ts`; a deployment workflow must map/copy these directories or a later reviewed change must relocate them. No deployment configuration or live function is changed here.

For customer-facing functions, configure gateway JWT verification and retain in-handler user/ownership checks. The callback must be publicly reachable without customer JWT and must rely on provider signature plus transaction validation. Keep secrets server-side.
