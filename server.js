const express = require('express');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const app = express();
app.use(express.json({ limit: '20kb' }));

// ---- Armazenamento simples em arquivo (didático) ----
const PASTA = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(PASTA, { recursive: true });
const ARQ_VOTOS = path.join(PASTA, 'votos.json');
const ARQ_INSCRICOES = path.join(PASTA, 'inscricoes.json');
const ARQ_VAPID = path.join(PASTA, 'vapid.json');

function ler(arquivo, padrao) {
  try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { return padrao; }
}
function gravar(arquivo, dados) { fs.writeFileSync(arquivo, JSON.stringify(dados)); }

let votos = ler(ARQ_VOTOS, []);
let inscricoes = ler(ARQ_INSCRICOES, []);

// ---- Chaves VAPID (Push real). Vêm do ambiente ou são geradas na 1ª execução ----
let vapid = process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE
  ? { publicKey: process.env.VAPID_PUBLIC, privateKey: process.env.VAPID_PRIVATE }
  : ler(ARQ_VAPID, null);
if (!vapid) { vapid = webpush.generateVAPIDKeys(); gravar(ARQ_VAPID, vapid); }
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', vapid.publicKey, vapid.privateKey);

// Dados da API nunca devem ficar no cache HTTP do navegador (o cache é do Service Worker)
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// ---- Votos (também usado pela sincronização em segundo plano) ----
app.post('/api/votos', (req, res) => {
  const { id, eleitor, candidatoId } = req.body || {};
  const valido = typeof id === 'string' && typeof eleitor === 'string' && Number.isInteger(candidatoId)
    && id.length <= 64 && eleitor.length <= 64;
  if (!valido) return res.status(400).json({ erro: 'Dados inválidos' });
  if (votos.some(v => v.eleitor === eleitor)) return res.status(409).json({ erro: 'Voto duplicado' });
  votos.push({ id, eleitor, candidatoId, em: Date.now() });
  gravar(ARQ_VOTOS, votos);
  res.status(201).json({ ok: true });
});

app.get('/api/resultado', (req, res) => {
  const contagem = {};
  votos.forEach(v => { contagem[v.candidatoId] = (contagem[v.candidatoId] || 0) + 1; });
  res.json({ total: votos.length, contagem });
});

// ---- Push Notifications ----
app.get('/api/push/chave', (req, res) => res.json({ chave: vapid.publicKey }));

// Guarda apenas o endpoint técnico da inscrição (sem nome, e-mail ou outro dado pessoal)
app.post('/api/push/inscrever', (req, res) => {
  const sub = req.body;
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys) return res.status(400).json({ erro: 'Inscrição inválida' });
  if (!inscricoes.some(s => s.endpoint === sub.endpoint)) {
    inscricoes.push({ endpoint: sub.endpoint, keys: sub.keys });
    gravar(ARQ_INSCRICOES, inscricoes);
  }
  res.status(201).json({ ok: true, total: inscricoes.length });
});

// Dispara uma notificação para todos os inscritos. Se ADMIN_TOKEN existir, ele é obrigatório.
app.post('/api/push/enviar', async (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  if (token && req.get('x-admin-token') !== token) return res.status(401).json({ erro: 'Não autorizado' });
  const { titulo = 'Eleições Digitais', mensagem = 'Há uma nova atualização da eleição.', url = '/resultado.html' } = req.body || {};
  const carga = JSON.stringify({ titulo, mensagem, url });
  let enviados = 0;
  const vivos = [];
  await Promise.all(inscricoes.map(async s => {
    try { await webpush.sendNotification(s, carga); enviados++; vivos.push(s); }
    catch (e) { if (e.statusCode !== 404 && e.statusCode !== 410) vivos.push(s); } // 404/410 = inscrição expirada
  }));
  inscricoes = vivos; gravar(ARQ_INSCRICOES, inscricoes);
  res.json({ enviados, total: vivos.length });
});

app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

// O sw.js nunca pode ficar preso no cache HTTP, senão as atualizações demoram a chegar
app.get('/sw.js', (req, res, next) => { res.set('Cache-Control', 'no-cache'); next(); });
app.use(express.static(path.join(__dirname, 'public')));

const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => console.log(`http://localhost:${PORTA}`));
