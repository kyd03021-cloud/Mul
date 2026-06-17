const DB_NAME = 'muldoi_alarm_db';
const STORE_NAME = 'schedules';
const CHECK_INTERVAL_MS = 15000;
let lastCheckedMinute = '';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveSchedules(schedules) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(schedules || [], 'all');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadSchedules() {
  const db = await openDB();
  const data = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get('all');
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return Array.isArray(data) ? data : [];
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SYNC_SCHEDULES') {
    event.waitUntil(saveSchedules(event.data.schedules));
  }
});

function pad(n) { return String(n).padStart(2, '0'); }
function formatDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function getSchedulesForDate(schedules, dateStr) {
  const [tYear, tMonth, tDay] = dateStr.split('-').map(Number);
  return schedules.filter(s => {
    if (!s || !s.date || typeof s.date !== 'string') return false;
    if (s.exceptions && s.exceptions.includes(dateStr)) return false;
    if (s.date === dateStr) return true;
    if (s.repeat === 'none' || !s.repeat) return false;
    if (s.date > dateStr) return false;
    if (s.repeatEnd && s.repeatEnd < dateStr) return false;
    const parts = s.date.split('-');
    if (parts.length < 3) return false;
    const [, sMonth, sDay] = parts.map(Number);
    if (s.repeat === 'daily') return true;
    if (s.repeat === 'monthly') {
      const lastDayOfTargetMonth = new Date(tYear, tMonth, 0).getDate();
      if (sDay === tDay) return true;
      if (sDay > lastDayOfTargetMonth && tDay === lastDayOfTargetMonth) return true;
      return false;
    }
    if (s.repeat === 'yearly') {
      if (sMonth === 2 && sDay === 29) {
        const isLeapYear = (tYear % 4 === 0 && tYear % 100 !== 0) || (tYear % 400 === 0);
        if (!isLeapYear && tMonth === 2 && tDay === 28) return true;
      }
      return sMonth === tMonth && sDay === tDay;
    }
    return false;
  });
}

async function checkAlarms() {
  const now = new Date();
  const todayStr = formatDate(now);
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const key = `${todayStr} ${timeStr}`;
  if (lastCheckedMinute === key) return;
  lastCheckedMinute = key;

  const schedules = await loadSchedules();
  const due = getSchedulesForDate(schedules, todayStr).filter(s => s.alert === timeStr);
  for (const s of due) {
    await self.registration.showNotification('⏰ 물도이일정 알림', {
      body: s.content || '등록된 일정 알림입니다.',
      tag: `muldoi-${s.id || s.content}-${key}`,
      renotify: true,
      requireInteraction: true,
      vibrate: [300, 120, 300, 120, 300],
      data: { url: './index.html' }
    });
  }
}

setInterval(() => {
  checkAlarms().catch(console.error);
}, CHECK_INTERVAL_MS);

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) return client.focus();
    }
    if (clients.openWindow) return clients.openWindow('./index.html');
  })());
});


self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
