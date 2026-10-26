import { createClient } from "npm:@supabase/supabase-js@2";
import { errorResponse, jsonResponse, requestId } from "../_shared/response.ts";
import { requiredEnv, validUuid } from "../_shared/validation.ts";

Deno.serve(async (request) => {
  const rid = requestId();
  if (request.method !== "GET") return errorResponse(405, "method_not_allowed", rid);
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return errorResponse(401, "unauthorized", rid);
  const orderId = new URL(request.url).searchParams.get("order_id");
  if (!validUuid(orderId)) return errorResponse(400, "invalid_order_id", rid);
  try {
    const url = requiredEnv("SUPABASE_URL");
    const authClient = createClient(url, requiredEnv("SUPABASE_ANON_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    });
    const { data: userData, error: authError } = await authClient.auth.getUser();
    if (authError || !userData.user) return errorResponse(401, "unauthorized", rid);
    const admin = createClient(url, requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: order, error: orderError } = await admin.from("orders").select("id,order_number,order_status,total_amount,currency,created_at").eq("id", orderId).eq("user_id", userData.user.id).maybeSingle();
    if (orderError || !order) return errorResponse(404, "order_not_found", rid);
    const { data: payment, error: paymentError } = await admin.from("payments").select("status,payment_method,created_at,paid_at").eq("order_id", orderId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (paymentError) return errorResponse(500, "status_unavailable", rid);
    return jsonResponse({
      order: { id: order.id, order_number: order.order_number, order_status: order.order_status, total_amount: order.total_amount, currency: order.currency, created_at: order.created_at },
      payment: payment ? { status: payment.status, payment_method: payment.payment_method, created_at: payment.created_at, paid_at: payment.paid_at } : null,
    }, 200, { "x-request-id": rid });
  } catch (error) {
    console.error("order-status failed", { request_id: rid, error: String(error).split(":")[0] });
    return errorResponse(500, "internal_error", rid);
  }
});
