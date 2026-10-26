import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyCallbackSignature } from "../_shared/duitku-signature.ts";
import { jsonResponse, requestId } from "../_shared/response.ts";
import { requiredEnv, sha256Hex } from "../_shared/validation.ts";

Deno.serve(async (request) => {
  const rid = requestId();
  if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed", request_id: rid }, 405);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/x-www-form-urlencoded")) {
    return jsonResponse({ error: "unsupported_content_type", request_id: rid }, 415);
  }
  try {
    const form = new URLSearchParams(await request.text());
    const merchantCode = form.get("merchantCode") ?? "";
    const amountText = form.get("amount") ?? "";
    const merchantOrderId = form.get("merchantOrderId") ?? "";
    const resultCode = form.get("resultCode") ?? "";
    const reference = form.get("reference") ?? "";
    const signature = form.get("signature") ?? "";
    if (!merchantCode || !/^[0-9]+$/.test(amountText) || !merchantOrderId || !resultCode || !reference || !signature) {
      return jsonResponse({ error: "invalid_callback" }, 400);
    }
    const expectedMerchantCode = requiredEnv("DUITKU_MERCHANT_CODE");
    if (merchantCode !== expectedMerchantCode) return jsonResponse({ error: "invalid_callback" }, 400);
    const valid = await verifyCallbackSignature(
      merchantCode, amountText, merchantOrderId, signature, requiredEnv("DUITKU_API_KEY"),
    );
    if (!valid) return jsonResponse({ error: "invalid_callback" }, 400);

    const fingerprint = await sha256Hex([merchantCode, amountText, merchantOrderId, resultCode, reference].join("|"));
    const admin = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.rpc("apply_duitku_callback", {
      p_merchant_order_id: merchantOrderId,
      p_merchant_code: merchantCode,
      p_amount: Number(amountText),
      p_result_code: resultCode,
      p_reference: reference,
      p_event_fingerprint: fingerprint,
      p_signature_valid: true,
    });
    if (error || !data?.acknowledge) {
      console.error("duitku callback not durably applied", { request_id: rid, code: error?.code ?? "rejected" });
      return jsonResponse({ error: "callback_not_acknowledged", request_id: rid }, 500);
    }
    // Provider requires HTTP 200 acknowledgement after durable processing.
    return new Response("OK", { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
  } catch (error) {
    console.error("duitku callback failed", { request_id: rid, error: String(error).split(":")[0] });
    return jsonResponse({ error: "callback_processing_failed", request_id: rid }, 500);
  }
});
