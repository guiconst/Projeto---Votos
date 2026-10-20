// Uso: npm run push -- "Apuração disponível!"   (servidor precisa estar rodando)
const base = process.env.URL_BASE || 'http://localhost:3000';
const mensagem = process.argv.slice(2).join(' ') || 'Apuração disponível!';
fetch(`${base}/api/push/enviar`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-admin-token': process.env.ADMIN_TOKEN || '' },
  body: JSON.stringify({ titulo: 'Eleições Digitais', mensagem, url: '/resultado.html' })
}).then(r => r.json()).then(r => console.log('Resultado:', r)).catch(e => console.error('Falha:', e.message));
