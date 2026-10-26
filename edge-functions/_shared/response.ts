export function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders },
  });
}

export function errorResponse(status: number, code: string, requestId: string) {
  return jsonResponse({ error: code, request_id: requestId }, status);
}

export function requestId() {
  return crypto.randomUUID();
}
