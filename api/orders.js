// api/orders.js
// פונקציית Serverless ל-Vercel: מערכת הזמנות עם אימות תשלום ידני.
//
// ההזמנות נשמרות ב-Bin נפרד ב-JSONBin (לא ב-Bin של החסימות והביקורות),
// כדי שפרטי הלקוחות לא יהיו חשופים ב-GET הציבורי של /api/blocks.
//
// הגדרה ב-Vercel > Settings > Environment Variables:
//      JSONBIN_ORDERS_ID = מזהה של Bin חדש וריק שיוצרים ב-JSONBin (רשומה: {"orders": []})
//      JSONBIN_KEY       = אותו מפתח סודי קיים
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
const BUNDLE_LABELS = { duo: 'חבילת מעיל + מכנס', full: 'חבילת קומפלט (הכל)' };

function calcWeeks(startDate, endDate) {
  const diffDays = Math.ceil(Math.abs(new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24));
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
  const API_KEY = process.env.JSONBIN_KEY;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!BIN_ID || !API_KEY) return res.status(500).json({ error: 'השרת לא מוגדר (חסר JSONBIN_ORDERS_ID)' });

  const isAdmin = () => req.headers['x-admin-password'] === ADMIN_PASSWORD;

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
      if (!startDate || !endDate || endDate < startDate) return res.status(400).json({ error: 'תאריכים לא תקינים' });

      const items = Array.isArray(input.items) ? input.items : [];
      const bundles = Array.isArray(input.bundles) ? input.bundles : [];
      if (items.length === 0 && bundles.length === 0) return res.status(400).json({ error: 'הסל ריק' });

      const weeks = calcWeeks(startDate, endDate);

      // חישוב סכום בצד שרת בלבד - המחיר שהלקוח שולח לא נתפס
      let total = 0;
      const itemSnapshots = [];
      for (const it of items.slice(0, 50)) {
        const cat = String(it.cat || '');
        const price = CAT_PRICES[cat];
        if (!price) return res.status(400).json({ error: 'פריט לא מוכר: ' + cat });
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

    return res.status(405).json({ error: 'שיטה לא נתמכת' });
  } catch (e) {
    if (e.jsonbinStatus) {
      return res.status(502).json({ error: e.message, jsonbin_status: e.jsonbinStatus, jsonbin_response: e.jsonbinResponse });
    }
    return res.status(500).json({ error: 'שגיאת שרת', details: String(e) });
  }
    }
