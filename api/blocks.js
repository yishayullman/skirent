
// api/blocks.js
// פונקציית Serverless ל-Vercel. מסתירה את מפתח ה-API של JSONBin מהדפדפן,
// ומנהלת גם את חסימות המלאי וגם את הביקורות של האתר, תחת אותו קובץ ענן אחד.
//
// מבנה הנתונים שנשמר ב-JSONBin: { blocks: [...], reviews: [...] }
//
// הגדרה ב-Vercel > Settings > Environment Variables:
//      JSONBIN_ID     = מזהה ה-Bin שלך
//      JSONBIN_KEY    = המפתח הסודי שלך מ-JSONBin
//      ADMIN_PASSWORD = הסיסמה לפאנל הניהול
//
// פעולות נתמכות (PUT):
//   { action: 'save_blocks', blocks: [...] }                     - דורש סיסמת מנהל
//   { action: 'add_review', review: {...} }                      - פתוח לכולם (הוספת ביקורת)
//   { action: 'set_review_status', reviewId, deleted: true/false } - דורש סיסמת מנהל (מחיקה/שחזור)
 
async function readRecord(BIN_ID, API_KEY) {
  const r = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
    headers: { 'X-Master-Key': API_KEY },
  });
  if (!r.ok) throw new Error('קריאה מ-JSONBin נכשלה: ' + r.status);
  const data = await r.json();
  const record = data.record || {};
  return {
    blocks: Array.isArray(record.blocks) ? record.blocks : [],
    reviews: Array.isArray(record.reviews) ? record.reviews : [],
  };
}
 
async function writeRecord(BIN_ID, API_KEY, record) {
  const r = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Master-Key': API_KEY,
    },
    body: JSON.stringify(record),
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
  const BIN_ID = process.env.JSONBIN_ID;
  const API_KEY = process.env.JSONBIN_KEY;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
 
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
  if (req.method === 'OPTIONS') return res.status(200).end();
 
  const isAdmin = () => req.headers['x-admin-password'] === ADMIN_PASSWORD;
 
  try {
    if (req.method === 'GET') {
      // קריאת כל הנתונים (חסימות + ביקורות) - פתוח לכולם, אין בזה סוד
      const record = await readRecord(BIN_ID, API_KEY);
      return res.status(200).json(record);
    }
 
    if (req.method === 'POST') {
      // בדיקת סיסמה בלבד - לא נוגע בנתונים, רק מאשר/דוחה כניסה לפאנל הניהול
      if (!isAdmin()) return res.status(401).json({ error: 'סיסמת מנהל שגויה' });
      return res.status(200).json({ ok: true });
    }
 
    if (req.method === 'PUT') {
      const action = req.body && req.body.action;
 
      if (action === 'add_review') {
        // הוספת ביקורת - פתוח לכולם, לא דורש סיסמה
        const review = req.body.review;
        if (!review || !review.name || !review.stars) {
          return res.status(400).json({ error: 'חסרים פרטי ביקורת (שם ודירוג חובה)' });
        }
        const stars = Math.max(1, Math.min(5, Math.round(Number(review.stars))));
        const current = await readRecord(BIN_ID, API_KEY);
        const newReview = {
          id: Date.now(),
          name: String(review.name).slice(0, 60),
          stars,
          text: String(review.text || '').slice(0, 500),
          date: new Date().toISOString(),
          deleted: false,
        };
        current.reviews.push(newReview);
        await writeRecord(BIN_ID, API_KEY, current);
        return res.status(200).json({ ok: true, review: newReview });
      }
 
      if (action === 'set_review_status') {
        // מחיקה/שחזור של ביקורת - דורש סיסמת מנהל
        if (!isAdmin()) return res.status(401).json({ error: 'סיסמת מנהל שגויה' });
        const { reviewId, deleted } = req.body;
        const current = await readRecord(BIN_ID, API_KEY);
        const idx = current.reviews.findIndex(r => r.id === reviewId);
        if (idx === -1) return res.status(404).json({ error: 'ביקורת לא נמצאה' });
        current.reviews[idx].deleted = !!deleted;
        await writeRecord(BIN_ID, API_KEY, current);
        return res.status(200).json({ ok: true });
      }
 
      if (action === 'save_blocks') {
        // חסימת/שחרור מוצר - דורש סיסמת מנהל
        if (!isAdmin()) return res.status(401).json({ error: 'סיסמת מנהל שגויה' });
        const current = await readRecord(BIN_ID, API_KEY);
        current.blocks = Array.isArray(req.body.blocks) ? req.body.blocks : [];
        await writeRecord(BIN_ID, API_KEY, current);
        return res.status(200).json({ ok: true });
      }
 
      return res.status(400).json({ error: 'פעולה לא מוכרת' });
    }
 
    return res.status(405).json({ error: 'שיטה לא נתמכת' });
  } catch (e) {
    if (e.jsonbinStatus) {
      return res.status(502).json({ error: e.message, jsonbin_status: e.jsonbinStatus, jsonbin_response: e.jsonbinResponse });
    }
    return res.status(500).json({ error: 'שגיאת שרת', details: String(e) });
  }
}
 
