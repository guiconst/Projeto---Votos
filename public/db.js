// Fila offline em IndexedDB (usada pela página e pelo Service Worker)
function abrirDB() {
  return new Promise((ok, erro) => {
    const r = indexedDB.open('eleicao-db', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('fila', { keyPath: 'id' });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
  });
}
async function operar(modo, fn) {
  const db = await abrirDB();
  return new Promise((ok, erro) => {
    const t = db.transaction('fila', modo);
    const req = fn(t.objectStore('fila'));
    t.oncomplete = () => ok(req && req.result);
    t.onerror = () => erro(t.error);
  });
}
const Fila = {
  add: voto => operar('readwrite', s => s.put(voto)),
  todos: () => operar('readonly', s => s.getAll()),
  remover: id => operar('readwrite', s => s.delete(id))
};
