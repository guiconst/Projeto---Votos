const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const ARQUIVO = path.join(__dirname, 'data', 'votos.json');
fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
let votos = fs.existsSync(ARQUIVO) ? JSON.parse(fs.readFileSync(ARQUIVO)) : [];

// Recebe um voto (também usado pela sincronização em segundo plano)
app.post('/api/votos', (req, res) => {
  const { id, eleitor, candidatoId } = req.body || {};
  if (!id || !eleitor || !candidatoId) return res.status(400).json({ erro: 'Dados inválidos' });
  if (votos.some(v => v.eleitor === eleitor)) return res.status(409).json({ erro: 'Voto duplicado' });
  votos.push({ id, eleitor, candidatoId, em: Date.now() });
  fs.writeFileSync(ARQUIVO, JSON.stringify(votos));
  res.status(201).json({ ok: true });
});

app.get('/api/resultado', (req, res) => {
  const contagem = {};
  votos.forEach(v => { contagem[v.candidatoId] = (contagem[v.candidatoId] || 0) + 1; });
  res.json({ total: votos.length, contagem });
});

app.use(express.static(path.join(__dirname, 'public')));

const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => console.log(`http://localhost:${PORTA}`));
