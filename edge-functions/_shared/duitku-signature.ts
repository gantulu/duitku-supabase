const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message))));
}

export async function createInvoiceSignature(merchantCode: string, timestampMs: string, apiKey: string) {
  return await hmacSha256Hex(merchantCode + timestampMs, apiKey);
}

export async function verifyCallbackSignature(
  merchantCode: string,
  amount: string,
  merchantOrderId: string,
  signature: string,
  apiKey: string,
): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = await hmacSha256Hex(merchantCode + amount + merchantOrderId, apiKey);
  const a = new TextEncoder().encode(expected.toLowerCase());
  const b = new TextEncoder().encode(signature.toLowerCase());
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
