/**
 * Cloudflare Pages Function: /api/config
 * Lưu trữ đồng bộ cấu hình Giải thưởng (prizes) và Cơ cấu quay thưởng (allocations)
 * trực tiếp trên Cloudflare KV (dùng chung binding CHECKINS_KV).
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",
  "Content-Type": "application/json; charset=utf-8",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet({ request, env }) {
  if (!env || !env.CHECKINS_KV) {
    return jsonResponse({ status: "unconfigured" }, 503);
  }
  const pwd = request.headers.get("X-Admin-Password");
  if (pwd !== "betatech1") {
    return jsonResponse({ status: "unauthorized" }, 401);
  }

  try {
    const [prizes, allocations] = await Promise.all([
      env.CHECKINS_KV.get("config:prizes", { type: "json" }),
      env.CHECKINS_KV.get("config:allocations", { type: "json" }),
    ]);

    return jsonResponse({
      status: "success",
      prizes: Array.isArray(prizes) ? prizes : null,
      allocations: Array.isArray(allocations) ? allocations : [],
    });
  } catch (err) {
    return jsonResponse({ status: "error", message: String(err) }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env || !env.CHECKINS_KV) {
    return jsonResponse({ status: "unconfigured" }, 503);
  }
  const pwd = request.headers.get("X-Admin-Password");
  if (pwd !== "betatech1") {
    return jsonResponse({ status: "unauthorized" }, 401);
  }

  try {
    const body = await request.json();
    if (Array.isArray(body.prizes)) {
      await env.CHECKINS_KV.put("config:prizes", JSON.stringify(body.prizes));
    }
    if (Array.isArray(body.allocations)) {
      await env.CHECKINS_KV.put("config:allocations", JSON.stringify(body.allocations));
    }
    return jsonResponse({ status: "success" });
  } catch (err) {
    return jsonResponse({ status: "error", message: String(err) }, 500);
  }
}
