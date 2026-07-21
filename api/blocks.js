
// api/blocks.js
// פונקציית Serverless להעלאה ל-Vercel (או Netlify עם שינוי קל בפורמט).
// מטרתה: להסתיר את מפתח ה-API של JSONBin מהקוד שרץ בדפדפן.
//
// איך זה עובד:
// - הדפדפן קורא ל- /api/blocks  (אצלך, לא ל-jsonbin ישירות)
// - הפונקציה הזו, שרצה בענן שלך, היא היחידה שמכירה את המפתח האמיתי
// - היא שולחת בקשה בשמך ל-JSONBin ומחזירה את התוצאה
//
// הגדרה ב-Vercel:
// 1. צור פרויקט חדש ב-vercel.com (חינמי), חבר לריפו של האתר.
// 2. שים את הקובץ הזה בנתיב: /api/blocks.js
// 3. ב-Vercel > Settings > Environment Variables הוסף:
//      JSONBIN_ID    = 6a4a2528f5f4af5e2961d974
//      JSONBIN_KEY   = $2a$10$A3aPXMRSPKEJKtNLgjR4o.YJWA06TL6jnPttQD5EtSTR9ak6RnSSK
//      ADMIN_PASSWORD = הסיסמה שתרצה (החלף את זו שהייתה חשופה בקוד)
// 4. פרוס (Deploy). הכתובת שלך תהיה: https://<your-project>.vercel.app/api/blocks
// 5. בקוד האתר (index.html), במקום לקרוא ישירות ל-jsonbin, קרא לכתובת הזו.
 
export default async function handler(req, res) {
  const BIN_ID = process.env.JSONBIN_ID;
  const API_KEY = process.env.JSONBIN_KEY;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
 
  // אפשר CORS בסיסי אם האתר מתארח בדומיין נפרד
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
  if (req.method === 'OPTIONS') return res.status(200).end();
 
  try {
    if (req.method === 'GET') {
      // קריאת רשימת החסימות - פתוח לכולם, אין בזה סוד
      const r = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
        headers: { 'X-Master-Key': API_KEY },
      });
      const data = await r.json();
      return res.status(200).json(data.record || { blocks: [] });
    }
 
    if (req.method === 'PUT') {
      // כתיבה (חסימה/שחרור) - דורש סיסמת מנהל תקינה שנשלחת מהקליינט
      const providedPassword = req.headers['x-admin-password'];
      if (providedPassword !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'סיסמת מנהל שגויה' });
      }
 
      const r = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': API_KEY,
        },
        body: JSON.stringify(req.body),
      });
 
      if (!r.ok) {
        const errorText = await r.text();
        return res.status(502).json({ error: 'עדכון מול JSONBin נכשל', jsonbin_status: r.status, jsonbin_response: errorText });
      }
      return res.status(200).json({ ok: true });
    }
 
    return res.status(405).json({ error: 'שיטה לא נתמכת' });
  } catch (e) {
    return res.status(500).json({ error: 'שגיאת שרת', details: String(e) });
  }
}
 
