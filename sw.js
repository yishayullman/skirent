// Service Worker בסיסי - נדרש כדי שדפדפני כרום (בעיקר באנדרואיד) יאפשרו
// כפתור "התקן אפליקציה" / "הוסף למסך הבית" אוטומטי.
// זהו קובץ מינימלי שרק "מאזין" לבקשות רשת בלי לשנות התנהגות בפועל.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // מעביר את הבקשה כרגיל לרשת, בלי caching מיוחד.
  event.respondWith(fetch(event.request));
});
