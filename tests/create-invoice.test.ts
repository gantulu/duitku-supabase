import { assertEquals } from "jsr:@std/assert@1";
import { duitkuEndpoint } from "../edge-functions/_shared/duitku-client.ts";
import { safePaymentUrl, validIdempotencyKey, validUuid } from "../edge-functions/_shared/validation.ts";

Deno.test("Create Invoice endpoints are official Duitku endpoints", () => {
  assertEquals(duitkuEndpoint("sandbox"), "https://api-sandbox.duitku.com/api/merchant/createInvoice");
  assertEquals(duitkuEndpoint("production"), "https://api-prod.duitku.com/api/merchant/createInvoice");
});

Deno.test("validation rejects untrusted payment URLs and weak idempotency keys", () => {
  assertEquals(safePaymentUrl("http://pay.example.test", ["pay.example.test"]), false);
  assertEquals(safePaymentUrl("https://evil.example.test", ["payment.duitku.com"]), false);
  assertEquals(safePaymentUrl("https://payment.duitku.com/abc", ["payment.duitku.com"]), true);
  assertEquals(validIdempotencyKey("short"), false);
  assertEquals(validIdempotencyKey("0123456789abcdef"), true);
  assertEquals(validUuid("00000000-0000-4000-8000-000000000000"), true);
});
