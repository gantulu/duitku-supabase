import { createInvoiceSignature } from "./duitku-signature.ts";

export type DuitkuEnvironment = "sandbox" | "production";

export function duitkuEndpoint(environment: DuitkuEnvironment): string {
  return environment === "sandbox"
    ? "https://api-sandbox.duitku.com/api/merchant/createInvoice"
    : "https://api-prod.duitku.com/api/merchant/createInvoice";
}

export async function createDuitkuInvoice(
  payload: Record<string, unknown>,
  config: { environment: DuitkuEnvironment; merchantCode: string; apiKey: string; timeoutMs?: number },
) {
  const timestamp = String(Date.now());
  const signature = await createInvoiceSignature(config.merchantCode, timestamp, config.apiKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 12_000);
  try {
    const response = await fetch(duitkuEndpoint(config.environment), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-duitku-timestamp": timestamp,
        "x-duitku-signature": signature,
        "x-duitku-merchantcode": config.merchantCode,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = null; }
    return { httpStatus: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}
