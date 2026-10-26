# Database SQL

These SQL files are reviewed implementation artifacts, **not executed migrations**. Applying them to a live Supabase project is outside this change and requires a separate approval and schema audit.

Apply in order in a disposable local database first:

1. `table/products.sql`
2. `table/orders.sql`
3. `table/payments.sql`
4. `function/payment-rpc.sql`

The schema assumes authenticated checkout and a new, repository-owned `public.orders` schema. Do not apply if the target project already has order/product tables without reconciling schemas. RLS is enabled and no client policies are added. Verify service-role execution grants and test RLS/grants before use.

Open provider-contract item: non-success callback result codes are deliberately mapped to `needs_review`, not terminal `failed`, until Duitku confirms the documentation discrepancy.
