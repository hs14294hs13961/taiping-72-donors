/**
 * 新竹縣關西鎮太平國民小學 72週年校慶捐款芳名錄 - Google Apps Script (GAS) 後端
 *
 * 【支援兩種建立方式】
 * 方式 A：從 Google 試算表內點選「擴充功能 > Apps Script」貼上（自動綁定該試算表）
 * 方式 B：直接建立獨立的 Apps Script 專案貼上（程式會自動在您的 Google 雲端硬碟建立一份
 *         名為「太平國小72週年校慶捐款芳名錄」的試算表並自動記住 ID，完全不會報錯！）
 *
 * 💡 若您想指定特定的試算表，也可將試算表網址中的 ID 貼在下方 SPREADSHEET_ID 引號內。
 */

const SPREADSHEET_ID = ''; // 選填：留空即可自動偵測或自動建立試算表！
const SHEET_NAME = '捐款芳名錄';
const CACHE_KEY = 'DONATIONS_JSON_CACHE_V1';
const SETTINGS_PROP_KEY = 'DISPLAY_SETTINGS_JSON'; // 後台送來的大屏顯示設定（樣式、字色、版面、字級）

/**
 * 首次測試與授權專用函式（在 GAS 編輯器上方選取 setup 並按「執行」即可完成授權與初始化）
 */
function setup() {
  const sheet = getOrCreateSheet();
  const ss = sheet.getParent();
  Logger.log('✅ 初始化成功！');
  Logger.log('📊 綁定的 Google 試算表名稱：' + ss.getName());
  Logger.log('🔗 試算表網址：' + ss.getUrl());
}

/**
 * 智慧取得試算表物件（支援綁定試算表、指定 ID、或自動新建試算表）
 */
function getSpreadsheet() {
  // 1. 若有手動填寫 SPREADSHEET_ID，優先使用
  if (SPREADSHEET_ID && SPREADSHEET_ID.trim() !== '') {
    return SpreadsheetApp.openById(SPREADSHEET_ID.trim());
  }

  // 2. 若是從試算表內「擴充功能 > Apps Script」開啟的專案，直接取得當前試算表
  const activeSs = SpreadsheetApp.getActiveSpreadsheet();
  if (activeSs) {
    return activeSs;
  }

  // 3. 若是獨立建立的 GAS 專案 (getActiveSpreadsheet 為 null)，從屬性讀取或自動建立試算表
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty('AUTO_SPREADSHEET_ID');
  if (savedId) {
    try {
      return SpreadsheetApp.openById(savedId);
    } catch (e) {
      // 若原試算表被刪除則重新建立
    }
  }

  // 自動在 Google 雲端硬碟建立一份新的試算表並記住 ID
  const newSs = SpreadsheetApp.create('太平國小72週年校慶捐款芳名錄_資料庫');
  props.setProperty('AUTO_SPREADSHEET_ID', newSs.getId());
  Logger.log('✨ 已自動在您的 Google 雲端硬碟建立試算表：' + newSs.getUrl());
  return newSs;
}

/**
 * 取得或自動建立工作表
 */
function getOrCreateSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    const headers = ['ID', '捐款人或單位', '捐贈類別', '原始輸入(金額或物資)', '大屏顯示文字', '備註', '登錄時間'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#b71c1c')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 80);
    sheet.setColumnWidth(2, 220);
    sheet.setColumnWidth(3, 90);
    sheet.setColumnWidth(4, 160);
    sheet.setColumnWidth(5, 220);
    sheet.setColumnWidth(6, 150);
    sheet.setColumnWidth(7, 160);
  }
  return sheet;
}

/**
 * 讀取試算表所有捐款資料（含快取加速）
 */
function getDonationsData(forceRefresh) {
  const cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    const cached = cache.get(CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  }

  const sheet = getOrCreateSheet();
  const ss = sheet.getParent();
  const lastRow = sheet.getLastRow();
  let items = [];

  if (lastRow >= 2) {
    const values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      const donor = String(row[1] || '').trim();
      if (!donor) continue;
      items.push({
        rowNumber: i + 2,
        id: String(row[0] || (i + 1)),
        donor: donor,
        type: String(row[2] || '禮金'),
        rawContent: String(row[3] || ''),
        displayContent: String(row[4] || row[3] || ''),
        note: String(row[5] || ''),
        updatedAt: row[6] ? new Date(row[6]).toISOString() : ''
      });
    }
  }

  // 後台設定的大屏顯示樣式，跟名單一起回傳，讓任何裝置上的大屏都能跟著切換
  let settings = null;
  try {
    const savedSettings = PropertiesService.getScriptProperties().getProperty(SETTINGS_PROP_KEY);
    if (savedSettings) settings = JSON.parse(savedSettings);
  } catch (e) {}

  const payload = {
    status: 'ok',
    settings: settings,
    spreadsheetUrl: ss.getUrl(),
    updatedAt: new Date().toISOString(),
    count: items.length,
    items: items
  };

  try {
    cache.put(CACHE_KEY, JSON.stringify(payload), 60);
  } catch (e) {}

  return payload;
}

/**
 * 清除快取（當資料異動時呼叫）
 */
function clearDonationsCache() {
  try {
    CacheService.getScriptCache().remove(CACHE_KEY);
  } catch (e) {}
}

/**
 * 處理 HTTP GET 請求（大屏前台每 5 秒輪詢 & 後台讀取清單）
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    const action = params.action || 'list';

    if (action === 'ping') {
      const sheet = getOrCreateSheet();
      return jsonResponse({
        status: 'ok',
        message: '太平國小72週年校慶芳名錄 GAS 伺服器運作正常',
        spreadsheetUrl: sheet.getParent().getUrl()
      });
    }

    const forceRefresh = params.refresh === '1';
    const data = getDonationsData(forceRefresh);
    return jsonResponse(data);
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

/**
 * 處理 HTTP POST 請求（後台新增、修改、刪除、清空）
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const bodyStr = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const body = JSON.parse(bodyStr);
    const action = body.action || 'add';
    const sheet = getOrCreateSheet();
    const nowStr = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');

    if (action === 'add') {
      const donor = String(body.donor || '').trim();
      if (!donor) {
        return jsonResponse({ status: 'error', message: '請輸入捐款人或單位名稱' });
      }
      const type = String(body.type || '禮金').trim();
      const rawContent = String(body.rawContent || '').trim();
      const displayContent = String(body.displayContent || rawContent).trim();
      const note = String(body.note || '').trim();
      const id = body.id || Utilities.getUuid().slice(0, 8);

      sheet.appendRow([id, donor, type, rawContent, displayContent, note, nowStr]);
      clearDonationsCache();
      return jsonResponse(getDonationsData(true));
    }

    if (action === 'update') {
      const targetId = String(body.id || '');
      const lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (let i = 0; i < ids.length; i++) {
          if (String(ids[i][0]) === targetId) {
            const rowIdx = i + 2;
            sheet.getRange(rowIdx, 2, 1, 6).setValues([[
              String(body.donor || '').trim(),
              String(body.type || '禮金').trim(),
              String(body.rawContent || '').trim(),
              String(body.displayContent || '').trim(),
              String(body.note || '').trim(),
              nowStr
            ]]);
            clearDonationsCache();
            return jsonResponse(getDonationsData(true));
          }
        }
      }
      return jsonResponse({ status: 'error', message: '找不到指定的資料列' });
    }

    if (action === 'delete') {
      const targetId = String(body.id || '');
      const lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (let i = 0; i < ids.length; i++) {
          if (String(ids[i][0]) === targetId) {
            sheet.deleteRow(i + 2);
            clearDonationsCache();
            return jsonResponse(getDonationsData(true));
          }
        }
      }
      return jsonResponse({ status: 'error', message: '找不到要刪除的資料列' });
    }

    // 後台切換大屏樣式 / 字色 / 版面 / 字級
    if (action === 'setSettings') {
      const incoming = (body.settings && typeof body.settings === 'object') ? body.settings : {};
      PropertiesService.getScriptProperties().setProperty(SETTINGS_PROP_KEY, JSON.stringify(incoming));
      clearDonationsCache();
      return jsonResponse(getDonationsData(true));
    }

    // 後台手動調整順序：依傳入的 ID 順序重排資料列（保留每一列原本的登錄時間與備註）
    if (action === 'reorder') {
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      const lastRow = sheet.getLastRow();
      if (lastRow >= 2 && ids.length > 0) {
        const range = sheet.getRange(2, 1, lastRow - 1, 7);
        const values = range.getValues();
        const used = {};
        const ordered = [];
        ids.forEach(function (id) {
          for (let i = 0; i < values.length; i++) {
            if (!used[i] && String(values[i][0]) === id) {
              used[i] = true;
              ordered.push(values[i]);
              break;
            }
          }
        });
        // 沒出現在清單裡的列（例如另一台電腦剛新增的）接在最後，不會遺失
        for (let i = 0; i < values.length; i++) {
          if (!used[i]) ordered.push(values[i]);
        }
        range.setValues(ordered);
      }
      clearDonationsCache();
      return jsonResponse(getDonationsData(true));
    }

    if (action === 'replaceAll' || action === 'batchAdd') {
      const list = Array.isArray(body.items) ? body.items : [];
      if (action === 'replaceAll') {
        const lastRow = sheet.getLastRow();
        if (lastRow >= 2) {
          sheet.deleteRows(2, lastRow - 1);
        }
      }
      if (list.length > 0) {
        const rows = list.map(item => [
          item.id || Utilities.getUuid().slice(0, 8),
          String(item.donor || '').trim(),
          String(item.type || '禮金').trim(),
          String(item.rawContent || '').trim(),
          String(item.displayContent || item.rawContent || '').trim(),
          String(item.note || '').trim(),
          nowStr
        ]).filter(r => r[1]);
        if (rows.length > 0) {
          const startRow = sheet.getLastRow() + 1;
          sheet.getRange(startRow, 1, rows.length, 7).setValues(rows);
        }
      }
      clearDonationsCache();
      return jsonResponse(getDonationsData(true));
    }

    return jsonResponse({ status: 'error', message: '未知的操作類型: ' + action });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

/**
 * 統一回傳 JSON 格式
 */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
