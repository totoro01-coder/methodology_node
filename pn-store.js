/* Pattern Nodes — pn-store.js
   자동 저장(IndexedDB, 안 되면 localStorage)과 JSON 내보내기·불러오기.
   같은 사이트의 다른 페이지와 섞이지 않게 이름 앞에 pn을 붙였어요. */
(function () {
  'use strict';
  var PN = window.PN;
  (PN.builds = PN.builds || {}).store = '20261021b';
  var DB = 'pattern-nodes', KV = 'kv', KEY = 'project', LS = 'pn:project';

  function openDb() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('no indexedDB'));
      var r;
      try { r = indexedDB.open(DB, 1); } catch (e) { return rej(e); }
      r.onupgradeneeded = function () { r.result.createObjectStore(KV); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function fromLS() {
    try { var s = localStorage.getItem(LS); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }

  PN.store = {
    save: function (obj) {
      return openDb().then(function (db) {
        return new Promise(function (res, rej) {
          var tx = db.transaction(KV, 'readwrite');
          tx.objectStore(KV).put(obj, KEY);
          tx.oncomplete = function () { db.close(); res(true); };
          tx.onerror = function () { rej(tx.error); };
        });
      }).catch(function () {
        try { localStorage.setItem(LS, JSON.stringify(obj)); return true; } catch (e) { return false; }   // 용량 초과면 false
      });
    },
    load: function () {
      return openDb().then(function (db) {
        return new Promise(function (res, rej) {
          var r = db.transaction(KV).objectStore(KV).get(KEY);
          r.onsuccess = function () { db.close(); res(r.result || null); };
          r.onerror = function () { rej(r.error); };
        });
      }).then(function (v) { return v || fromLS(); }, function () { return fromLS(); });
    },
    clear: function () {
      try { localStorage.removeItem(LS); } catch (e) { /* 무시 */ }
      return openDb().then(function (db) {
        return new Promise(function (res) {
          var tx = db.transaction(KV, 'readwrite'); tx.objectStore(KV).delete(KEY);
          tx.oncomplete = function () { db.close(); res(); }; tx.onerror = function () { res(); };
        });
      }).catch(function () { });
    },
    /* 브라우저 기본 다운로드 (외부 호스팅에서도 동작) */
    download: function (blob, name) {
      var a = document.createElement('a'), url = URL.createObjectURL(blob);
      a.href = url; a.download = name; a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
    },
    readText: function (file) {
      return new Promise(function (res, rej) {
        var r = new FileReader();
        r.onload = function () { res(String(r.result)); };
        r.onerror = function () { rej(r.error); };
        r.readAsText(file);
      });
    }
  };
})();
