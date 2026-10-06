importScripts('/db.js');

const CACHE = 'eleicao-v4';
const ASSETS = ['/', '/index.html', '/resultado.html', '/offline.html', '/style.css',
  '/app.js', '/db.js', '/candidatos.json', '/manifest.json', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(ASSETS);
    // fotos: tolerante a arquivos ainda não adicionados
    const lista = await (await fetch('/candidatos.json')).json();
    await Promise.allSettled(lista.map(j => c.add(j.foto)));
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Estratégia: Network First para dados (/api e candidatos), Cache First para o resto
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const dados = url.pathname.startsWith('/api/') || url.pathname === '/candidatos.json';
  e.respondWith(dados ? redeDepoisCache(req) : cacheDepoisRede(req));
});

async function cacheDepoisRede(req) {
  const guardado = await caches.match(req);
  if (guardado) return guardado;
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
    return res;
  } catch {
    return req.mode === 'navigate' ? caches.match('/offline.html') : Response.error();
  }
}

async function redeDepoisCache(req) {
  try {
    const res = await fetch(req);
    (await caches.open(CACHE)).put(req, res.clone());
    return res;
  } catch {
    return (await caches.match(req)) || Response.error();
  }
}

// Background Sync: envia os votos pendentes quando a conexão volta
self.addEventListener('sync', e => {
  if (e.tag === 'sincronizar-votos') e.waitUntil(sincronizar());
});

async function sincronizar() {
  const fila = await Fila.todos();
  for (const voto of fila) {
    const r = await fetch('/api/votos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(voto)
    });
    if (r.ok || r.status === 409) await Fila.remover(voto.id);
    else throw new Error('Falha ao sincronizar');
  }
  const abas = await self.clients.matchAll();
  abas.forEach(a => a.postMessage('sincronizado'));
}

// Push: recebe o evento e mostra a notificação
self.addEventListener('push', e => {
  const body = e.data ? e.data.text() : 'Há uma nova atualização da eleição.';
  e.waitUntil(self.registration.showNotification('Eleições Digitais', {
    body, icon: '/icon.svg', data: { url: '/resultado.html' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow(e.notification.data?.url || '/'));
});
