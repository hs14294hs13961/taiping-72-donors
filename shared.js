/**
 * 新竹縣關西鎮太平國民小學 72週年校慶捐款芳名錄 - 共用核心模組 (shared.js)
 * 提供：
 * 1. 阿拉伯數字自動轉傳統禮金大寫（如 10000 -> 禮金壹萬元整，完全還原手寫紅榜格式）
 * 2. GAS API 連線與本機快取 / 跨視窗即時同步 (BroadcastChannel + LocalStorage)
 * 3. 71週年完整 94 筆真實芳名錄測試資料（供大屏版面壓力測試與預覽）
 */

const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbwWCILrHwW7qYhm8MuHEoVnBHrX7ckghNATX503D7why7Lt-FrXWnQ7XIPPCt8oVdB2/exec';

const TP72_STORAGE_KEYS = {
  GAS_URL: 'tp72_gas_url',
  LOCAL_ITEMS: 'tp72_local_donations_v1',
  SETTINGS: 'tp72_display_settings_v1',
  DATA_MODE: 'tp72_data_mode_v1' // 'gas' | 'local' | 'demo71'
};

/**
 * 將純數字金額轉為傳統紅紙芳名錄格式（例如：10000 -> 禮金壹萬元整、160000 -> 禮金壹拾陸萬元整）
 * 若輸入為物資文字（如「仙草茶二桶」），則原樣保留。
 */
function formatDonationDisplay(rawInput, typeHint) {
  const str = String(rawInput || '').trim();
  if (!str) return '';

  // 移除逗號、空白、「元」、「禮金」、「$」等常見贅字以判斷是否為純數字金額
  const cleanedNumStr = str.replace(/[,，\s$＄元整禮金新台幣NT]/gi, '');
  if (/^\d+$/.test(cleanedNumStr) && typeHint !== '物資') {
    const num = parseInt(cleanedNumStr, 10);
    if (num > 0 && num < 1000000000) {
      return '禮金' + numberToTraditionalChinese(num) + '元整';
    }
  }
  return str;
}

/**
 * 正統繁體中文大寫金額轉換（壹、貳、參、肆、伍、陸、柒、捌、玖、拾、佰、仟、萬）
 * 符合台灣禮金紅榜習慣（例如 10000 -> 壹萬、160000 -> 壹拾陸萬、2200 -> 貳仟貳佰）
 */
function numberToTraditionalChinese(num) {
  if (num === 0) return '零';
  const digits = ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖'];
  const units = ['', '拾', '佰', '仟'];
  const bigUnits = ['', '萬', '億'];

  let numStr = String(num);
  let result = '';
  let zeroFlag = false;

  // 以 4 位數為一組切分
  const groups = [];
  while (numStr.length > 0) {
    groups.unshift(numStr.slice(Math.max(0, numStr.length - 4)));
    numStr = numStr.slice(0, Math.max(0, numStr.length - 4));
  }

  for (let g = 0; g < groups.length; g++) {
    const groupStr = groups[g];
    const bigUnitIdx = groups.length - 1 - g;
    let groupRes = '';
    const len = groupStr.length;

    for (let i = 0; i < len; i++) {
      const d = parseInt(groupStr[i], 10);
      const unitIdx = len - 1 - i;
      if (d === 0) {
        zeroFlag = true;
      } else {
        if (zeroFlag && (result.length > 0 || groupRes.length > 0)) {
          groupRes += '零';
        }
        groupRes += digits[d] + units[unitIdx];
        zeroFlag = false;
      }
    }

    if (groupRes.length > 0) {
      result += groupRes + bigUnits[bigUnitIdx];
      zeroFlag = false;
    } else {
      zeroFlag = true;
    }
  }

  return result;
}

/**
 * 直書用標點：把括號、引號、破折號換成直式字形（︵︶﹁﹂︱…），
 * 讓「關西鎮公所(感謝…)」在紅條上由上而下正確排列。只影響顯示，不改動儲存的資料，字數也不變。
 */
const TP72_VERTICAL_PUNCT = {
  '(': '︵', '（': '︵', ')': '︶', '）': '︶',
  '「': '﹁', '」': '﹂', '『': '﹃', '』': '﹄',
  '《': '︽', '》': '︾', '〈': '︿', '〉': '﹀',
  '【': '︻', '】': '︼', '〔': '︹', '〕': '︺',
  '—': '︱', '－': '︱', '-': '︱', '–': '︱'
};

function toVerticalPunctuation(text) {
  return Array.from(String(text || '')).map((ch) => TP72_VERTICAL_PUNCT[ch] || ch).join('');
}

/**
 * 判斷輸入內容是「禮金」還是「物資」
 */
function detectDonationType(rawInput) {
  const str = String(rawInput || '').trim();
  const cleanedNumStr = str.replace(/[,，\s$＄元整禮金新台幣NT]/gi, '');
  if (/^\d+$/.test(cleanedNumStr)) {
    return '禮金';
  }
  if (str.startsWith('禮金')) {
    return '禮金';
  }
  return '物資';
}

/**
 * 預設顯示設定
 */
function getDisplaySettings() {
  const defaults = {
    cardStyle: 'vertical-red',   // 'vertical-red' (傳統紅條直書) | 'horizontal-card' (喜慶橫式金框卡)
    sortOrder: 'input-asc',      // 'input-asc' (依登錄順序) | 'input-desc' (最新在前)
    showOrderBadge: false,       // 是否顯示編號
    fontScaleAdjust: 1.0,        // 字體微調倍率 (0.8 ~ 1.35)
    headerMode: 'compact',       // 'compact' (保留邀請卡頂部與底部主視覺) | 'full' (最大化芳名錄版面)
    pollIntervalSec: 5           // 輪詢秒數 (預設 5 秒)
  };
  try {
    const saved = localStorage.getItem(TP72_STORAGE_KEYS.SETTINGS);
    if (saved) {
      return Object.assign({}, defaults, JSON.parse(saved));
    }
  } catch (e) {}
  return defaults;
}

function saveDisplaySettings(newSettings) {
  const merged = Object.assign(getDisplaySettings(), newSettings);
  try {
    localStorage.setItem(TP72_STORAGE_KEYS.SETTINGS, JSON.stringify(merged));
    notifyCrossTab('settings_updated', merged);
  } catch (e) {}
  return merged;
}

/**
 * 跨分頁即時廣播（當同一台電腦同時開後台與大屏時，0秒即時反應）
 */
let tp72Channel = null;
try {
  if (typeof BroadcastChannel !== 'undefined') {
    tp72Channel = new BroadcastChannel('taiping72_donations_channel');
  }
} catch (e) {}

function notifyCrossTab(type, payload) {
  try {
    if (tp72Channel) {
      tp72Channel.postMessage({ type, payload, timestamp: Date.now() });
    }
  } catch (e) {}
}

/**
 * 71週年真實捐款芳名錄資料（共 94 筆，含手寫紅榜照片前 21 筆與 Excel 全名單）
 */
const DEMO_71_DONATIONS = [
  { id: 'd01', donor: '建達國際股份有限公司', type: '物資', rawContent: 'AVER DL30 教學用自動追蹤攝影機 2組', displayContent: 'AVER DL30 教學用自動追蹤攝影機 2組' },
  { id: 'd02', donor: '思薇爾凱督國際股份有限公司', type: '禮金', rawContent: '3000', displayContent: '禮金參仟元整' },
  { id: 'd03', donor: '潘俊英先生', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd04', donor: '張素貞女士', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd05', donor: '啟碁科技股份有限公司', type: '禮金', rawContent: '160000', displayContent: '禮金壹拾陸萬元整' },
  { id: 'd06', donor: '智易科技股份有限公司', type: '物資', rawContent: '學生英語線上課程', displayContent: '學生英語線上課程' },
  { id: 'd07', donor: '東平里12鄰朱運崇鄰長', type: '禮金', rawContent: '2000', displayContent: '禮金貳仟元整' },
  { id: 'd08', donor: '重光醫院彭聖倉主任', type: '禮金', rawContent: '10000', displayContent: '禮金壹萬元整' },
  { id: 'd09', donor: '關西鎮農會', type: '物資', rawContent: '仙草茶二桶', displayContent: '仙草茶二桶' },
  { id: 'd10', donor: '吳宜軒主任', type: '禮金', rawContent: '10000', displayContent: '禮金壹萬元整' },
  { id: 'd11', donor: '朱茂男董事長', type: '禮金', rawContent: '10000', displayContent: '禮金壹萬元整' },
  { id: 'd12', donor: '新竹縣各級家長協會關西新埔區劉華泉執行長', type: '禮金', rawContent: '2000', displayContent: '禮金貳仟元整' },
  { id: 'd13', donor: '江錦晟董事長', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd14', donor: '黃春嫺校長', type: '禮金', rawContent: '10000', displayContent: '禮金壹萬元整' },
  { id: 'd15', donor: '校友 謝維相先生', type: '禮金', rawContent: '500', displayContent: '禮金伍佰元整' },
  { id: 'd16', donor: '校友 劉華明先生', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd17', donor: '東平社區發展協會李昌海理事長', type: '禮金', rawContent: '2000', displayContent: '禮金貳仟元整' },
  { id: 'd18', donor: '東平社區發展協會監事張双亮', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd19', donor: '東平社區關懷據點', type: '禮金', rawContent: '5000', displayContent: '禮金伍仟元整' },
  { id: 'd20', donor: '彭正中老師', type: '禮金', rawContent: '2000', displayContent: '禮金貳仟元整' },
  { id: 'd21', donor: '關西鎮東平里鄧光明里長', type: '物資', rawContent: '十箱運動飲料、十箱水', displayContent: '十箱運動飲料、十箱水' },
  { id: 'd22', donor: '關西鎮民代表李常棟代表', type: '物資', rawContent: '二箱運動飲料', displayContent: '二箱運動飲料' },
  { id: 'd23', donor: '關西鎮東平里產業發展協會黃淼霖理事長', type: '物資', rawContent: '修樹清運(價值貳萬元整)陸上龍舟六隻', displayContent: '修樹清運(價值貳萬元整)陸上龍舟六隻' },
  { id: 'd24', donor: '劉正榮先生', type: '物資', rawContent: '臺北草皮十五坪', displayContent: '臺北草皮十五坪' },
  { id: 'd25', donor: '本校不具名家長', type: '禮金', rawContent: '5000', displayContent: '禮金伍仟元整' },
  { id: 'd26', donor: '本校不具名家長', type: '禮金', rawContent: '5000', displayContent: '禮金伍仟元整' },
  { id: 'd27', donor: '東平家政班班長謝秀杏', type: '物資', rawContent: '麻糬二十斤', displayContent: '麻糬二十斤' },
  { id: 'd28', donor: '東平社區發展協會理事蔡潤鑫', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd29', donor: '詹碧珠女士', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd30', donor: '陳菊枝女士', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd31', donor: '校友 朱金富鄰長', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd32', donor: '校友 劉宴君鄰長', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd33', donor: '校友 王興松先生', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd34', donor: '校友 詹金淇先生', type: '禮金', rawContent: '2000', displayContent: '禮金貳仟元整' },
  { id: 'd35', donor: '前家長會長詹勳光先生', type: '禮金', rawContent: '3000', displayContent: '禮金參仟元整' },
  { id: 'd36', donor: '東平社區發展協會理事黎吳富梅', type: '禮金', rawContent: '2000', displayContent: '禮金貳仟元整' },
  { id: 'd37', donor: '林忠和先生', type: '禮金', rawContent: '2000', displayContent: '禮金貳仟元整' },
  { id: 'd38', donor: '元馨柿餅', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd39', donor: '校友 黎逸騫', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd40', donor: '楊桂枝小姐', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd41', donor: '東平里里長 鄧光明先生', type: '禮金', rawContent: '3000', displayContent: '禮金參仟元整' },
  { id: 'd42', donor: '校友 鄧南星先生', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd43', donor: '校友 黎瑞華女士', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd44', donor: '校友 莊凱涵小姐', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd45', donor: '家長會長莊紹瑋先生', type: '禮金', rawContent: '6000', displayContent: '禮金陸仟元整' },
  { id: 'd46', donor: '耕進機械有限公司', type: '禮金', rawContent: '10000', displayContent: '禮金壹萬元整' },
  { id: 'd47', donor: '校友 劉邦振先生', type: '禮金', rawContent: '3000', displayContent: '禮金參仟元整' },
  { id: 'd48', donor: '前家長會長 彭秀連先生', type: '禮金', rawContent: '2200', displayContent: '禮金貳仟貳佰元整' },
  { id: 'd49', donor: '校友 劉宥妤小姐', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd50', donor: '校友 劉厚理先生', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd51', donor: '校友 李綱田先生', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd52', donor: '前會長劉華凱先生', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd53', donor: '校友 劉正勇先生', type: '禮金', rawContent: '2000', displayContent: '禮金貳仟元整' },
  { id: 'd54', donor: '校友 陳光棋先生', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd55', donor: '校友 張安晴小姐', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd56', donor: '東平社區發展協會理事詹國棟', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd57', donor: '呂寶珠女士', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd58', donor: '鄧添銘先生', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd59', donor: '東平社區發展協會監事劉邦河先生', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd60', donor: '雲海休閒茶廠莊美雲女士', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd61', donor: '東平社區發展協會理事謝蔡淋先生', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd62', donor: '前家長會長 涂鏡棠先生', type: '禮金', rawContent: '2000', displayContent: '禮金貳仟元整' },
  { id: 'd63', donor: '校友 黎采蓉小姐', type: '禮金', rawContent: '2000', displayContent: '禮金貳仟元整' },
  { id: 'd64', donor: '校友 彭秀瀧先生', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd65', donor: '東平社區發展協會監事劉仁和', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd66', donor: '呂煥琳先生', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd67', donor: '許應光(8鄰鄰長)', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd68', donor: '康禾居家徐百苓女士', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd69', donor: '校友 魏德明先生', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd70', donor: '校友 戴國全先生', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd71', donor: '關西鎮代表會李常棟代表', type: '禮金', rawContent: '3000', displayContent: '禮金參仟元整' },
  { id: 'd72', donor: '東平社區發展協會', type: '禮金', rawContent: '5000', displayContent: '禮金伍仟元整' },
  { id: 'd73', donor: '新竹縣各級學校家長協會理事張國明', type: '禮金', rawContent: '10000', displayContent: '禮金壹萬元整' },
  { id: 'd74', donor: '校友 巫細貞老師', type: '禮金', rawContent: '2000', displayContent: '禮金貳仟元整' },
  { id: 'd75', donor: '家長會吳帥輝委員', type: '禮金', rawContent: '3000', displayContent: '禮金參仟元整' },
  { id: 'd76', donor: '羅耘書小朋友', type: '禮金', rawContent: '2000', displayContent: '禮金貳仟元整' },
  { id: 'd77', donor: '魚木景觀劉正榮先生', type: '禮金', rawContent: '2000', displayContent: '禮金貳仟元整' },
  { id: 'd78', donor: '校友 許時洲先生', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd79', donor: '校友 許時通先生', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd80', donor: '罕見疾病基金會', type: '物資', rawContent: '文具公仔1箱', displayContent: '文具公仔1箱' },
  { id: 'd81', donor: '校友 劉桓淇先生', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd82', donor: '鄰長 劉源雄先生', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd83', donor: '不具名校友', type: '禮金', rawContent: '2000', displayContent: '禮金貳仟元整' },
  { id: 'd84', donor: '校友 黎茂煌先生', type: '禮金', rawContent: '3000', displayContent: '禮金參仟元整' },
  { id: 'd85', donor: '校友 李國鼎先生', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd86', donor: '校友 劉宇銘先生', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd87', donor: '校友 蔡碧子女士', type: '禮金', rawContent: '2000', displayContent: '禮金貳仟元整' },
  { id: 'd88', donor: '護理師張玉慈女士', type: '禮金', rawContent: '2000', displayContent: '禮金貳仟元整' },
  { id: 'd89', donor: '李國明先生', type: '禮金', rawContent: '6000', displayContent: '禮金陸仟元整' },
  { id: 'd90', donor: '羅梅華老師', type: '禮金', rawContent: '2000', displayContent: '禮金貳仟元整' },
  { id: 'd91', donor: '頂尖教育中心范綱田董事長', type: '禮金', rawContent: '3000', displayContent: '禮金參仟元整' },
  { id: 'd92', donor: '東平產業協會', type: '禮金', rawContent: '5000', displayContent: '禮金伍仟元整' },
  { id: 'd93', donor: '黃寶玉女士', type: '禮金', rawContent: '1000', displayContent: '禮金壹仟元整' },
  { id: 'd94', donor: '益邦機電顧問股份有限公司', type: '禮金', rawContent: '12000', displayContent: '禮金壹萬貳仟元整' }
];

/**
 * 取得或設定 GAS 網址（預設已內建學校專屬 GAS 網址，亦支援從網址列參數 ?gas=https://... 覆蓋）
 */
function getGasUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  const paramGas = urlParams.get('gas');
  if (paramGas && paramGas.startsWith('https://script.google.com/')) {
    localStorage.setItem(TP72_STORAGE_KEYS.GAS_URL, paramGas.trim());
    return paramGas.trim();
  }
  const saved = (localStorage.getItem(TP72_STORAGE_KEYS.GAS_URL) || '').trim();
  return saved || DEFAULT_GAS_URL;
}

function setGasUrl(url) {
  const trimmed = String(url || '').trim();
  localStorage.setItem(TP72_STORAGE_KEYS.GAS_URL, trimmed);
  notifyCrossTab('gas_url_updated', trimmed);
}

/**
 * 取得本機儲存的捐款清單（尚未設定 GAS 時，或作為備援）
 */
function getLocalDonations() {
  try {
    const raw = localStorage.getItem(TP72_STORAGE_KEYS.LOCAL_ITEMS);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {}
  // 若本機完全無資料，預設載入前 21 筆（照片中紅榜上的 21 張紅紙）作為初始展示
  const initial = DEMO_71_DONATIONS.slice(0, 21);
  saveLocalDonations(initial);
  return initial;
}

function saveLocalDonations(items) {
  try {
    localStorage.setItem(TP72_STORAGE_KEYS.LOCAL_ITEMS, JSON.stringify(items));
    notifyCrossTab('donations_updated', items);
  } catch (e) {}
}
