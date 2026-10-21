/* Pattern Nodes — pn-engine.js
   계산 엔진. 화면(DOM)은 건드리지 않고, "노드 연결 → 순서대로 계산 → 캐시"만 맡아요.
   모든 연결선은 같은 규격의 필드예요: { R, d: Float32Array(R*R, 0~1 잉크 농도), c: 색(선택) } */
(function () {
  'use strict';
  var PN = window.PN = window.PN || {};
  (PN.builds = PN.builds || {}).engine = '20261021b';
  PN.defs = PN.defs || {};

  /* ---------- 작은 도구 ---------- */
  function smooth(a, b, x) {
    if (b <= a) return x < a ? 0 : 1;
    var t = (x - a) / (b - a);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  }
  function hashStr(s) { // cyrb53
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57, i, ch;
    for (i = 0; i < s.length; i++) {
      ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  function hash2(ix, iy, s) {
    var h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(s, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function hex2rgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return [1, 1, 1];
    var n = parseInt(m[1], 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  function mkField(R, d, c) { return { R: R, d: d || new Float32Array(R * R), c: c || null }; }

  /* 가장자리가 이어지는(wrap) 상자 흐림 — 패턴이 이음새 없이 반복되게 */
  function boxH(src, dst, R, r) {
    var n = 2 * r + 1, y, x, o, k, sum;
    for (y = 0; y < R; y++) {
      o = y * R; sum = 0;
      for (k = -r; k <= r; k++) sum += src[o + ((k + R) % R)];
      for (x = 0; x < R; x++) {
        dst[o + x] = sum / n;
        sum += src[o + ((x + r + 1) % R)] - src[o + ((x - r + R) % R)];
      }
    }
  }
  function boxV(src, dst, R, r) {
    var n = 2 * r + 1, acc = new Float64Array(R), x, y, k, o, a, b;
    for (k = -r; k <= r; k++) {
      o = ((k + R) % R) * R;
      for (x = 0; x < R; x++) acc[x] += src[o + x];
    }
    for (y = 0; y < R; y++) {
      o = y * R;
      for (x = 0; x < R; x++) dst[o + x] = acc[x] / n;
      a = ((y + r + 1) % R) * R; b = ((y - r + R) % R) * R;
      for (x = 0; x < R; x++) acc[x] += src[a + x] - src[b + x];
    }
  }
  function blur(d, R, radius, passes) {
    var r = Math.round(radius), maxr = (R >> 1) - 1, p = passes || 2, k;
    if (r > maxr) r = maxr;
    if (r < 1) return d;
    var t1 = new Float32Array(d.length), t2 = new Float32Array(d.length), cur = d;
    for (k = 0; k < p; k++) { boxH(cur, t1, R, r); boxV(t1, t2, R, r); cur = t2; }
    return t2;
  }

  /* 샘플 이미지(업로드 전 기본값) — 해상도와 상관없이 같은 모양 */
  function demoField(R) {
    var d = new Float32Array(R * R), x, y, i = 0, u, v;
    for (y = 0; y < R; y++) {
      v = (y + 0.5) / R;
      for (x = 0; x < R; x++, i++) {
        u = (x + 0.5) / R;
        var a = Math.exp(-((u - 0.40) * (u - 0.40) + (v - 0.42) * (v - 0.42)) / 0.03);
        var b = Math.exp(-((u - 0.70) * (u - 0.70) + (v - 0.66) * (v - 0.66)) / 0.018);
        var rr = Math.sqrt((u - 0.5) * (u - 0.5) + (v - 0.5) * (v - 0.5));
        var ring = Math.exp(-Math.pow((rr - 0.34) / 0.035, 2));
        var band = Math.exp(-Math.pow((u + v - 1.05) / 0.06, 2));
        var val = 0.85 * a + 0.7 * b + 0.45 * ring + 0.35 * band;
        d[i] = val > 1 ? 1 : val;
      }
    }
    return d;
  }

  PN.util = { smooth: smooth, hashStr: hashStr, hash2: hash2, hex2rgb: hex2rgb, blur: blur, mkField: mkField, demoField: demoField };
  PN.mkField = mkField;

  /* ---------- 업로드 이미지 보관소 ---------- */
  PN.images = PN.images || {};          // id -> { url, canvas }
  PN.onImageReady = null;               // 편집기가 연결
  PN.addImage = function (url) {          // 같은 이미지는 같은 id → 중복 저장 안 함
    var id = 'img' + hashStr(url);
    if (!PN.images[id]) PN.images[id] = { url: url, canvas: null, loading: false };
    return id;
  };
  PN.imageBytes = function (ids) {        // 저장될 이미지 용량(대략, base64 글자 수)
    var t = 0;
    (ids || Object.keys(PN.images)).forEach(function (id) { if (PN.images[id]) t += PN.images[id].url.length; });
    return t;
  };
  /* 여백 자르기용: 내용이 있는 부분의 경계 상자. kind 'alpha'(투명 기준) | 'ink'(거의 흰색도 여백) */
  PN.imageBBox = function (id, kind) {
    var e = PN.images[id];
    if (!e || !e.canvas) return null;
    e.bb = e.bb || {};
    if (e.bb[kind] !== undefined) return e.bb[kind];
    var c = e.canvas, w = c.width, h = c.height, x, y, o, a, l;
    var d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    var x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        o = (y * w + x) * 4; a = d[o + 3];
        if (a < 9) continue;
        if (kind === 'ink') { l = 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]; if (l > 245) continue; }
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    e.bb[kind] = x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    return e.bb[kind];
  };
  PN.imageReady = function (id) { return !!(id && PN.images[id] && PN.images[id].canvas); };
  PN.imageCanvas = function (id) {
    var e = id && PN.images[id];
    if (!e) return null;
    if (e.canvas) return e.canvas;
    if (!e.loading) {
      e.loading = true;
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = img.naturalWidth || 1024; c.height = img.naturalHeight || 1024;
        c.getContext('2d').drawImage(img, 0, 0);
        e.canvas = c; e.loading = false;
        if (PN.onImageReady) PN.onImageReady(id);
      };
      img.onerror = function () { e.loading = false; e.failed = true; };
      img.src = e.url;
    }
    return null;
  };

  /* ---------- 필드 → 화면/PNG ---------- */
  var scratchMap = {};
  PN.scratch = function (R) {
    var c = scratchMap[R];
    if (!c) { c = scratchMap[R] = document.createElement('canvas'); c.width = c.height = R; }
    return c;
  };
  PN.dropScratch = function (R) { var c = scratchMap[R]; if (c) { c.width = c.height = 1; delete scratchMap[R]; } };
  /* 약속: d = 불투명도(0~1), c = 모듈 색(없으면 검정 잉크). 종이는 여기서 한 번만 깔아요.
     o = { paper: [r,g,b], transparent: bool } */
  PN.fieldImageData = function (f, g, o) {
    o = o || {};
    var R = f.R, N = R * R, id = g.createImageData(R, R), px = id.data, d = f.d, c = f.c, P = o.paper || [255, 255, 255], i, k, a, ia;
    if (o.transparent) {
      for (i = 0; i < N; i++) {
        k = i * 4;
        if (c) { px[k] = c[k]; px[k + 1] = c[k + 1]; px[k + 2] = c[k + 2]; }
        px[k + 3] = d[i] * 255;
      }
    } else if (c) {
      for (i = 0; i < N; i++) {
        k = i * 4; a = d[i]; ia = 1 - a;
        px[k] = P[0] * ia + c[k] * a; px[k + 1] = P[1] * ia + c[k + 1] * a; px[k + 2] = P[2] * ia + c[k + 2] * a; px[k + 3] = 255;
      }
    } else {
      for (i = 0; i < N; i++) {
        k = i * 4; ia = 1 - d[i];
        px[k] = P[0] * ia; px[k + 1] = P[1] * ia; px[k + 2] = P[2] * ia; px[k + 3] = 255;
      }
    }
    return id;
  };
  PN.fieldScratch = function (f, o) {         // 공용 캔버스에 그려서 돌려줘요(바로 쓰고 버리는 용도)
    var c = PN.scratch(f.R), g = c.getContext('2d');
    g.putImageData(PN.fieldImageData(f, g, o), 0, 0);
    return c;
  };
  PN.fieldToCanvas = function (f, o) {        // 내보내기용: 새 캔버스
    var c = document.createElement('canvas'); c.width = c.height = f.R;
    var g = c.getContext('2d');
    g.putImageData(PN.fieldImageData(f, g, o), 0, 0);
    return c;
  };

  /* ---------- 엔진 ---------- */
  function Engine() { this.cache = new Map(); }

  function paramKey(p) { try { return JSON.stringify(p); } catch (e) { return ''; } }

  function compute(def, ins, n, R) {
    var out, err = '';
    try {
      var r = def.compute(ins, n.params, { R: R, node: n });
      if (r && r.d) r = { out: r };
      out = r || {};
    } catch (e) {
      out = {}; err = (e && e.message) ? e.message : String(e);
    }
    return { out: out, err: err };
  }

  /* 미리보기용: 바뀐 노드부터만 다시 계산해요 */
  Engine.prototype.run = function (graph, R) {
    var cache = this.cache, memo = {}, errors = {}, visiting = {}, incoming = {};
    graph.edges.forEach(function (e) { (incoming[e.to] = incoming[e.to] || {})[e.toPort] = e; });

    function visit(id) {
      if (memo[id]) return memo[id];
      var n = graph.nodes[id], def = n && PN.defs[n.type];
      if (!def) return (memo[id] = { sig: 'x', out: {} });
      if (visiting[id]) return { sig: 'cycle', out: {} };
      visiting[id] = true;
      var ins = {}, parts = [n.type, R, paramKey(n.params), def.sigExtra ? def.sigExtra(n.params) : ''];
      def.inputs.forEach(function (p) {
        var e = incoming[id] && incoming[id][p.id];
        if (e && graph.nodes[e.from]) {
          var r = visit(e.from), fp = e.fromPort || 'out';
          ins[p.id] = r.out[fp] || null;
          parts.push(p.id + '<' + r.sig + ':' + fp);
        } else parts.push(p.id + '-');
      });
      var sig = hashStr(parts.join('|')), key = id + '@' + R, ent = cache.get(key);
      if (!ent || ent.sig !== sig) {
        var res = compute(def, ins, n, R);
        ent = { sig: sig, out: res.out, err: res.err };
        cache.set(key, ent);
      }
      if (ent.err) errors[id] = ent.err;
      visiting[id] = false;
      return (memo[id] = { sig: sig, out: ent.out });
    }

    Object.keys(graph.nodes).forEach(visit);
    // 지워진 노드의 캐시 정리
    cache.forEach(function (v, k) { if (!graph.nodes[k.split('@')[0]]) cache.delete(k); });
    var outs = {};
    Object.keys(memo).forEach(function (id) { outs[id] = memo[id].out; });
    return { outs: outs, errors: errors, R: R };
  };

  /* 내보내기용: 큰 해상도로 한 번만 계산하고, 다 쓴 중간 결과는 바로 버려요 */
  Engine.prototype.exportField = function (graph, targetId, R) {
    var incoming = {}, order = [], seen = {}, remaining = {}, memo = {};
    graph.edges.forEach(function (e) { (incoming[e.to] = incoming[e.to] || {})[e.toPort] = e; });
    function dfs(id) {
      if (seen[id]) return;
      seen[id] = 1;
      var n = graph.nodes[id], def = n && PN.defs[n.type];
      if (!def) return;
      def.inputs.forEach(function (p) {
        var e = incoming[id] && incoming[id][p.id];
        if (e && graph.nodes[e.from]) { remaining[e.from] = (remaining[e.from] || 0) + 1; dfs(e.from); }
      });
      order.push(id);
    }
    dfs(targetId);
    order.forEach(function (id) {
      var n = graph.nodes[id], def = PN.defs[n.type], ins = {};
      def.inputs.forEach(function (p) {
        var e = incoming[id] && incoming[id][p.id];
        if (e && memo[e.from]) ins[p.id] = memo[e.from][e.fromPort || 'out'] || null;
      });
      var res = compute(def, ins, n, R);
      if (res.err) throw new Error(def.title + ': ' + res.err);
      memo[id] = res.out;
      def.inputs.forEach(function (p) {
        var e = incoming[id] && incoming[id][p.id];
        if (e && graph.nodes[e.from]) {
          remaining[e.from]--;
          if (remaining[e.from] <= 0 && e.from !== targetId) delete memo[e.from];
        }
      });
    });
    var o = memo[targetId] && memo[targetId].out;
    return o || mkField(R);
  };

  PN.Engine = Engine;
})();
