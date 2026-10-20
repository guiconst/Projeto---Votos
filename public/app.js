const $ = id => document.getElementById(id);
let candidatos = [];

// Identificação anônima do eleitor neste navegador (nenhum dado pessoal é coletado)
const eleitor = localStorage.getItem('eleitor') || crypto.randomUUID();
localStorage.setItem('eleitor', eleitor);

const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- Service Worker ----
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(() => console.log('SW registrado'))
    .catch(err => console.warn('Falha ao registrar o SW:', err));
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data === 'sincronizado') {
      mostrarAviso('Votos sincronizados com o servidor.');
      atualizarPendentes();
      carregarResultado();
    }
  });
}

// ---- Status e pendências ----
function atualizarStatus() {
  const s = $('status');
  s.textContent = navigator.onLine ? 'Online' : 'Offline';
  s.classList.toggle('off', !navigator.onLine);
}
async function atualizarPendentes() {
  const n = (await Fila.todos()).length;
  const p = $('pendentes');
  p.hidden = n === 0;
  p.textContent = `${n} voto(s) pendente(s)`;
}
function mostrarAviso(t) { const a = $('aviso'); a.textContent = t; a.hidden = false; }

window.addEventListener('online', () => { atualizarStatus(); sincronizarAgora(); carregarResultado(); });
window.addEventListener('offline', atualizarStatus);

// ---- Sincronização: Background Sync, com plano B quando o navegador não oferece (ou bloqueia) ----
async function enviarPendenciasManual() {
  for (const v of await Fila.todos()) {
    try {
      const r = await fetch('/api/votos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) });
      if (r.ok || r.status === 409 || r.status === 400) await Fila.remover(v.id);
    } catch { return; } // sem rede: mantém na fila e tenta quando o evento "online" disparar
  }
  await atualizarPendentes();
  carregarResultado();
}

async function sincronizarAgora() {
  if (!('serviceWorker' in navigator)) return enviarPendenciasManual();
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!('sync' in reg)) throw new Error('Background Sync não suportado');
    await reg.sync.register('sincronizar-votos');
  } catch (err) {
    // Safari/Firefox ou Background Sync desativado: usa o envio manual
    console.warn('Background Sync indisponível, usando plano B:', err.message);
    await enviarPendenciasManual();
  }
}

// ---- Candidatos e votação ----
async function carregarCandidatos() {
  candidatos = await (await fetch('/candidatos.json')).json();
  return candidatos;
}

async function renderLista() {
  await carregarCandidatos();
  const jaVotou = !!localStorage.getItem('votou');
  if (jaVotou) mostrarAviso('Seu voto já foi registrado neste navegador.');
  $('lista').innerHTML = candidatos.map(c => `
    <li class="card">
      <div class="foto">
        <span class="num" aria-hidden="true">${esc(c.numero)}</span>
        <img class="${c.encaixe === 'contain' ? 'ctn' : ''}" src="${esc(c.foto)}" alt="Capa de ${esc(c.nome)}" loading="lazy" width="300" height="400" onerror="this.remove()">
      </div>
      <div>
        <h2>${esc(c.nome)}</h2>
        <small>${esc(c.genero)} • ${esc(c.ano)}</small>
        <ul>${c.propostas.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
        <button class="btn" aria-label="Votar em ${esc(c.nome)}" data-id="${c.id}" ${jaVotou ? 'disabled' : ''}>Votar</button>
      </div>
    </li>`).join('');
}

$('lista')?.addEventListener('click', e => {
  const b = e.target.closest('button[data-id]');
  if (b) votar(Number(b.dataset.id));
});

async function votar(candidatoId) {
  if (localStorage.getItem('votou')) return;
  try {
    await Fila.add({ id: crypto.randomUUID(), eleitor, candidatoId, em: Date.now() });
  } catch {
    return mostrarAviso('Não foi possível guardar seu voto neste navegador. Tente novamente.');
  }
  localStorage.setItem('votou', '1');
  document.querySelectorAll('button[data-id]').forEach(b => (b.disabled = true));
  mostrarAviso(navigator.onLine ? 'Voto registrado! Enviando...' : 'Sem conexão: voto salvo e será enviado quando a internet voltar.');
  await atualizarPendentes();
  sincronizarAgora();
}

// ---- Apuração ----
async function carregarResultado() {
  if (!$('resultado')) return;
  await carregarCandidatos();
  let dados = { total: 0, contagem: {} };
  try {
    const r = await fetch('/api/resultado');
    if (!r.ok) throw new Error(r.status);
    dados = await r.json();
    $('aviso').hidden = true;
  } catch { mostrarAviso('Sem dados da apuração agora. Conecte-se para atualizar.'); }
  const ordenados = [...candidatos].sort((a, b) => (dados.contagem[b.id] || 0) - (dados.contagem[a.id] || 0));
  $('resultado').innerHTML = ordenados.map(c => {
    const n = dados.contagem[c.id] || 0;
    const pct = dados.total ? Math.round((n / dados.total) * 100) : 0;
    return `<li class="card linha"><strong>${esc(c.numero)} • ${esc(c.nome)}</strong><span>${n} voto(s), ${pct}%</span>
      <div class="fundo"><i style="width:${pct}%"></i></div></li>`;
  }).join('');
}

// ---- Notificações: Push real (VAPID) e, se não der, simulação didática ----
const btn = $('btnNotif');

function chaveParaBytes(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const bin = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function inscreverPush(reg) {
  if (!('PushManager' in window)) throw new Error('Push não suportado');
  const { chave } = await (await fetch('/api/push/chave')).json();
  const sub = (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(chave) }));
  const r = await fetch('/api/push/inscrever', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
  if (!r.ok) throw new Error('Servidor recusou a inscrição');
}

function atualizarBotaoAvisos(concedida = ('Notification' in window && Notification.permission === 'granted')) {
  if (btn && concedida) btn.textContent = 'Avisos ativados ✓';
}

if (btn) {
  atualizarBotaoAvisos();
  btn.addEventListener('click', async () => {
    if (!('Notification' in window)) return mostrarAviso('Este navegador não suporta notificações.');
    if ((await Notification.requestPermission()) !== 'granted') return mostrarAviso('Permissão negada. Você pode liberar nas configurações do site.');
    atualizarBotaoAvisos(true);
    const reg = await navigator.serviceWorker.ready;
    let real = true;
    try { await inscreverPush(reg); }
    catch (err) { real = false; console.warn('Push real indisponível, usando simulação:', err.message); }
    try {
      await reg.showNotification('Eleições Digitais', {
        body: real ? 'Avisos ativados! Você receberá novidades da eleição.' : 'Avisos ativados (modo simulação neste ambiente).',
        icon: '/icon-192.png', badge: '/icon-192.png', tag: 'eleicao-aviso', data: { url: '/resultado.html' }
      });
      mostrarAviso(real ? 'Push ativado: o servidor pode enviar avisos mesmo com o app fechado.' : 'Push real indisponível aqui: notificação simulada pelo Service Worker.');
    } catch (err) {
      mostrarAviso('Não foi possível exibir a notificação neste navegador.');
    }
  });
}

// ---- Início ----
atualizarStatus();
atualizarPendentes().then(() => { if (navigator.onLine) Fila.todos().then(f => f.length && sincronizarAgora()); });
if ($('lista')) renderLista();
carregarResultado();
