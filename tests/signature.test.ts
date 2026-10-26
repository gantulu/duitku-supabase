import { assertEquals } from "jsr:@std/assert@1";
import { createInvoiceSignature, verifyCallbackSignature } from "../edge-functions/_shared/duitku-signature.ts";

Deno.test("Create Invoice signature is deterministic HMAC-SHA256 hex", async () => {
  const first = await createInvoiceSignature("DXXXX", "1629219840000", "test-key");
  const second = await createInvoiceSignature("DXXXX", "1629219840000", "test-key");
  assertEquals(first, second);
  assertEquals(first.length, 64);
});

Deno.test("callback signature validates only matching input", async () => {
  const signature = await (async () => {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("test-key"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("DXXXX150000ORDER-1")));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  })();
  assertEquals(await verifyCallbackSignature("DXXXX", "150000", "ORDER-1", signature, "test-key"), true);
  assertEquals(await verifyCallbackSignature("DXXXX", "150001", "ORDER-1", signature, "test-key"), false);
});
