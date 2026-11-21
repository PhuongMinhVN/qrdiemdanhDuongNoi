/**
 * Hệ thống Điểm Danh Đại Biểu Điện Tử — MOBIFONE × BETATECH
 * Google Apps Script Serverless JSON API (Code.gs)
 *
 * Hướng dẫn triển khai:
 * 1. Mở Google Sheets -> Tiện ích mở rộng (Extensions) -> Apps Script.
 * 2. Dán toàn bộ nội dung file này vào Code.gs và Lưu.
 * 3. Nhấn Triển khai (Deploy) -> Tùy chọn triển khai mới (New deployment) -> Ứng dụng web (Web app).
 *    - Thực thi dưới dạng (Execute as): Tôi (Me)
 *    - Ai có quyền truy cập (Who has access): Bất kỳ ai (Anyone)
 * 4. Sao chép URL Web App và dán vào hằng số GOOGLE_SCRIPT_URL trong index.html.
 */

const SHEET_HEADERS = [
  "Thời gian",
  "Họ và tên",
  "Chức vụ",
  "Cơ quan / Đơn vị",
  "Số điện thoại",
  "Tọa độ GPS",
];

/**
 * Xử lý yêu cầu POST: Nhận dữ liệu điểm danh JSON và thêm dòng mới vào Google Sheets.
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ status: "error", message: "Empty request body" });
    }

    const payload = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    // Tự động tạo dòng tiêu đề nếu trang tính đang trống
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(SHEET_HEADERS);
      sheet.getRange(1, 1, 1, SHEET_HEADERS.length).setFontWeight("bold");
    }

    const time =
      payload.time ||
      payload.timestamp ||
      Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "HH:mm:ss - dd/MM/yyyy");
    const fullName = String(payload.fullName || "").trim();
    const position = String(payload.position || "").trim();
    const organization = String(payload.organization || "").trim();
    const rawPhone = String(payload.phone || "").trim();
    const gps = String(payload.gps || payload.gpsCoords || "Không có GPS").trim();

    // Thêm dấu nháy đơn ' phía trước số điện thoại để Google Sheets giữ nguyên số 0 ở đầu
    const formattedPhone = rawPhone ? (rawPhone.startsWith("'") ? rawPhone : "'" + rawPhone) : "";

    sheet.appendRow([time, fullName, position, organization, formattedPhone, gps]);

    return createJsonResponse({ status: "success" });
  } catch (err) {
    return createJsonResponse({
      status: "error",
      message: err && err.message ? err.message : String(err),
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Xử lý yêu cầu GET: Đọc toàn bộ danh sách điểm danh (bỏ qua dòng tiêu đề 1) và trả về mảng JSON.
 */
function doGet(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const lastRow = sheet.getLastRow();

    if (lastRow <= 1) {
      return createJsonResponse([]);
    }

    // Dùng getDisplayValues() để giữ nguyên chuỗi hiển thị (số 0 đầu SĐT và định dạng thời gian)
    const rows = sheet.getRange(2, 1, lastRow - 1, 6).getDisplayValues();

    const records = rows
      .filter((row) => row.some((cell) => String(cell).trim() !== ""))
      .map((row) => ({
        time: row[0] || "",
        fullName: row[1] || "",
        position: row[2] || "",
        organization: row[3] || "",
        phone: String(row[4] || "").replace(/^'/, ""),
        gps: row[5] || "Không có GPS",
      }))
      .reverse(); // Mới nhất lên đầu

    return createJsonResponse(records);
  } catch (err) {
    return createJsonResponse({
      status: "error",
      message: err && err.message ? err.message : String(err),
    });
  }
}

/**
 * Tạo phản hồi JSON chuẩn MIME type cho Web App (tương thích CORS khi deploy Anyone).
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON
  );
}
