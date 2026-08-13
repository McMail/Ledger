/**
 * db.js — thin wrapper around IndexedDB.
 * Everything stays on-device. Nothing here ever makes a network request.
 * Stores: transactions, statements, settings
 */
const DB = (() => {
  const DB_NAME = 'ledger-db';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('transactions')) {
          const store = db.createObjectStore('transactions', { keyPath: 'id' });
          store.createIndex('byMonth', 'monthKey', { unique: false });
          store.createIndex('byStatement', 'statementId', { unique: false });
        }
        if (!db.objectStoreNames.contains('statements')) {
          db.createObjectStore('statements', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(storeName, mode) {
    const db = await open();
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  async function put(storeName, value) {
    const store = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put(value);
      req.onsuccess = () => resolve(value);
      req.onerror = () => reject(req.error);
    });
  }

  async function putAll(storeName, values) {
    const db = await open();
    const store = db.transaction(storeName, 'readwrite').objectStore(storeName);
    return new Promise((resolve, reject) => {
      values.forEach(v => store.put(v));
      store.transaction.oncomplete = () => resolve();
      store.transaction.onerror = () => reject(store.transaction.error);
    });
  }

  async function getAll(storeName) {
    const store = await tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function get(storeName, key) {
    const store = await tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /** Delete a statement and every transaction that belongs to it. */
  async function deleteStatement(statementId) {
    const db = await open();
    const txStore = db.transaction(['transactions', 'statements'], 'readwrite');
    const transactions = txStore.objectStore('transactions');
    const statements = txStore.objectStore('statements');
    return new Promise((resolve, reject) => {
      const idx = transactions.index('byStatement');
      const req = idx.openCursor(IDBKeyRange.only(statementId));
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          statements.delete(statementId);
        }
      };
      txStore.oncomplete = () => resolve();
      txStore.onerror = () => reject(txStore.error);
    });
  }

  async function clearAll() {
    const db = await open();
    const names = ['transactions', 'statements', 'settings'];
    return Promise.all(names.map(n => new Promise((resolve, reject) => {
      const req = db.transaction(n, 'readwrite').objectStore(n).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    })));
  }

  async function setSetting(key, value) {
    return put('settings', { key, value });
  }

  async function getSetting(key, fallback = null) {
    const row = await get('settings', key);
    return row ? row.value : fallback;
  }

  return { put, putAll, getAll, get, clearAll, setSetting, getSetting, deleteStatement };
})();
