/**
 * Cloudflare Pages Function: /api/logs
 * Theo dõi thiết bị đang truy cập (presence TTL 120s) & lưu vết toàn bộ hành động (audit log)
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

function formatVietnamTime(ms) {
  const d = new Date(ms + 7 * 3600 * 1000); // Chuẩn giờ Việt Nam UTC+7 (không phụ thuộc múi giờ máy khách)
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} - ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function parseDeviceSummary(ua) {
  const s = String(ua || "");
  let os = "Khác";
  if (/iPhone|iPad|iPod/i.test(s)) os = "iOS";
  else if (/Android/i.test(s)) os = "Android";
  else if (/Windows/i.test(s)) os = "Windows";
  else if (/Mac OS X/i.test(s)) os = "macOS";
  else if (/Linux/i.test(s)) os = "Linux";

  const type = /Mobi|Android|iPhone|iPad/i.test(s) ? "Mobile" : "Desktop";

  let browser = "Browser";
  if (/Zalo/i.test(s)) browser = "Zalo";
  else if (/Edg\//i.test(s)) browser = "Edge";
  else if (/Chrome\//i.test(s)) browser = "Chrome";
  else if (/Safari\//i.test(s)) browser = "Safari";
  else if (/Firefox\//i.test(s)) browser = "Firefox";

  return `${type} • ${os} (${browser})`;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost({ request, env }) {
  if (!env || !env.CHECKINS_KV) {
    return jsonResponse({ status: "unconfigured" }, 503);
  }

  try {
    const body = await request.json();
    const nowMs = Date.now();
    const ip =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("X-Forwarded-For") ||
      "unknown";
    const ua = request.headers.get("User-Agent") || "";
    const device = parseDeviceSummary(ua);
    const sessionId = String(body.sessionId || "SES-ANON").slice(0, 32);
    const tab = String(body.tab || "checkin").slice(0, 32);
    // Luôn dùng giờ chuẩn máy chủ Việt Nam (UTC+7) để không bị lệch múi giờ hoặc sai đồng hồ máy khách
    const timeStr = formatVietnamTime(nowMs);

    // 1. Luôn cập nhật trạng thái "đang truy cập" (tự hết hạn sau 120 giây nếu đóng trang)
    const presenceData = {
      sessionId,
      ip,
      device,
      tab,
      lastAction: String(body.action || "ONLINE").slice(0, 60),
      lastSeen: timeStr,
      lastSeenMs: nowMs,
    };
    await env.CHECKINS_KV.put(`presence:${sessionId}`, JSON.stringify(presenceData), {
      expirationTtl: 120,
    });

    // 2. Nếu là sự kiện hành động (không phải heartbeat thuần), ghi vào sổ vết log
    if (body.type !== "HEARTBEAT") {
      const rand = Math.random().toString(36).slice(2, 6);
      // Key sắp xếp giảm dần theo thời gian giúp list mới nhất cực nhanh
      const reverseTs = String(9999999999999 - nowMs).padStart(13, "0");
      const logKey = `log:${reverseTs}_${rand}`;
      const logEntry = {
        id: logKey,
        time: timeStr,
        isoTime: new Date(nowMs).toISOString(),
        ts: nowMs,
        sessionId,
        ip,
        device,
        tab,
        action: String(body.action || "EVENT").slice(0, 60),
        detail: String(body.detail || "").slice(0, 300),
      };
      await env.CHECKINS_KV.put(logKey, JSON.stringify(logEntry), {
        expirationTtl: 604800, // Lưu 7 ngày
      });
    }

    return jsonResponse({ status: "success" });
  } catch (err) {
    return jsonResponse({ status: "error", message: String(err) }, 500);
  }
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
    const [presenceList, logList] = await Promise.all([
      env.CHECKINS_KV.list({ prefix: "presence:", limit: 200 }),
      env.CHECKINS_KV.list({ prefix: "log:", limit: 250 }),
    ]);

    const [activeRaw, logsRaw] = await Promise.all([
      Promise.all(presenceList.keys.map((k) => env.CHECKINS_KV.get(k.name, { type: "json" }))),
      Promise.all(logList.keys.map((k) => env.CHECKINS_KV.get(k.name, { type: "json" }))),
    ]);

    const activeSessions = activeRaw
      .filter(Boolean)
      .map((s) => ({
        ...s,
        lastSeen: s.lastSeenMs ? formatVietnamTime(s.lastSeenMs) : s.lastSeen,
      }))
      .sort((a, b) => (b.lastSeenMs || 0) - (a.lastSeenMs || 0));

    const logs = logsRaw
      .filter(Boolean)
      .map((l) => ({
        ...l,
        time: l.ts ? formatVietnamTime(l.ts) : l.time,
      }))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));

    return jsonResponse({
      status: "success",
      source: "cloudflare_kv",
      activeSessions,
      logs,
    });
  } catch (err) {
    return jsonResponse({ status: "error", message: String(err) }, 500);
  }
}

export async function onRequestDelete() {
  return jsonResponse(
    { status: "forbidden", message: "Nhật ký hệ thống được bảo vệ, không cho phép xóa." },
    405
  );
}
