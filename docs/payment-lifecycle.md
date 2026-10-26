# Payment Lifecycle

> Status: proposed internal lifecycle, not yet implemented. Provider result-code conflicts are called out explicitly.

## Identifiers

- order.id: internal business order ID.
- payments.id: internal payment attempt ID.
- merchantOrderId: merchant-generated provider-facing identifier, max 50 characters per POP Create Invoice docs; unique and immutable per attempt.
- reference: Duitku-generated reference returned by Create Invoice; persist and bind to the payment attempt.
- paymentUrl: provider URL for customer payment; return only after response validation.

These identifiers are related but not interchangeable. Never derive payment status from an identifier or browser redirect.

## Internal states

- pending: provider invoice exists or payment is awaiting a verified final callback.
- paid: valid callback success code 00 has passed signature, merchant, order, amount and reference checks and was committed.
- failed: terminal failure only after Duitku clarifies the documented callback code conflict and implementation uses the confirmed code.
- needs_review: request outcome or callback result is ambiguous, malformed, unrecognized, or cannot be reconciled safely.

The needs_review state is an internal operational state, not a Duitku status.

## Transition rules

| Current state | Input | Next state | Rule |
|---|---|---|---|
| New | Order validated and payment attempt persisted | pending | Transactional creation with stable idempotency identity |
| pending | Valid callback 00 | paid | Must match merchant code, amount, merchantOrderId, and stored reference |
| pending | Callback non-success/unknown code | needs_review or remain pending | Do not infer terminal failure while official docs conflict |
| pending | Provider timeout / malformed response | needs_review | Never automatically create a new attempt with a new ID |
| paid | Duplicate valid success callback | paid | Record duplicate or acknowledge idempotently; no repeated side effects |
| paid | Delayed failed/pending callback | paid | Never downgrade paid |
| failed | Any conflicting callback | needs_review / manual review | No automatic paid downgrade or reversal without explicit verified policy |
| needs_review | Verified operator/reconciliation action | state per audited evidence | No unaudited manual mutation |

## Callback processing order

1. Enforce POST and documented application/x-www-form-urlencoded content type.
2. Parse body with size limits and reject malformed/duplicate critical fields.
3. Require documented core fields.
4. Compute callback HMAC-SHA256 over exact concatenation merchantCode + amount + merchantOrderId, keyed by merchant API key.
5. Compare signature safely and verify configured merchant code.
6. Find payment by exact merchantOrderId.
7. Match amount exactly as canonical integer representation and compare reference to stored Duitku reference. If provider delivery timing or data shape prevents safe matching, do not mutate.
8. Apply callback and state transition in one database transaction.
9. Return HTTP 200 only after durable valid processing or recognized idempotent duplicate, following the provider acknowledgement requirement. On database failure, do not falsely acknowledge successful processing.

The provider signature does not replace amount/reference/order consistency checks.

## Retry and timeout policy

- Use one stable idempotency key and merchant order ID per payment attempt.
- If a request definitively fails before it reaches Duitku, retry policy may be considered only with evidence no provider-side request was created.
- If timeout occurs after request transmission or provider response is ambiguous, set needs_review; do not create a fresh order ID and charge again.
- Duitku docs mention same-ID requests may return the same response for five minutes and may return HTTP 409 while in progress or HTTP 400 if amount differs. This behavior must inform retry logic.
- Do not implement provider inquiry/reconciliation until a current official POP endpoint contract is verified.
- Callback retries: official docs say callback delivery retries when HTTP 200 is not received, up to five attempts. Make handling idempotent.

## Status sources

- HTTP callback: source for payment state after validation.
- Duitku JS callback: customer UX notification only.
- Browser redirect query parameters: customer UX notification only; URL can be manually changed.
- Client-supplied status: never authoritative.

## Official contract blocker

The official POP reference disagrees on failure code: Callback parameter table lists 01 as failed; Errors → API Response → Callback lists 02 as failed. Do not implement terminal failure mapping until the provider confirms the authoritative value for the merchant's POP configuration.
