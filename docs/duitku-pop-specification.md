# Duitku POP Specification

> Status: documentation research baseline, 2026-10-26. This file records the official POP pages successfully inspected. It is not a claim that sandbox transactions were executed. Re-check the official pages before implementation because the provider changelog is current and can change.

## Sources inspected

- [Duitku POP Bahasa Indonesia](https://docs.duitku.com/pop/id/) — sections: Pendahuluan, Integrasi Backend/Create Invoice, Obyek JSON, Callback, Integrasi Frontend/JS Callback/Window Redirection, Payment Method, Errors, Uji Coba, Changelog.
- [Duitku POP English](https://docs.duitku.com/pop/en/) — corresponding English API reference.
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions) — Deno-compatible TypeScript runtime, HTTP/webhook use, local serve, idempotency and secrets overview.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) — RLS and grants are separate controls; service role bypasses RLS and must remain server-side.
- [Supabase Function secrets](https://supabase.com/docs/guides/functions/secrets) — production secrets via Dashboard/CLI; local secrets in `supabase/functions/.env`, ignored by Git.

## 1. Create Invoice API

### Endpoint and transport

| Item | Official contract |
|---|---|
| Method | HTTP POST |
| Content type | `application/json` |
| Sandbox | `https://api-sandbox.duitku.com/api/merchant/createInvoice` |
| Production | `https://api-prod.duitku.com/api/merchant/createInvoice` |
| Required headers | `Content-Type`, `x-duitku-timestamp`, `x-duitku-signature`, `x-duitku-merchantcode` |

Source: POP ID/EN, Backend Integration → Create Invoice, https://docs.duitku.com/pop/id/ and https://docs.duitku.com/pop/en/.

### Request signature (current documented method)

The Create Invoice header signature is HMAC-SHA256, not the callback signature by assumption; each operation must be implemented/tested independently.

- String to sign: `merchantCode + timestamp`
- Key: merchant API key
- Output shown by official example: lowercase hexadecimal digest
- Header: `x-duitku-signature`
- Timestamp header: `x-duitku-timestamp`, documented as UNIX timestamp in milliseconds. The docs phrase this as being in Duitku/Jakarta timezone; because Unix epoch milliseconds are an absolute instant, implementation should use epoch milliseconds and must not add a timezone offset. Confirm with Duitku if provider behavior contradicts this interpretation.
- Merchant code header: `x-duitku-merchantcode`

Source: Create Invoice → Request Headers and official code example, same URLs.

### Create Invoice request fields

The official table identifies the following top-level fields. Requiredness below follows the POP Create Invoice parameter table; fields in nested objects are optional unless the table explicitly says otherwise.

| Field | Type / documented limit | Required | Notes |
|---|---|---:|---|
| `paymentAmount` | integer | Yes | Amount in IDR in examples; calculate from trusted server-side order data. |
| `merchantOrderId` | string, max 50 | Yes | Merchant-generated order identifier; keep unique and stable for retries. |
| `productDetails` | string, max 255 | Yes | Product/payment description. |
| `email` | string, max 255 in top-level table | Yes | Customer email. |
| `additionalParam` | string, max 255 | No | Optional extra parameter. |
| `merchantUserInfo` | string, max 255 | No | Optional merchant-side customer username/email. |
| `customerVaName` | string, max 20 | No | Name displayed on payment confirmation page. |
| `phoneNumber` | string, max 50 | No | Customer phone. |
| `itemDetails` | array of item objects | No | Each item has `name`, `price`, `quantity`; validate types and totals. |
| `customerDetail` | object | No | See nested fields below. |
| `creditCardDetail` | object | No | Optional, channel-specific; tokenization requires account support. |
| `callbackUrl` | string, max 255 | Yes | Public server-to-server HTTP callback endpoint. |
| `returnUrl` | string, max 255 | Yes | Browser redirect after transaction finishes/cancels; not payment proof. |
| `expiryPeriod` | integer, minutes | No | Examples include 5, 10, 60 minutes; confirm acceptable values with merchant/channel and current provider rules. |
| `paymentMethod` | string | No | POP payment channel code; use only codes listed in the current official Payment Method section. |

Sources: POP ID/EN → Create Invoice parameter table and JSON Object.

### Nested objects

- `customerDetail`: optional `firstName`, `lastName`, `email`, `phoneNumber`, `billingAddress`, `shippingAddress`, `merchantCustomerId`. The documented `merchantCustomerId` limit is 100 characters and it is required for tokenization features.
- Address fields: `firstName`, `lastName`, `address`, `city`, `postalCode`, `phone`, `countryCode`. The docs table says `countryCode` is ISO 3166-1 alpha-3 but examples use `ID` (alpha-2). This is an inconsistency in the official page; do not silently assume the standard/example conflict is resolved. Confirm with Duitku for production use.
- `itemDetails[]`: `name`, `price`, `quantity`; the item table should be checked in the official JSON Object section before coding exact per-field limits.
- `creditCardDetail`: `saveCardToken` (values 1 or 2 described), optional `acquirer`, and `binWhitelist` (up to 25 entries per docs). Do not enable tokenization unless specifically required and the merchant account supports it.

Source: POP ID/EN → JSON Object, Customer Detail, Address, Credit Card Detail.

### Response

On HTTP 200, the official example parses JSON with fields including:
- `reference`: Duitku transaction reference; persist it.
- `paymentUrl`: payment page URL; validate before returning/redirecting.
- `statusCode` and `statusMessage`: present in the documented example.

Do not assume fields are present merely because the HTTP status is 200: validate response shape and required values. Treat malformed/ambiguous responses as unresolved, not as permission to create another invoice automatically.

Source: POP ID/EN → Create Invoice response example.

## 2. HTTP callback

### Transport and acknowledgement

- Method: HTTP POST.
- Content type: `application/x-www-form-urlencoded`.
- Callback URL must be publicly accessible on port 80 or 443.
- Provider documentation requires HTTP 200 OK as the successful acknowledgement.
- Provider retries if it does not receive HTTP 200; the docs state a maximum of 5 attempts and that failed delivery is emailed. A resend facility is documented in the Duitku dashboard.
- The current docs list production and sandbox outgoing IPs for optional network allowlisting. IP allowlisting is supplementary; signature verification remains required.

Source: POP ID/EN → Callback, https://docs.duitku.com/pop/id/ and https://docs.duitku.com/pop/en/.

### Callback fields

Documented fields include:

- Core: `merchantCode`, `amount`, `merchantOrderId`, `resultCode`, `reference`, `signature`.
- Additional: `productDetail`, `additionalParam`, `paymentCode`, `merchantUserId`, `publisherOrderId`, `spUserHash`, `settlementDate`, `issuerCode`, `bankAppCode`, `bankOrderId`, `bankRespCode`, `bankRespMsg`, `cardName`, `cardType`, `maskedNumber`, `tokenId`, `transactionState`, `transactionStateStatus`, `merchantCustomerId`, `expiryDate`, and (added June 2026) `customerName`.
- `settlementDate` is documented as `YYYY-MM-DD`.
- Some fields are payment-channel-specific; do not require optional channel fields for every callback.

Source: POP ID/EN → Callback parameter table and changelog.

### Callback signature (separate from Create Invoice)

The official callback example specifies:

- String to sign: `merchantCode + amount + merchantOrderId`
- Key: merchant API key
- Algorithm: HMAC-SHA256
- Signature field: `signature`
- The docs mark the older MD5 method as obsolete. Changelog (April 2026, English page) also states HMAC enhancement and obsolete MD5/SHA-256 methods; follow the current HMAC example, not legacy MD5.

Verify required field presence, signature, merchant code, merchant order ID, amount, and internal reference/transaction binding before any mutation. Compare signatures safely. Do not rely on browser events or redirect parameters for payment state.

Source: POP ID/EN → Callback and Changelog.

### Callback result codes

The current callback table lists:
- `00`: Success.
- `01`: Failed.

The separate Redirect table lists `00` Success, `01` Process, `02` Canceled/Failed. These are different contracts: do not reuse redirect codes as HTTP callback codes. Unknown callback codes must not be guessed into a terminal state; record/alert and follow provider guidance.

Source: POP ID/EN → Errors → API Response.

## 3. Browser JS callback and redirect are not authoritative

The POP JavaScript callback includes `resultCode`, `merchantOrderId`, and `reference`. The official documentation explicitly says JavaScript callback is for notifying the customer and must not change merchant system payment status; use HTTP callback for that purpose.

The Create Invoice `returnUrl` is a browser redirect and likewise must not be trusted as payment confirmation.

Source: POP ID/EN → JS Callback and Window Redirection.

## 4. HTTP/API errors and duplicate requests

Official HTTP response table includes:
- `400 Bad Request`: invalid request.
- `400 Amount is different please try again later.`: same order ID retried/recreated at the same time with a different amount.
- `401 Unauthorized`: access denied.
- `404 Not Found`: endpoint/resource not found.
- `409 The transaction is still in progress.`: repeated same order ID while first request is still processing.
- `500 Internal Server Error`: processing failure.

Implications for internal design:
- Enforce idempotency on merchant order identity and amount.
- Never reuse a merchantOrderId with a different amount.
- A timeout or 5xx after sending a request is ambiguous; do not blindly generate a new order ID and retry. Preserve an unresolved state and use only provider-supported reconciliation/resend capabilities after their contract is verified.
- Do not infer that an undocumented inquiry endpoint is part of POP. Confirm endpoint, auth, signature and response in current official docs before implementing reconciliation.

Source: POP ID/EN → Errors → HTTP Response.

## 5. Expiry and status lifecycle

- `expiryPeriod` is measured in minutes; examples show 5, 10, and 60.
- Callback result codes are `00` success and `01` failed in the current callback table.
- Redirect codes are separately documented as `00` success, `01` process, `02` canceled/failed.
- A pending/processing concept appears in the POP JS callback and redirect flow, but it must not be mapped to an HTTP callback code without explicit provider support.
- Do not assume every failed/expired/abandoned transaction generates a callback; document and test this against provider behavior.

Source: POP ID/EN → Create Invoice, Callback, JS Callback, Errors.

## 6. Payment methods

Payment method codes are channel-specific and are maintained in the official Payment Method section. Do not hard-code a third-party list or enable channels solely from examples. Channel availability can depend on merchant configuration. For V1, support an allowlisted subset agreed with the merchant account and validated against the current official list.

Source: POP ID/EN → Payment Method.

## 7. Changelog checked

The Indonesian page currently lists:
- Sep 2026: removal of QRIS Gudang Voucher.
- Jun 2026: callback `customerName` issuer-account field.
- Feb 2026: Tokopedia Card Payment, Tokopedia E-Wallet, Tokopedia Others; E-Commerce testing.
- Dec 2025: callback requirements added.
- Oct 2025: `customerDetail.merchantCustomerId`, `creditCardDetail.saveCardToken`, callback `merchantCustomerId` and `tokenId`.
- Aug 2025: removal of QRIS Dana; Jenius staging demo URL fix.
- Older entries from 2022, 2020, and 2019 concern credit-card details, customer detail/address, and expiry/VA response fields.

The English changelog additionally shows Apr 2026: HMAC signature enhancement and MD5/SHA-256 marked obsolete. Confirm the exact current changelog on both language pages before implementation.

Source: POP ID/EN → Changelog.

## 8. Supabase platform constraints relevant to this integration

- Edge Functions run server-side TypeScript on a Deno-compatible runtime and are suitable for third-party API calls and public webhook receivers.
- Design handlers for short-lived execution, timeouts, and idempotency.
- Keep Duitku API key and Supabase secret/service-role credentials in Edge Function secrets, never browser code or committed files.
- For local Edge Functions, Supabase documents `supabase/functions/.env`; add it to `.gitignore`.
- RLS policies do not replace table grants. Secure exposed tables with both grants and policies and test them.
- Supabase secret/service-role credentials bypass RLS and must remain server-side.

Sources:
- https://supabase.com/docs/guides/functions
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/functions/secrets

## 9. Open questions / must verify before implementation

1. Confirm the current full JSON Object table, including every field's exact type/limit and response schema.
2. Confirm accepted `expiryPeriod` values and whether channel/merchant-specific limits apply; examples alone do not prove an exhaustive allowed set.
3. Confirm country-code alpha-2/alpha-3 discrepancy with Duitku.
4. Verify any inquiry/status-check endpoint only if explicitly documented for POP; do not invent it.
5. Confirm current signature output casing/encoding and test against official examples for both Create Invoice and callback.
6. Confirm exact behavior for duplicate callback acknowledgements and all callback result codes with provider documentation/support where the page is silent.
7. Treat amount units/currency constraints and per-channel fields as official-contract items to validate before shipping.

## 10. Internal decisions (not provider facts)

These are proposed safe implementation rules, not claims made by Duitku:
- Maintain an internal payment record separate from the business order.
- Store money as integer IDR.
- Enforce unique `merchantOrderId` and provider `reference` where available.
- Verify signature and transaction identity before mutation; update status and insert callback audit event atomically.
- Never downgrade a terminal paid state from a delayed callback.
- Make callback processing idempotent and keep raw payload retention minimal/sanitized.
- Treat request timeouts and uncertain provider responses as unresolved until reconciled by a verified provider-supported method.
- Never let browser redirects or JavaScript callbacks mark an order paid.
