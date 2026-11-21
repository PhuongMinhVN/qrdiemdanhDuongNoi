/**
 * Cloudflare Pages Function: /api/checkins
 * Lưu trữ & đồng bộ dữ liệu điểm danh hội nghị trực tiếp trên Cloudflare KV.
 *
 * Yêu cầu Binding trong Cloudflare Pages -> Settings -> Bindings:
 *   - Type: KV Namespace
 *   - Variable name: CHECKINS_KV
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",
  "Content-Type": "application/json; charset=utf-8",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS,
  });
}

function formatVietnamTime(ms) {
  const d = new Date(ms + 7 * 3600 * 1000); // Chuẩn giờ Việt Nam UTC+7
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} - ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet({ env }) {
  if (!env || !env.CHECKINS_KV) {
    return jsonResponse(
      { status: "unconfigured", message: "Chưa gắn KV Namespace CHECKINS_KV" },
      503
    );
  }

  try {
    const keys = [];
    let cursor = undefined;
    do {
      const list = await env.CHECKINS_KV.list({ prefix: "checkin:", cursor });
      keys.push(...list.keys);
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);

    const values = await Promise.all(
      keys.map((k) => env.CHECKINS_KV.get(k.name, { type: "json" }))
    );

    const records = values
      .filter(Boolean)
      .sort((a, b) => {
        const ta = new Date(a.isoTime || 0).getTime();
        const tb = new Date(b.isoTime || 0).getTime();
        return tb - ta; // Mới nhất lên đầu
      });

    return jsonResponse({ status: "success", source: "cloudflare_kv", data: records });
  } catch (err) {
    return jsonResponse({ status: "error", message: String(err) }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env || !env.CHECKINS_KV) {
    return jsonResponse(
      { status: "unconfigured", message: "Chưa gắn KV Namespace CHECKINS_KV" },
      503
    );
  }

  try {
    const payload = await request.json();
    if (!payload || !payload.fullName) {
      return jsonResponse({ status: "error", message: "Thiếu thông tin Họ và tên" }, 400);
    }

    const nowMs = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);
    const id = payload.id || `MB-${String(nowMs).slice(-5)}`;
    const key = `checkin:${nowMs}_${rand}`;

    const serverVnTime = formatVietnamTime(nowMs);
    const record = {
      id,
      time: serverVnTime,
      timestamp: serverVnTime,
      isoTime: new Date(nowMs).toISOString(),
      fullName: String(payload.fullName || "").trim(),
      position: String(payload.position || "").trim(),
      organization: String(payload.organization || "").trim(),
      phone: String(payload.phone || "").trim(),
      gps: String(payload.gps || payload.gpsCoords || "Không có GPS").trim(),
      gpsCoords: String(payload.gpsCoords || payload.gps || "Không có GPS").trim(),
      gpsStatus: payload.gpsStatus || "unavailable",
      gpsLabel: payload.gpsLabel || "",
      distanceMeters: payload.distanceMeters ?? null,
    };

    // Lưu mỗi đại biểu 1 key riêng để không bao giờ bị ghi đè khi nhiều người quét cùng lúc
    await env.CHECKINS_KV.put(key, JSON.stringify(record));

    return jsonResponse({ status: "success", source: "cloudflare_kv", id: record.id });
  } catch (err) {
    return jsonResponse({ status: "error", message: String(err) }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  if (!env || !env.CHECKINS_KV) {
    return jsonResponse({ status: "unconfigured" }, 503);
  }

  const pwd = request.headers.get("X-Admin-Password");
  if (pwd !== "betatech1") {
    return jsonResponse({ status: "unauthorized" }, 401);
  }

  try {
    let cursor = undefined;
    do {
      const list = await env.CHECKINS_KV.list({ prefix: "checkin:", cursor });
      await Promise.all(list.keys.map((k) => env.CHECKINS_KV.delete(k.name)));
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);

    return jsonResponse({ status: "success", cleared: true });
  } catch (err) {
    return jsonResponse({ status: "error", message: String(err) }, 500);
  }
}
