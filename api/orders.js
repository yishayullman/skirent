// api/orders.js
// פונקציית Serverless ל-Vercel: מערכת הזמנות עם אימות תשלום ידני.
//
// ההזמנות נשמרות ב-Bin נפרד ב-JSONBin (לא ב-Bin של החסימות והביקורות),
// כדי שפרטי הלקוחות לא יהיו חשופים ב-GET הציבורי של /api/blocks.
//
// הגדרה ב-Vercel > Settings > Environment Variables:
//      JSONBIN_ORDERS_ID = מזהה של Bin חדש וריק שיוצרים ב-JSONBin (רשומה: {"orders": []})
//      JSONBIN_KEY       = אותו מפתח סודי קיים
//      JSONBIN_ORDERS_KEY = (לא חובה) מפתח X-Master-Key אחר, אם ה-Bin של ההזמנות בחשבון JSONBin אחר
//      ADMIN_PASSWORD    = אותה סיסמת מנהל קיימת
//
// פעולות:
//   POST { action: 'create_order', order: {...} }  - פתוח לכולם. השרת מחשב את הסכום לבד
//                                                    מתוך מחירון צד-שרת + תאריכים, ומחזיר מספר הזמנה.
//   GET                                            - דורש סיסמת מנהל. מחזיר את כל ההזמנות.
//   PUT  { action: 'set_status', orderId, status } - דורש סיסמת מנהל. status: pending/paid/cancelled

// מחירון צד-שרת. זהה למחירים ב-index.html. אם משנים מחירים באתר - לעדכן גם כאן.
const CAT_PRICES = { 'מעיל': 150, 'מכנס': 120, 'קסדה': 50, 'כפפות': 30, 'גוגלס': 40 };
const BUNDLE_PRICES = { duo: 200, full: 300 };

// מחיר ויחידת מוצר נגזרים מה-id של המוצר בצד שרת, לא מה-cat/מחיר שהלקוח שולח.
// קידומת ה-id היא הקטגוריה. חליפה שלמה (מעיל + מכנס) עולה 200 ש"ח לשבוע, כמו באתר.
// קטגוריה חדשה באתר דורשת שורה כאן, אחרת הזמנה עם מוצר ממנה נדחית (invalid_order).
const PRICE_BY_ID_PREFIX = { coat: { cat: 'מעיל', price: 150 }, 'מכנס': { cat: 'מכנס', price: 120 }, 'קסדה': { cat: 'קסדה', price: 50 }, 'כפפות': { cat: 'כפפות', price: 30 }, 'גוגלס': { cat: 'גוגלס', price: 40 }, 'חליפה': { cat: 'חליפה', price: 200 } };
function productInfo(id) {
  const prefix = String(id || '').split('-')[0];
  return Object.prototype.hasOwnProperty.call(PRICE_BY_ID_PREFIX, prefix) ? PRICE_BY_ID_PREFIX[prefix] : null;
}
// הרכב חבילה לפי סוג (כמו bundleTypes באתר): duo = מעיל + מכנס, full = מעיל, מכנס, קסדה, כפפות, גוגלס
const BUNDLE_CATS = { duo: ['מעיל', 'מכנס'], full: ['מעיל', 'מכנס', 'קסדה', 'כפפות', 'גוגלס'] };
function bundleComposed(typeId, items) {
  const want = BUNDLE_CATS[typeId];
  if (!want || items.length !== want.length) return false;
  return items.every((bi, i) => { const info = productInfo(bi.id); return info && info.cat === want[i]; });
}
// מלאי לפי מוצר+מידה (עותק של productStock ב-index.html; ברירת מחדל יחידה אחת).
// אם משנים מלאי באתר - לעדכן גם כאן (יש בדיקה שמשווה בין השניים).
const PRODUCT_STOCK = { 'קסדה-גברים-1': 4, 'קסדה-נשים-1': 4, 'קסדה-ילדים-1': 1, 'קסדה-מבוגרים-1': 4, 'קסדה-ילדים-2': 1 };

const BLOCKS_READ_TIMEOUT_MS = 4000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// חסימות מלאי מה-Bin של האתר (אותו Bin ש-api/blocks.js משתמש בו).
// מחזיר מערך, או null אם אי אפשר לאמת (חסר הגדרה, שגיאת רשת/JSONBin, או מבנה לא תקין).
async function readBlocks() {
  const id = process.env.JSONBIN_ID;
  const key = process.env.JSONBIN_KEY;
  if (!id || !key) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), BLOCKS_READ_TIMEOUT_MS); // לא תוקעים הזמנה אם JSONBin איטי
    try {
      const r = await fetch(`https://api.jsonbin.io/v3/b/${id}/latest`, { headers: { 'X-Master-Key': key }, signal: ctrl.signal });
      if (!r.ok) return null;
      const data = await r.json();
      const blocks = data && data.record && data.record.blocks;
      return Array.isArray(blocks) ? blocks : null;
    } finally { clearTimeout(timer); }
  } catch (e) { return null; }
}

// אותו כלל כמו isProductBlocked באתר: חסימה על אותו מוצר ומידה שחופפת לתאריכים (קצוות כלולים).
// חסימה פגומה (לא אובייקט, או בלי תאריכים תקינים) על אותו מוצר ומידה נחשבת כחוסמת, כדי לא לפספס מלאי תפוס.
function isBlocked(blocks, id, size, startDate, endDate) {
  return blocks.some(b => {
    if (!b || typeof b !== 'object') return false;
    if (b.productId !== id || b.size !== size) return false;
    if (typeof b.startDate !== 'string' || typeof b.endDate !== 'string' || !ISO_DATE.test(b.startDate) || !ISO_DATE.test(b.endDate)) return true;
    return startDate <= b.endDate && endDate >= b.startDate;
  });
}

// מחזיר רשימת פריטים לא זמינים עם סיבה: 'blocked' (חסימה בתאריכים) או 'quantity' (כמות מצטברת מעל המלאי)
function findUnavailable(blocks, itemSnapshots, bundleSnapshots, startDate, endDate) {
  const needed = new Map();
  const add = (id, size, qty) => { const k = id + '\u0000' + size; needed.set(k, { id, size, qty: ((needed.get(k) || {}).qty || 0) + qty }); };
  itemSnapshots.forEach(it => add(it.id, it.size, it.qty));
  bundleSnapshots.forEach(b => b.items.forEach(bi => add(bi.id, bi.size, 1)));
  const taken = [];
  for (const n of needed.values()) {
    if (isBlocked(blocks, n.id, n.size, startDate, endDate)) taken.push({ id: n.id, size: n.size, reason: 'blocked' });
    else if (n.qty > (PRODUCT_STOCK[n.id] || 1)) taken.push({ id: n.id, size: n.size, reason: 'quantity' });
  }
  return taken;
}

// בדיקת צורה בסיסית של פריט/חבילה, כדי שאי אפשר לעקוף את בדיקת הזמינות עם מזהה או מידה ריקים/מוזרים או חבילה ריקה.
// בכוונה לא בודקים מול קטלוג המוצרים: מוצר חדש באתר שלא נוסף לכאן היה נדחה בהזמנה. רק צורה.
const ID_RE = /^[A-Za-z0-9_\u0590-\u05FF-]{1,60}$/;
const SIZE_RE = /^[A-Za-z0-9]{1,6}$/;
const BUNDLE_SIZES = { duo: 2, full: 5 };
function validShape(itemSnapshots, bundleSnapshots) {
  for (const it of itemSnapshots) if (!ID_RE.test(it.id) || !SIZE_RE.test(it.size)) return false;
  for (const b of bundleSnapshots) {
    if (b.items.length !== BUNDLE_SIZES[b.typeId]) return false;
    for (const bi of b.items) if (!ID_RE.test(bi.id) || !SIZE_RE.test(bi.size)) return false;
  }
  return true;
}

const BUNDLE_LABELS = { duo: 'חבילת מעיל + מכנס', full: 'חבילת קומפלט (הכל)' };

// מקבל רק תאריך אמיתי בפורמט YYYY-MM-DD. מחזיר מספר (ms) או null.
function parseISODate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const t = Date.parse(str + 'T00:00:00Z');
  if (!Number.isFinite(t)) return null;
  if (new Date(t).toISOString().slice(0, 10) !== str) return null; // למשל 2026-02-31
  return t;
}

function calcWeeks(startMs, endMs) {
  const diffDays = Math.ceil((endMs - startMs) / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.ceil(diffDays / 7));
}

function makeOrderId(existing) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // בלי תווים מבלבלים (0/O, 1/I)
  for (let attempt = 0; attempt < 20; attempt++) {
    let id = 'SK-';
    for (let i = 0; i < 5; i++) id += chars[Math.floor(Math.random() * chars.length)];
    if (!existing.some(o => o.id === id)) return id;
  }
  return 'SK-' + Date.now().toString(36).toUpperCase();
}

async function readOrders(BIN_ID, API_KEY) {
  const r = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
    headers: { 'X-Master-Key': API_KEY },
  });
  if (!r.ok) throw new Error('קריאה מ-JSONBin נכשלה: ' + r.status);
  const data = await r.json();
  const record = data.record || {};
  return Array.isArray(record.orders) ? record.orders : [];
}

async function writeOrders(BIN_ID, API_KEY, orders) {
  const r = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Master-Key': API_KEY,
    },
    body: JSON.stringify({ orders }),
  });
  if (!r.ok) {
    const errorText = await r.text();
    const err = new Error('עדכון מול JSONBin נכשל');
    err.jsonbinStatus = r.status;
    err.jsonbinResponse = errorText;
    throw err;
  }
}

export default async function handler(req, res) {
  const BIN_ID = process.env.JSONBIN_ORDERS_ID;
  const API_KEY = process.env.JSONBIN_ORDERS_KEY || process.env.JSONBIN_KEY;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!BIN_ID || !API_KEY) return res.status(500).json({ error: 'השרת לא מוגדר (חסר JSONBIN_ORDERS_ID)' });

  // בלי ADMIN_PASSWORD לא מוגדרת (או ריקה) - אף אחד לא נחשב מנהל
  const isAdmin = () => {
    if (typeof ADMIN_PASSWORD !== 'string' || ADMIN_PASSWORD.length === 0) return false;
    const given = req.headers['x-admin-password'];
    if (typeof given !== 'string' || given.length === 0) return false;
    if (given.length !== ADMIN_PASSWORD.length) return false;
    let diff = 0;
    for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ ADMIN_PASSWORD.charCodeAt(i);
    return diff === 0;
  };

  try {
    if (req.method === 'GET') {
      // רשימת ההזמנות - פרטית, דורשת סיסמת מנהל
      if (!isAdmin()) return res.status(401).json({ error: 'סיסמת מנהל שגויה' });
      const orders = await readOrders(BIN_ID, API_KEY);
      return res.status(200).json({ orders: orders.slice().reverse() }); // החדשות ראשונות
    }

    if (req.method === 'POST') {
      const action = req.body && req.body.action;
      if (action !== 'create_order') return res.status(400).json({ error: 'פעולה לא מוכרת' });

      const input = (req.body && req.body.order) || {};
      const customerName = String(input.customerName || '').trim().slice(0, 60);
      const startDate = String(input.startDate || '');
      const endDate = String(input.endDate || '');
      const method = input.method === 'paybox' ? 'paybox' : 'bit';

      if (!customerName) return res.status(400).json({ error: 'חסר שם לקוח' });
      const startMs = parseISODate(startDate);
      const endMs = parseISODate(endDate);
      if (startMs === null || endMs === null || endMs < startMs) return res.status(400).json({ error: 'תאריכים לא תקינים' });

      const items = Array.isArray(input.items) ? input.items : [];
      const bundles = Array.isArray(input.bundles) ? input.bundles : [];
      if (items.length === 0 && bundles.length === 0) return res.status(400).json({ error: 'הסל ריק' });

      const weeks = calcWeeks(startMs, endMs);
      if (!Number.isFinite(weeks) || weeks < 1 || weeks > 52) return res.status(400).json({ error: 'תאריכים לא תקינים' });

      // חישוב סכום בצד שרת בלבד - המחיר שהלקוח שולח לא נתפס
      let total = 0;
      const itemSnapshots = [];
      for (const it of items.slice(0, 50)) {
        const info = productInfo(it.id);
        if (!info) return res.status(400).json({ error: 'invalid_order' });
        const cat = info.cat;
        const price = info.price;
        const qty = Math.max(1, Math.min(20, Math.round(Number(it.qty) || 1)));
        const lineTotal = price * weeks * qty;
        total += lineTotal;
        itemSnapshots.push({
          id: String(it.id || '').slice(0, 60),
          name: String(it.name || '').slice(0, 60),
          cat,
          size: String(it.size || '').slice(0, 10),
          qty,
          unitPrice: price,
          lineTotal,
        });
      }

      const bundleSnapshots = [];
      for (const b of bundles.slice(0, 20)) {
        const typeId = BUNDLE_PRICES[b.typeId] ? b.typeId : null;
        if (!typeId) return res.status(400).json({ error: 'חבילה לא מוכרת' });
        if (!bundleComposed(typeId, (Array.isArray(b.items) ? b.items : []))) return res.status(400).json({ error: 'invalid_order' });
        const lineTotal = BUNDLE_PRICES[typeId] * weeks;
        total += lineTotal;
        bundleSnapshots.push({
          typeId,
          label: BUNDLE_LABELS[typeId],
          gender: String(b.gender || '').slice(0, 10),
          items: (Array.isArray(b.items) ? b.items : []).slice(0, 10).map(bi => ({
            id: String(bi.id || '').slice(0, 60),
            name: String(bi.name || '').slice(0, 60),
            size: String(bi.size || '').slice(0, 10),
          })),
          lineTotal,
        });
      }

      // בדיקת זמינות בצד שרת. אם אי אפשר לאמת - לא מקבלים את ההזמנה והלקוח מתבקש לנסות שוב.
      if (!validShape(itemSnapshots, bundleSnapshots)) return res.status(400).json({ error: 'invalid_order' });
      const blocks = await readBlocks();
      if (!blocks) return res.status(503).json({ error: 'availability_unverified' });
      const taken = findUnavailable(blocks, itemSnapshots, bundleSnapshots, startDate, endDate);
      if (taken.length) return res.status(409).json({ error: 'unavailable', items: taken });

      const orders = await readOrders(BIN_ID, API_KEY);
      const order = {
        id: makeOrderId(orders),
        createdAt: new Date().toISOString(),
        customerName,
        startDate,
        endDate,
        weeks,
        method,
        items: itemSnapshots,
        bundles: bundleSnapshots,
        total,
        status: 'pending', // pending | paid | cancelled - "שולם" מסומן ידנית אחרי שהכסף מגיע
      };
      if (!Number.isFinite(total) || total <= 0) return res.status(400).json({ error: 'סכום לא תקין' });
      orders.push(order);
      await writeOrders(BIN_ID, API_KEY, orders);

      return res.status(200).json({ ok: true, orderId: order.id, total, weeks });
    }

    if (req.method === 'PUT') {
      const action = req.body && req.body.action;
      if (action !== 'set_status') return res.status(400).json({ error: 'פעולה לא מוכרת' });
      if (!isAdmin()) return res.status(401).json({ error: 'סיסמת מנהל שגויה' });

      const { orderId, status } = req.body;
      if (!['pending', 'paid', 'cancelled'].includes(status)) {
        return res.status(400).json({ error: 'סטטוס לא חוקי' });
      }
      const orders = await readOrders(BIN_ID, API_KEY);
      const idx = orders.findIndex(o => o.id === orderId);
      if (idx === -1) return res.status(404).json({ error: 'הזמנה לא נמצאה' });
      orders[idx].status = status;
      orders[idx].statusUpdatedAt = new Date().toISOString();
      await writeOrders(BIN_ID, API_KEY, orders);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      // מחיקת הזמנה לצמיתות - דורש סיסמת מנהל בצד שרת
      if (!isAdmin()) return res.status(401).json({ error: 'סיסמת מנהל שגויה' });
      const orderId = String((req.body && req.body.orderId) || (req.query && req.query.orderId) || '');
      if (!orderId) return res.status(400).json({ error: 'חסר מספר הזמנה' });
      const orders = await readOrders(BIN_ID, API_KEY);
      const idx = orders.findIndex(o => o.id === orderId);
      if (idx === -1) return res.status(404).json({ error: 'הזמנה לא נמצאה' });
      orders.splice(idx, 1);
      await writeOrders(BIN_ID, API_KEY, orders);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'שיטה לא נתמכת' });
  } catch (e) {
    if (e.jsonbinStatus) {
      return res.status(502).json({ error: e.message, jsonbin_status: e.jsonbinStatus });
    }
    return res.status(500).json({ error: 'שגיאת שרת', details: String(e) });
  }
    }
