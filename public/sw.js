importScripts('/db.js');

const CACHE = 'eleicao-v5';               // arquivos do app + dados
const CACHE_FONTES = 'eleicao-fontes-v1'; // fontes do Google (domínio externo)
const ASSETS = ['/', '/index.html', '/resultado.html', '/offline.html', '/style.css',
  '/app.js', '/db.js', '/candidatos.json', '/manifest.json', '/icon.svg',
  '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'];
const HOSTS_FONTES = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// ---------- Instalação: pré-cache do app inteiro ----------
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(ASSETS);
    // capas dos jogos: tolerante a arquivos que ainda não existam
    const lista = await (await fetch('/candidatos.json')).json();
    await Promise.allSettled(lista.map(j => c.add(j.foto)));
  }).then(() => self.skipWaiting()));
});

// ---------- Ativação: apaga caches de versões antigas ----------
self.addEventListener('activate', e => {
  const manter = [CACHE, CACHE_FONTES];
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => !manter.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ---------- Fetch: escolhe a estratégia por tipo de recurso ----------
//  - /api e candidatos.json  -> Network First (dado fresco; cache só se a rede cair)
//  - fontes do Google        -> Stale While Revalidate (mostra o guardado e atualiza ao fundo)
//  - demais arquivos do app  -> Cache First (rápido e funciona offline)
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (HOSTS_FONTES.includes(url.hostname)) {
    e.respondWith(staleWhileRevalidate(req));
    return;
  }
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
    // Fallback: navegação sem cache e sem rede -> página offline.html
    return req.mode === 'navigate' ? caches.match('/offline.html') : Response.error();
  }
}

async function redeDepoisCache(req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
    return res;
  } catch {
    return (await caches.match(req)) || Response.error();
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_FONTES);
  const guardado = await cache.match(req);
  const rede = fetch(req).then(res => {
    // respostas "opaque" (no-cors) são aceitas: o navegador consegue usá-las mesmo sem ler o conteúdo
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return guardado || (await rede) || Response.error();
}

// ---------- Background Sync: envia os votos pendentes quando a conexão volta ----------
self.addEventListener('sync', e => {
  if (e.tag === 'sincronizar-votos') e.waitUntil(sincronizar());
});

async function sincronizar() {
  const fila = await Fila.todos();
  let enviados = 0;
  for (const voto of fila) {
    // se o fetch falhar (sem rede), o erro sobe e o navegador tenta o sync de novo depois
    const r = await fetch('/api/votos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(voto)
    });
    if (r.ok || r.status === 409) { await Fila.remover(voto.id); enviados++; }
    else if (r.status === 400) await Fila.remover(voto.id); // voto inválido: não adianta tentar de novo
    else throw new Error('Falha ao sincronizar: ' + r.status);
  }

  const abas = await self.clients.matchAll({ type: 'window' });
  abas.forEach(a => a.postMessage('sincronizado'));

  // Só notifica se alguém foi enviado, a permissão existe e o usuário NÃO está olhando o app
  const aberta = abas.some(a => a.visibilityState === 'visible');
  if (enviados > 0 && !aberta && self.Notification && Notification.permission === 'granted') {
    await self.registration.showNotification('Voto confirmado', {
      body: 'Seu voto foi sincronizado. Veja a apuração.',
      icon: '/icon-192.png', badge: '/icon-192.png', tag: 'voto-sincronizado',
      data: { url: '/resultado.html' }
    });
  }
}

// ---------- Push: recebe o evento e mostra a notificação ----------
self.addEventListener('push', e => {
  let dados = { titulo: 'Eleições Digitais', mensagem: 'Há uma nova atualização da eleição.', url: '/resultado.html' };
  if (e.data) {
    try { dados = { ...dados, ...e.data.json() }; }
    catch { dados.mensagem = e.data.text() || dados.mensagem; } // texto simples (ex.: botão Push do DevTools)
  }
  e.waitUntil(self.registration.showNotification(dados.titulo, {
    body: dados.mensagem,
    icon: '/icon-192.png', badge: '/icon-192.png',
    tag: 'eleicao-aviso', data: { url: dados.url }
  }));
});

// Clique: leva o usuário à tela relevante (reaproveita a aba aberta, se houver)
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const destino = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const abas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const aba of abas) {
      if (new URL(aba.url).origin === self.location.origin && 'focus' in aba) {
        await aba.focus();
        if (aba.url !== destino && 'navigate' in aba) return aba.navigate(destino);
        return;
      }
    }
    return self.clients.openWindow(destino);
  })());
});
