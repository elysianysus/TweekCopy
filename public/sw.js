const CACHE_NAME = 'analogue-v2';
const SHARE_CACHE_NAME = 'share-target-cache';
const PRECACHE_URLS = [
  '/',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== SHARE_CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname === '/share' && event.request.method === 'POST') {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    const options = {
      body: data.body || '',
      icon: data.icon || '/icon-192.png',
      badge: data.badge || '/icon-192.png',
      vibrate: [200, 100, 200],
      data: data.data || {},
      actions: [{ action: 'open', title: 'Open' }],
    };
    event.waitUntil(Promise.all([
      self.registration.showNotification(data.title || 'Analogue Planner', options),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          try { client.postMessage({ type: 'push', payload: data }); } catch {}
        }
      }),
    ]));
  } catch (e) {
    const text = event.data.text();
    event.waitUntil(self.registration.showNotification('Analogue Planner', { body: text }));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow('/');
    })
  );
});

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    let title = formData.get('title') || '';
    let text = formData.get('text') || '';
    let shareUrl = formData.get('url') || '';
    const file = formData.get('file');

    if (!shareUrl && text) {
      const urlMatch = text.match(/https?:\/\/\S+/);
      if (urlMatch) {
        shareUrl = urlMatch[0];
        text = text.replace(urlMatch[0], '').trim();
      }
    }

    const params = new URLSearchParams();
    if (title) params.set('title', title);
    if (text) params.set('text', text);
    if (shareUrl) params.set('url', shareUrl);

    if (file && file.size > 0) {
      const cache = await caches.open(SHARE_CACHE_NAME);
      const fileResponse = new Response(file, {
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name || 'shared-file'),
        },
      });
      await cache.put('/share-file-data', fileResponse);
      params.set('hasFile', '1');
    }

    const redirectUrl = `/share?${params.toString()}`;
    return Response.redirect(redirectUrl, 303);
  } catch (err) {
    return Response.redirect('/share?error=1', 303);
  }
}
