(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(globalThis);
  else root.SFHistory = factory(root);
})(typeof self === "object" ? self : globalThis, function (root) {
  "use strict";
  var DB_NAME = "sharpfish-history", DB_VERSION = 1, STORE = "games", LIMIT = 50;
  var memory = [];
  var dbPromise = null;
  var fallbackKey = "sharpfish-history-v1";

  function clone(v) {
    if (v == null) return v;
    if (typeof structuredClone === "function") return structuredClone(v);
    return JSON.parse(JSON.stringify(v));
  }
  function newId() {
    return "game-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }
  function normalize(record) {
    var now = Date.now();
    var r = clone(record || {});
    if (!r.id) r.id = newId();
    if (!r.createdAt) r.createdAt = now;
    r.updatedAt = r.updatedAt || now;
    r.revision = Number.isInteger(r.revision) ? r.revision : 0;
    r.moves = Array.isArray(r.moves) ? r.moves.slice() : [];
    r.san = Array.isArray(r.san) ? r.san.slice() : [];
    r.boards = Array.isArray(r.boards) ? clone(r.boards) : [];
    r.grades = r.grades && typeof r.grades === "object" ? clone(r.grades) : {};
    r.headers = r.headers && typeof r.headers === "object" ? clone(r.headers) : {};
    r.result = r.result || "*";
    r.schemaVersion = 1;
    return r;
  }
  function merge(existing, incoming) {
    if (!existing) return normalize(incoming);
    var next = normalize(incoming);
    if (next.revision < existing.revision) return clone(existing);
    next.createdAt = existing.createdAt;
    if (next.revision === existing.revision) {
      if ((next.startFen || "") !== (existing.startFen || "") || next.moves.join(" ") !== existing.moves.join(" ")) return clone(existing);
      next = Object.assign({}, clone(existing), { grades: Object.assign({}, existing.grades || {}, incoming.grades || {}) });
      next.updatedAt = Math.max(existing.updatedAt || 0, incoming.updatedAt || 0);
    }
    return next;
  }
  function openDb() {
    if (dbPromise) return dbPromise;
    if (!root.indexedDB) return Promise.reject(new Error("IndexedDB unavailable"));
    dbPromise = new Promise(function (resolve, reject) {
      var req = root.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        var store = db.objectStoreNames.contains(STORE) ? req.transaction.objectStore(STORE) : db.createObjectStore(STORE, { keyPath: "id" });
        if (!store.indexNames.contains("updatedAt")) store.createIndex("updatedAt", "updatedAt");
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("Unable to open history")); };
    });
    return dbPromise;
  }
  function fallbackRead() {
    try {
      if (!root.localStorage) return memory.slice();
      var raw = root.localStorage.getItem(fallbackKey);
      var stored = raw ? JSON.parse(raw) : [];
      return mergedRows(Array.isArray(stored) ? stored : [], memory);
    } catch (_) { return memory.slice(); }
  }
  function fallbackWrite(rows) {
    memory = rows.map(clone);
    try {
      if (!root.localStorage) throw new Error("Local game storage is unavailable");
      root.localStorage.setItem(fallbackKey, JSON.stringify(rows));
      return true;
    } catch (_) { return false; /* the in-memory session copy remains usable */ }
  }
  function mergedRows(primary, secondary) {
    var byId = Object.create(null);
    primary.concat(secondary).forEach(function (row) {
      if (!row || !row.id) return;
      byId[row.id] = byId[row.id] ? merge(byId[row.id], row) : clone(row);
    });
    return Object.keys(byId).map(function (id) { return byId[id]; })
      .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, LIMIT);
  }
  function fallbackSave(record) {
    var rows = fallbackRead(), existing = rows.find(function (r) { return r.id === record.id; });
    var merged = merge(existing, record);
    rows = rows.filter(function (r) { return r.id !== merged.id; });
    rows.push(merged);
    var durable = fallbackWrite(rows.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, LIMIT));
    return Object.assign(clone(merged), { _durable: durable });
  }
  function transactionSave(record) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE), result;
        var get = store.get(record.id);
        get.onerror = function () { reject(get.error || new Error("Unable to read history")); };
        get.onsuccess = function () {
          var existing = get.result, merged = merge(existing, record);
          result = merged;
          store.put(merged);
          var all = store.getAll();
          all.onsuccess = function () {
            var rows = all.result.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
            rows.slice(LIMIT).forEach(function (row) { store.delete(row.id); });
          };
        };
        tx.oncomplete = function () { resolve(clone(result)); };
        tx.onerror = function () { reject(tx.error || new Error("Unable to save history")); };
        tx.onabort = function () { reject(tx.error || new Error("History save aborted")); };
      });
    }).catch(function () {
      return fallbackSave(record);
    });
  }
  function transactionList() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readonly"), req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () { resolve(req.result.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).map(clone)); };
        req.onerror = function () { reject(req.error || new Error("Unable to list history")); };
      });
    }).then(function (rows) { return mergedRows(rows, fallbackRead()); })
      .catch(function () { return fallbackRead().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, LIMIT).map(clone); });
  }
  function transactionGet(id) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
        req.onsuccess = function () { resolve(req.result ? clone(req.result) : null); };
        req.onerror = function () { reject(req.error || new Error("Unable to read history")); };
      });
    }).then(function (row) {
      var fallback = fallbackRead().find(function (x) { return x.id === id; });
      return row && fallback ? merge(row, fallback) : row || (fallback ? clone(fallback) : null);
    }).catch(function () { var r = fallbackRead().find(function (x) { return x.id === id; }); return r ? clone(r) : null; });
  }
  function save(record) {
    if (!record || !Array.isArray(record.moves) || (!record.moves.length && !record.id)) return Promise.resolve(null);
    var r = normalize(record); r.updatedAt = Date.now();
    return transactionSave(r);
  }
  function updateGrades(id, revision, grades) {
    function apply(record) {
      if (!record || revision !== record.revision) return record;
      var compatible = {};
      Object.keys(grades || {}).forEach(function (index) {
        var grade = grades[index], ply = Number(index);
        if (!Number.isInteger(ply) || ply < 0 || ply >= record.moves.length) return;
        var fingerprint = root.SFAnalysis && root.SFAnalysis.historyKey ?
          root.SFAnalysis.historyKey(record, ply + 1) :
          (record.startFen || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1") + "|" + record.moves.slice(0, ply + 1).join(" ");
        if (grade.historyKey === fingerprint) compatible[index] = grade;
      });
      return Object.assign({}, record, { grades: Object.assign({}, record.grades || {}, compatible), updatedAt: Date.now() });
    }
    if (!root.indexedDB) return transactionGet(id).then(function (r) { var next = apply(r); return next ? transactionSave(next) : null; });
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE), result;
        var req = store.get(id);
        req.onsuccess = function () { result = apply(req.result); if (result && revision === result.revision) store.put(result); };
        tx.oncomplete = function () { resolve(result ? clone(result) : null); };
        tx.onerror = tx.onabort = function () { reject(tx.error || new Error("Unable to save move grades")); };
      });
    }).catch(function () {
      return transactionGet(id).then(function (r) {
        var next = apply(r); return next ? fallbackSave(next) : null;
      });
    });
  }
  return { VERSION: 1, LIMIT: LIMIT, newId: newId, save: save, list: transactionList, get: transactionGet, updateGrades: updateGrades, normalize: normalize, merge: merge };
});
