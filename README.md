# 1. Nome da eleição e integrantes
**Top 20 Jogos** (eleição simulada). Equipe: _preencher_ · Integrantes: _preencher_

# 2. Objetivo e público
Simulação didática de votação que continua funcionando offline. Sem dados eleitorais oficiais.

# 3. Aplicação publicada
_Link aqui_ (ou rode localmente: `npm install && npm start`, depois abra http://localhost:3000)

# 4. Tecnologias
HTML, CSS, JavaScript, Service Worker, Cache API, IndexedDB, Background Sync, Notifications, Node.js/Express.

# 5. Funcionalidades
Candidatos e propostas, votação sem duplicidade, apuração, modo offline, fila de votos pendentes, sincronização, notificação.

# 6. Estratégia de cache e offline
_Cache First para estáticos, Network First para `/api` e `candidatos.json`, fallback `offline.html`. Justificar._

# 7. Background Sync
_Explicar fila IndexedDB, tag `sincronizar-votos` e fallback pelo evento `online`._

# 8. Push Notifications
_Explicar permissão, evento `push`, `notificationclick`. Documentar o que foi simulado e o que um cenário real exigiria (VAPID + servidor)._

# 9. Preload, Prefetch e DNS-prefetch
_Justificar cada um (veja os comentários no `index.html`) e validar no DevTools._

# 10. Testes e evidências
_Os 8 desafios do roteiro, com prints em `/public/screenshots`._

# 11. Problemas e soluções
# 12. Limitações e melhorias
# 13. Vídeo de demonstração
_Link aqui_
