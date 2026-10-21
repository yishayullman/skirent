# חד-פעמי: מגן כתיבות בסביבת Preview + באנר תצוגה מקדימה. מוחק את עצמו אחרי הרצה.

# ---------- 1. api/orders.js ----------
o = open('api/orders.js', encoding='utf-8').read()
anchor = "  if (req.method === 'OPTIONS') return res.status(200).end();\n"
assert o.count(anchor) == 1, 'orders anchor count != 1'
guard = anchor + """
  // סביבת Preview ב-Vercel (VERCEL_ENV === 'preview'): חוסם כל כתיבה כדי שהתצוגה
  // המקדימה לא תיגע בנתוני הייצור (הזמנות אמיתיות של לקוחות).
  // בסביבת production אין שום שינוי בהתנהגות.
  if (process.env.VERCEL_ENV === 'preview' && req.method !== 'GET') {
    return res.status(403).json({ error: 'סביבת תצוגה מקדימה לביקורת בלבד - יצירת הזמנות ושינוי סטטוסים מושבתים. להזמנה באתר החי: https://ski.surfrent-il.com' });
  }
"""
open('api/orders.js', 'w', encoding='utf-8').write(o.replace(anchor, guard))

# ---------- 2. api/blocks.js ----------
b = open('api/blocks.js', encoding='utf-8').read()
anchor_b = "  if (req.method === 'OPTIONS') return res.status(200).end();\n"
assert b.count(anchor_b) == 1, 'blocks anchor count != 1'
guard_b = anchor_b + """
  // סביבת Preview ב-Vercel: חוסם כתיבות (ביקורות/חסימות) כדי לא לגעת בנתוני הייצור.
  if (process.env.VERCEL_ENV === 'preview' && req.method !== 'GET') {
    return res.status(403).json({ error: 'סביבת תצוגה מקדימה לביקורת בלבד - הוספת ביקורות ושמירת שינויים מושבתים. האתר החי: https://ski.surfrent-il.com' });
  }
"""
open('api/blocks.js', 'w', encoding='utf-8').write(b.replace(anchor_b, guard_b))

# ---------- 3. index.html - באנר תצוגה מקדימה ----------
h = open('index.html', encoding='utf-8').read()
assert h.count('</body>') == 1, 'body anchor count != 1'
banner = """<style>
#preview-banner { position: fixed; bottom: 0; left: 0; right: 0; z-index: 99999; background: #b45309; color: #fff; text-align: center; padding: 8px 44px; font-size: 14px; line-height: 1.5; }
#preview-banner a { color: #fff; text-decoration: underline; }
#preview-banner button { position: absolute; inset-inline-end: 10px; top: 50%; transform: translateY(-50%); background: none; border: 1px solid #fff; color: #fff; border-radius: 6px; cursor: pointer; padding: 2px 9px; font-size: 13px; }
</style>
<script>
// באנר סביבת תצוגה מקדימה: מוצג רק במארחי vercel.app (דיפלוימנטים של preview), לעולם לא בדומיין החי.
if (location.hostname.endsWith('.vercel.app')) {
  document.addEventListener('DOMContentLoaded', function () {
    var pb = document.createElement('div');
    pb.id = 'preview-banner';
    pb.setAttribute('role', 'status');
    pb.innerHTML = 'סביבת תצוגה מקדימה לביקורת — הזמנות וביקורות חדשות מושבתות כאן. האתר החי: <a href="https://ski.surfrent-il.com">ski.surfrent-il.com</a><button type="button" aria-label="סגור" onclick="document.getElementById(\\'preview-banner\\').remove()">✕</button>';
    document.body.appendChild(pb);
  });
}
</script>
</body>"""
open('index.html', 'w', encoding='utf-8').write(h.replace('</body>', banner))
print('preview guard applied')
