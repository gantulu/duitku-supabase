import { assertEquals } from "jsr:@std/assert@1";
import { verifyCallbackSignature } from "../edge-functions/_shared/duitku-signature.ts";
import { sha256Hex } from "../edge-functions/_shared/validation.ts";

Deno.test("callback fingerprint is stable for normalized core fields", async () => {
  const input = ["DXXXX", "150000", "ORDER-1", "00", "REF-1"].join("|");
  assertEquals(await sha256Hex(input), await sha256Hex(input));
});

Deno.test("invalid callback signature is rejected", async () => {
  assertEquals(await verifyCallbackSignature("DXXXX", "150000", "ORDER-1", "not-a-signature", "test-key"), false);
});
