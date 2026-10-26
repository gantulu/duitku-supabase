import { createClient } from "npm:@supabase/supabase-js@2";
import { createDuitkuInvoice, type DuitkuEnvironment } from "../_shared/duitku-client.ts";
import { errorResponse, jsonResponse, requestId } from "../_shared/response.ts";
import { parseJsonObject, requiredEnv, safePaymentUrl, validIdempotencyKey, validUuid } from "../_shared/validation.ts";

Deno.serve(async (request) => {
  const rid = requestId();
  if (request.method !== "POST") return errorResponse(405, "method_not_allowed", rid);
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return errorResponse(401, "unauthorized", rid);

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) return errorResponse(401, "unauthorized", rid);

    const body = parseJsonObject(await request.json().catch(() => null));
    if (!body || !validUuid(body.order_id) || !validIdempotencyKey(body.idempotency_key)) {
      return errorResponse(400, "invalid_request", rid);
    }
    const paymentMethod = typeof body.payment_method === "string" && body.payment_method.length <= 32
      ? body.payment_method || null : null;
    if (body.payment_method !== undefined && body.payment_method !== null && paymentMethod === null) {
      return errorResponse(400, "invalid_payment_method", rid);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: reserved, error: reserveError } = await admin.rpc("reserve_duitku_payment", {
      p_order_id: body.order_id,
      p_user_id: userData.user.id,
      p_idempotency_key: body.idempotency_key,
      p_payment_method: paymentMethod,
    });
    if (reserveError || !reserved) {
      const message = reserveError?.message ?? "";
      const status = message.includes("order_not_found") ? 404 :
        message.includes("order_not_payable") || message.includes("order_totals_invalid") ? 409 : 400;
      return errorResponse(status, status === 404 ? "order_not_found" : "order_not_payable_or_invalid", rid);
    }

    const payment = reserved as Record<string, unknown>;
    if (payment.payment_url && payment.status === "pending") {
      return jsonResponse({
        payment_id: payment.id, merchant_order_id: payment.merchant_order_id,
        payment_url: payment.payment_url, status: payment.status, reused: true,
      }, 200, { "x-request-id": rid });
    }
    if (payment.reused === true) {
      return jsonResponse({
        payment_id: payment.id, merchant_order_id: payment.merchant_order_id,
        status: payment.status, needs_review: payment.status === "needs_review",
        message: "existing_attempt_not_reissued",
      }, 409, { "x-request-id": rid });
    }

    const [{ data: order, error: orderError }, { data: items, error: itemsError }] = await Promise.all([
      admin.from("orders").select("id,customer_name,customer_email,customer_phone,total_amount,shipping_cost,subtotal_amount").eq("id", body.order_id).eq("user_id", userData.user.id).maybeSingle(),
      admin.from("order_items").select("product_name,quantity,unit_price,line_total").eq("order_id", body.order_id),
    ]);
    if (orderError || itemsError || !order || !items?.length) {
      await admin.from("payments").update({ status: "needs_review", updated_at: new Date().toISOString() }).eq("id", payment.id);
      return errorResponse(500, "order_data_unavailable", rid);
    }

    const environment = requiredEnv("DUITKU_ENV");
    if (environment !== "sandbox" && environment !== "production") return errorResponse(500, "invalid_provider_environment", rid);
    const merchantCode = requiredEnv("DUITKU_MERCHANT_CODE");
    const apiKey = requiredEnv("DUITKU_API_KEY");
    const callbackUrl = requiredEnv("DUITKU_CALLBACK_URL");
    const returnUrl = requiredEnv("DUITKU_RETURN_URL");
    const payload: Record<string, unknown> = {
      paymentAmount: Number(payment.amount),
      merchantOrderId: payment.merchant_order_id,
      productDetails: items.map((item) => item.product_name).join(", ").slice(0, 255) || "Order payment",
      email: order.customer_email,
      callbackUrl,
      returnUrl,
      expiryPeriod: 60,
      itemDetails: items.map((item) => ({ name: item.product_name, price: Number(item.unit_price), quantity: item.quantity })),
      customerDetail: {
        firstName: order.customer_name,
        email: order.customer_email,
        phoneNumber: order.customer_phone ?? "",
      },
    };
    if (paymentMethod) payload.paymentMethod = paymentMethod;
    if (!Number.isSafeInteger(payload.paymentAmount) || (payload.paymentAmount as number) <= 0) {
      await admin.from("payments").update({ status: "needs_review", updated_at: new Date().toISOString() }).eq("id", payment.id);
      return errorResponse(500, "invalid_order_amount", rid);
    }

    let provider;
    try {
      provider = await createDuitkuInvoice(payload, {
        environment: environment as DuitkuEnvironment, merchantCode, apiKey, timeoutMs: 12_000,
      });
    } catch {
      await admin.from("payments").update({ status: "needs_review", updated_at: new Date().toISOString() }).eq("id", payment.id);
      return errorResponse(502, "provider_result_ambiguous", rid);
    }
    const responseBody = parseJsonObject(provider.body);
    if (provider.httpStatus !== 200 || !responseBody) {
      const isAmbiguous = provider.httpStatus >= 500;
      await admin.from("payments").update({
        status: isAmbiguous ? "needs_review" : "pending",
        provider_status_code: String(provider.httpStatus),
        updated_at: new Date().toISOString(),
      }).eq("id", payment.id);
      return errorResponse(isAmbiguous ? 502 : 400, isAmbiguous ? "provider_result_ambiguous" : "provider_request_rejected", rid);
    }

    const statusCode = typeof responseBody.statusCode === "string" ? responseBody.statusCode : "";
    const reference = typeof responseBody.reference === "string" ? responseBody.reference : "";
    const paymentUrl = responseBody.paymentUrl;
    const allowedHosts = requiredEnv("DUITKU_ALLOWED_PAYMENT_HOSTS").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
    if (statusCode !== "00" || !reference || !safePaymentUrl(paymentUrl, allowedHosts)) {
      await admin.from("payments").update({
        status: "needs_review", provider_status_code: statusCode || "malformed_response",
        updated_at: new Date().toISOString(),
      }).eq("id", payment.id);
      return errorResponse(502, "provider_response_needs_review", rid);
    }

    const { error: updateError } = await admin.from("payments").update({
      duitku_reference: reference, payment_url: paymentUrl, provider_status_code: statusCode,
      updated_at: new Date().toISOString(),
    }).eq("id", payment.id).eq("status", "pending");
    if (updateError) return errorResponse(500, "payment_persistence_failed", rid);

    return jsonResponse({
      payment_id: payment.id, merchant_order_id: payment.merchant_order_id,
      payment_url: paymentUrl, status: "pending", reused: false,
    }, 200, { "x-request-id": rid });
  } catch (error) {
    // Do not expose secrets or provider payloads in the client response.
    console.error("duitku-create-invoice failed", { request_id: rid, error: String(error).split(":")[0] });
    return errorResponse(500, "internal_error", rid);
  }
});
