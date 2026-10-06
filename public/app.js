const $ = id => document.getElementById(id);
let candidatos = [];

// Identificação anônima do eleitor nesta sessão/navegador
const eleitor = localStorage.getItem('eleitor') || crypto.randomUUID();
localStorage.setItem('eleitor', eleitor);

// ---- Service Worker ----
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(() => console.log('SW registrado'));
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data === 'sincronizado') { mostrarAviso('Votos sincronizados com o servidor.'); atualizarPendentes(); carregarResultado(); }
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

window.addEventListener('online', () => { atualizarStatus(); sincronizarAgora(); });
window.addEventListener('offline', atualizarStatus);

// ---- Sincronização (Background Sync + fallback pelo evento online) ----
async function sincronizarAgora() {
  const reg = await navigator.serviceWorker.ready;
  if ('sync' in reg) return reg.sync.register('sincronizar-votos');
  for (const v of await Fila.todos()) {
    const r = await fetch('/api/votos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) });
    if (r.ok || r.status === 409) await Fila.remover(v.id);
  }
  atualizarPendentes();
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
        <span class="num" aria-hidden="true">${c.numero}</span>
        <img class="${c.encaixe === 'contain' ? 'ctn' : ''}" src="${c.foto}" alt="Capa de ${c.nome}" loading="lazy" onerror="this.remove()">
      </div>
      <div>
        <h2>${c.nome}</h2>
        <small>${c.genero} • ${c.ano}</small>
        <ul>${c.propostas.map(p => `<li>${p}</li>`).join('')}</ul>
        <button class="btn" aria-label="Votar em ${c.nome}" data-id="${c.id}" ${jaVotou ? 'disabled' : ''}>Votar</button>
      </div>
    </li>`).join('');
  $('lista').addEventListener('click', e => {
    const b = e.target.closest('button[data-id]');
    if (b) votar(Number(b.dataset.id));
  });
}

async function votar(candidatoId) {
  if (localStorage.getItem('votou')) return;
  await Fila.add({ id: crypto.randomUUID(), eleitor, candidatoId, em: Date.now() });
  localStorage.setItem('votou', '1');
  document.querySelectorAll('button[data-id]').forEach(b => (b.disabled = true));
  mostrarAviso(navigator.onLine ? 'Voto registrado! Enviando...' : 'Sem conexão: voto salvo e será enviado quando a internet voltar.');
  atualizarPendentes();
  sincronizarAgora();
}

// ---- Apuração ----
async function carregarResultado() {
  if (!$('resultado')) return;
  await carregarCandidatos();
  let dados = { total: 0, contagem: {} };
  try { dados = await (await fetch('/api/resultado')).json(); }
  catch { mostrarAviso('Sem dados da apuração agora. Conecte-se para atualizar.'); }
  const ordenados = [...candidatos].sort((a, b) => (dados.contagem[b.id] || 0) - (dados.contagem[a.id] || 0));
  $('resultado').innerHTML = ordenados.map(c => {
    const n = dados.contagem[c.id] || 0;
    const pct = dados.total ? Math.round((n / dados.total) * 100) : 0;
    return `<li class="card linha"><strong>${c.numero} • ${c.nome}</strong><span>${n} voto(s), ${pct}%</span>
      <div class="fundo"><i style="width:${pct}%"></i></div></li>`;
  }).join('');
}

// ---- Notificações (simulação didática) ----
const btn = $('btnNotif');
if (btn) btn.addEventListener('click', async () => {
  if (!('Notification' in window)) return mostrarAviso('Este navegador não suporta notificações.');
  if ((await Notification.requestPermission()) !== 'granted') return mostrarAviso('Permissão negada.');
  const reg = await navigator.serviceWorker.ready;
  reg.showNotification('Eleições Digitais', { body: 'Apuração disponível!', icon: '/icon.svg', data: { url: '/resultado.html' } });
});

// ---- Início ----
atualizarStatus();
atualizarPendentes();
if ($('lista')) renderLista();
carregarResultado();
