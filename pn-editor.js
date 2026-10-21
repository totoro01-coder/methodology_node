/* Pattern Nodes — pn-editor.js
   노드 편집 화면: 끌어다 놓기, 선 연결, 확대·이동, 썸네일, 미리보기, 되돌리기, 저장.
   (계산은 pn-engine.js / pn-nodes.js, 저장은 pn-store.js) */
(function () {
  'use strict';
  var PN = window.PN, B = '20261021b';
  (PN.builds = PN.builds || {}).editor = B;

  var NS = 'http://www.w3.org/2000/svg';
  var R_FAST = 256, R_FULL = 512, IMG_MAX = 1600;
  var $ = function (s) { return document.querySelector(s); };
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  var S = {
    graph: { nodes: {}, edges: [], nextId: 1 },
    view: { x: 40, y: 40, s: 1 },
    sel: {}, selEdge: null, preview: null, last: null, tile2: false,
    undo: [], redo: [], committed: ''
  };
  var engine = new PN.Engine();
  var nodeEls = {};
  var stage, world, svg, marq, menuEl = null, busy = false;

  /* ============ 화면 변환 ============ */
  function applyView() {
    world.style.transform = 'translate(' + S.view.x + 'px,' + S.view.y + 'px) scale(' + S.view.s + ')';
    stage.style.backgroundSize = (24 * S.view.s) + 'px ' + (24 * S.view.s) + 'px';
    stage.style.backgroundPosition = S.view.x + 'px ' + S.view.y + 'px';
  }
  function toWorld(cx, cy) {
    var r = stage.getBoundingClientRect();
    return { x: (cx - r.left - S.view.x) / S.view.s, y: (cy - r.top - S.view.y) / S.view.s };
  }
  function zoomAt(cx, cy, k) {
    var r = stage.getBoundingClientRect(), s2 = clamp(S.view.s * k, 0.25, 2), px = cx - r.left, py = cy - r.top;
    S.view.x = px - (px - S.view.x) * (s2 / S.view.s);
    S.view.y = py - (py - S.view.y) * (s2 / S.view.s);
    S.view.s = s2; applyView(); scheduleSave();
  }
  function fitView() {
    var ids = Object.keys(S.graph.nodes);
    if (!ids.length) { S.view = { x: 40, y: 40, s: 1 }; applyView(); return; }
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    ids.forEach(function (id) {
      var n = S.graph.nodes[id], e = nodeEls[id], h = e ? e.offsetHeight : 300;
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + 208); y1 = Math.max(y1, n.y + h);
    });
    var r = stage.getBoundingClientRect(), pad = 40;
    var s = clamp(Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0)), 0.25, 1);
    S.view.s = s;
    S.view.x = (r.width - (x1 - x0) * s) / 2 - x0 * s;
    S.view.y = (r.height - (y1 - y0) * s) / 2 - y0 * s;
    applyView(); scheduleSave();
  }

  /* ============ 알림 · 메뉴 ============ */
  var toastTimer = 0;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function showMenu(x, y, groups) {
    closeMenu();
    var m = el('div', 'menu');
    groups.forEach(function (g) {
      if (g.title) m.appendChild(el('div', 'mh', g.title));
      g.items.forEach(function (it) {
        var row = el('div', 'mi'); row.appendChild(el('span', '', it.label));
        if (it.sub) row.appendChild(el('span', 'ms', it.sub));
        row.addEventListener('click', function () { closeMenu(); it.fn(); });
        m.appendChild(row);
        if (it.desc) m.appendChild(el('div', 'md', it.desc));
      });
    });
    document.body.appendChild(m);
    var w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 4)) + 'px';
    m.style.top = Math.max(4, Math.min(y, window.innerHeight - h - 4)) + 'px';
    menuEl = m;
  }
  function addMenuGroups(pos) {
    var groups = [];
    PN.catOrder.forEach(function (cat) {
      var items = [];
      Object.keys(PN.defs).forEach(function (type) {
        var d = PN.defs[type];
        if (d.cat !== cat) return;
        items.push({ label: d.title, sub: d.origin || '', fn: function () { var id = addNode(type, pos.x, pos.y); selectOnly(id); commit(); recalc(false); } });
      });
      if (items.length) groups.push({ title: cat, items: items });
    });
    return groups;
  }
  var addCount = 0;
  function centerPos() {
    var r = stage.getBoundingClientRect(), c = toWorld(r.left + r.width / 2, r.top + r.height / 2), k = (addCount++ % 6) * 26;
    return { x: Math.round(c.x - 104 + k), y: Math.round(c.y - 140 + k) };
  }

  /* ============ 그래프 조작 ============ */
  function defOf(id) { var n = S.graph.nodes[id]; return n && PN.defs[n.type]; }
  function newId() { return 'n' + (S.graph.nextId++); }
  function addNode(type, x, y, params) {
    var id = newId(), p = PN.defaultParams(type), k;
    for (k in (params || {})) p[k] = params[k];
    S.graph.nodes[id] = { id: id, type: type, x: Math.round(x), y: Math.round(y), params: p };
    buildNodeEl(S.graph.nodes[id]);
    updateEmpty();
    return id;
  }
  function removeNodes(ids) {
    ids.forEach(function (id) {
      delete S.graph.nodes[id]; delete S.sel[id];
      if (nodeEls[id]) { nodeEls[id].remove(); delete nodeEls[id]; }
    });
    S.graph.edges = S.graph.edges.filter(function (e) { return S.graph.nodes[e.from] && S.graph.nodes[e.to]; });
    if (!S.graph.nodes[S.preview]) S.preview = defaultPreview();
    updateEmpty(); drawWires(); refreshSel();
  }
  function edgeTo(id, port) {
    for (var i = 0; i < S.graph.edges.length; i++) {
      var e = S.graph.edges[i]; if (e.to === id && e.toPort === port) return e;
    }
    return null;
  }
  function removeEdge(e) { var i = S.graph.edges.indexOf(e); if (i >= 0) S.graph.edges.splice(i, 1); }
  function reaches(start, target) {
    var seen = {}, stack = [start];
    while (stack.length) {
      var id = stack.pop();
      if (id === target) return true;
      if (seen[id]) continue; seen[id] = 1;
      S.graph.edges.forEach(function (e) { if (e.from === id) stack.push(e.to); });
    }
    return false;
  }
  function connect(from, fromPort, to, toPort) {
    if (from === to) return false;
    var fd = defOf(from), td = defOf(to);
    if (!fd || !td || !fd.outputs.length) return false;
    if (!td.inputs.some(function (p) { return p.id === toPort; })) return false;
    if (reaches(to, from)) { toast('순환 연결은 만들 수 없어요'); return false; }
    var old = edgeTo(to, toPort); if (old) removeEdge(old);
    S.graph.edges.push({ from: from, fromPort: fromPort || 'out', to: to, toPort: toPort });
    return true;
  }
  function freeInput(id) {
    var d = defOf(id); if (!d || !d.inputs.length) return null;
    for (var i = 0; i < d.inputs.length; i++) if (!edgeTo(id, d.inputs[i].id)) return d.inputs[i].id;
    return d.inputs[0].id;
  }
  function swapInputs(id) {
    var d = defOf(id); if (!d || !d.swap) return;
    var a = d.swap[0], b = d.swap[1], ea = edgeTo(id, a), eb = edgeTo(id, b);
    if (!ea && !eb) return;
    if (ea) ea.toPort = b;
    if (eb) eb.toPort = a;
    commit(); recalc(false); drawWires();
  }
  function defaultPreview() {
    var ids = Object.keys(S.graph.nodes), i;
    for (i = ids.length - 1; i >= 0; i--) if (S.graph.nodes[ids[i]].type === 'output') return ids[i];
    return ids.length ? ids[ids.length - 1] : null;
  }
  function updateEmpty() { $('#empty').hidden = Object.keys(S.graph.nodes).length > 0; }

  /* ============ 노드 DOM ============ */
  function posNode(e, n) { e.style.transform = 'translate(' + n.x + 'px,' + n.y + 'px)'; }
  function decimals(step) { var s = String(step); return s.indexOf('.') < 0 ? 0 : s.split('.')[1].length; }
  function fmt(v, sp) { return Number(v).toFixed(decimals(sp.step)); }

  /* 올린 이미지를 보관용으로 정리: 투명하면 PNG 그대로(원본 바이트 유지), 불투명하면 JPEG. 긴 변 1600px 상한 */
  function readImageFile(file, cb) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var W = img.naturalWidth || 1024, H = img.naturalHeight || 1024, sc = Math.min(1, IMG_MAX / Math.max(W, H));
      var w = Math.max(1, Math.round(W * sc)), h = Math.max(1, Math.round(H * sc));
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      var a = g.getImageData(0, 0, w, h).data, hasAlpha = false, i;
      for (i = 3; i < a.length; i += 4) if (a[i] < 250) { hasAlpha = true; break; }
      var info = { hasAlpha: hasAlpha, resized: sc < 1 };
      var finish = function (u) { c.width = 1; cb(u, file.name, info); };
      var keep = sc === 1 && file.type === 'image/png' && (hasAlpha || file.size < 150000);
      if (keep) {                                   // 다시 압축하지 않고 원본 PNG 바이트를 그대로
        var fr = new FileReader();
        fr.onload = function () { finish(String(fr.result)); };
        fr.onerror = function () { finish(c.toDataURL('image/png')); };
        fr.readAsDataURL(file);
      } else if (hasAlpha) finish(c.toDataURL('image/png'));
      else {
        g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
        finish(c.toDataURL('image/jpeg', 0.92));
      }
    };
    img.onerror = function () { URL.revokeObjectURL(url); toast('이미지를 읽지 못했어요. PNG, JPG, WebP, GIF 파일을 올려 주세요.'); };
    img.src = url;
  }
  function referencedImageIds() {
    var ids = {};
    Object.keys(S.graph.nodes).forEach(function (id) {
      var n = S.graph.nodes[id];
      if (n.type === 'image' && n.params.src && PN.images[n.params.src]) ids[n.params.src] = 1;
    });
    return Object.keys(ids);
  }
  function mb(chars) { return (chars * 0.75 / 1048576).toFixed(1); }
  function setNodeImage(id, file) {
    readImageFile(file, function (url, name, info) {
      var n = S.graph.nodes[id]; if (!n) return;
      n.params.src = PN.addImage(url); n.params.name = name;
      var msg = '';
      if (info.hasAlpha && n.params.kind !== 'module') { n.params.kind = 'module'; msg = '투명 PNG라서 「모듈」로 바꿨어요. '; }
      rebuildParams(n);
      var tot = PN.imageBytes(referencedImageIds());
      if (tot > 8e6) msg += '올린 이미지가 모두 약 ' + mb(tot) + 'MB예요. JSON 저장 파일도 그만큼 커지니, 저장할 때 「이미지 포함」을 끄는 것도 방법이에요.';
      else if (info.resized) msg += '긴 변을 ' + IMG_MAX + 'px로 줄여서 보관했어요.';
      if (msg) toast(msg);
      commit(); recalc(false);
    });
  }

  function mkControl(n, def, sp) {
    if (sp.type === 'hidden') return null;
    var row = el('div', 'prow'), lab = el('span', 'pl', sp.label || ''), v = n.params[sp.key], t = sp.type;
    lab.title = sp.label || ''; row.dataset.k = sp.key;
    if (sp.show && !sp.show(n.params)) row.hidden = true;
    if (t === 'range') {
      var inp = el('input'); inp.type = 'range'; inp.min = sp.min; inp.max = sp.max; inp.step = sp.step; inp.value = v;
      var out = el('span', 'pv', fmt(v, sp));
      inp.addEventListener('input', function () { var nv = parseFloat(inp.value); n.params[sp.key] = nv; out.textContent = fmt(nv, sp); recalc(true); });
      inp.addEventListener('change', function () { commit(); recalc(false); });
      lab.addEventListener('dblclick', function () { inp.value = sp.def; n.params[sp.key] = sp.def; out.textContent = fmt(sp.def, sp); commit(); recalc(false); });
      lab.title = '두 번 클릭하면 기본값';
      row.appendChild(lab); row.appendChild(inp); row.appendChild(out);
    } else if (t === 'select') {
      var sel = el('select');
      sp.options.forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; sel.appendChild(op); });
      sel.value = v;
      sel.addEventListener('change', function () { n.params[sp.key] = sel.value; refreshVis(n); commit(); recalc(false); });
      row.appendChild(lab); row.appendChild(sel);
    } else if (t === 'bool') {
      var cb = el('input'); cb.type = 'checkbox'; cb.checked = !!v;
      cb.addEventListener('change', function () { n.params[sp.key] = cb.checked; refreshVis(n); commit(); recalc(false); });
      row.appendChild(lab); row.appendChild(el('span', 'grow')); row.appendChild(cb);
    } else if (t === 'color') {
      var ci = el('input'); ci.type = 'color'; ci.value = v;
      ci.addEventListener('input', function () { n.params[sp.key] = ci.value; recalc(true); });
      ci.addEventListener('change', function () { commit(); recalc(false); });
      row.appendChild(lab); row.appendChild(el('span', 'grow')); row.appendChild(ci);
    } else if (t === 'colors') {
      var wrap = el('div', 'swatches');
      (v || []).forEach(function (c, i) {
        var cell = el('div', 'sw'), ci2 = el('input'), srcs = sp.srcKey ? (n.params[sp.srcKey] || []) : null;
        ci2.type = 'color'; ci2.value = c; ci2.title = '층 ' + (i + 1) + ' 잉크 색';
        ci2.addEventListener('input', function () { var a = n.params[sp.key].slice(); a[i] = ci2.value; n.params[sp.key] = a; recalc(true); });
        ci2.addEventListener('change', function () { commit(); recalc(false); });
        cell.appendChild(ci2);
        if (srcs) {
          var tg = el('button', 'sws'), paint = function () {
            var m = (n.params[sp.srcKey] || [])[i] === 'mod';
            tg.textContent = m ? '모듈' : '잉크'; tg.classList.toggle('mod', m); ci2.classList.toggle('dim', m);
            tg.title = m ? '이 층은 모듈의 원래 색을 써요 (누르면 잉크 색으로)' : '이 층은 위 색으로 칠해요 (누르면 모듈의 원래 색으로)';
          };
          tg.addEventListener('click', function () {
            var a = (n.params[sp.srcKey] || []).slice(); while (a.length < (v || []).length) a.push('ink');
            a[i] = a[i] === 'mod' ? 'ink' : 'mod'; n.params[sp.srcKey] = a; paint(); commit(); recalc(false);
          });
          paint(); cell.appendChild(tg);
        }
        wrap.appendChild(cell);
      });
      row.appendChild(lab); row.appendChild(wrap);
    } else if (t === 'seed') {
      var ni = el('input'); ni.type = 'number'; ni.value = v; ni.min = 0; ni.max = 99999; ni.style.cssText = 'width:64px;border:0;border-bottom:1px solid #000;background:transparent;height:22px;';
      ni.addEventListener('change', function () { var nv = clamp(parseInt(ni.value, 10) || 0, 0, 99999); ni.value = nv; n.params[sp.key] = nv; commit(); recalc(false); });
      var rb = el('button', 'btn line', '다시'); rb.title = '시드를 바꿔서 다른 변주 만들기';
      rb.addEventListener('click', function () { var nv = Math.floor(Math.random() * 10000); ni.value = nv; n.params[sp.key] = nv; commit(); recalc(false); });
      row.appendChild(lab); row.appendChild(ni); row.appendChild(el('span', 'grow')); row.appendChild(rb);
    } else if (t === 'file') {
      var fi = el('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.hidden = true;
      var fb = el('button', 'btn line fbtn', n.params.src && PN.images[n.params.src] ? '바꾸기' : '올리기');
      var gone = n.params.src && !PN.images[n.params.src];
      var fn = el('span', 'fname', gone ? (n.params.name || '이미지') + ' · 파일 없음 (다시 올려 주세요)' : (n.params.name || '(샘플 이미지)')); fn.title = n.params.name || '';
      fb.addEventListener('click', function () { fi.click(); });
      fi.addEventListener('change', function () { if (fi.files && fi.files[0]) setNodeImage(n.id, fi.files[0]); fi.value = ''; });
      row.appendChild(fb); row.appendChild(fn); row.appendChild(fi);
    } else if (t === 'button') {
      var bb = el('button', 'btn line', sp.label); bb.style.flex = '1';
      bb.addEventListener('click', function () { if (sp.action === 'export') exportPNG(n.id, parseInt(n.params.size, 10) || 2048); });
      row.appendChild(bb);
    } else return null;
    return row;
  }

  function buildParams(n) {
    var def = PN.defs[n.type], pp = el('div', 'np');
    def.params.forEach(function (sp) { var c = mkControl(n, def, sp); if (c) pp.appendChild(c); });
    return pp;
  }
  function rebuildParams(n) {          // 설정이 바깥에서 바뀌었을 때(이미지 올리기 등) 패널을 다시 그려요
    var e = nodeEls[n.id]; if (!e) return;
    var old = e.querySelector('.np'), pp = buildParams(n);
    if (old) old.replaceWith(pp); else if (pp.children.length) e.insertBefore(pp, e.querySelector('.nnote'));
    var fl = e.querySelector('.fbtn'); if (fl) fl.textContent = n.params.src && PN.images[n.params.src] ? '바꾸기' : '올리기';
    drawWires();
  }
  function refreshVis(n) {             // 쓰임(농도/모듈)처럼 다른 설정에 따라 보이는 줄이 달라질 때
    var e = nodeEls[n.id]; if (!e) return;
    PN.defs[n.type].params.forEach(function (sp) {
      if (!sp.show) return;
      var row = e.querySelector('.prow[data-k="' + sp.key + '"]');
      if (row) row.hidden = !sp.show(n.params);
    });
    drawWires();
  }
  function buildNodeEl(n) {
    var def = PN.defs[n.type], e = el('div', 'node');
    e.dataset.id = n.id; e.dataset.type = n.type;
    var h = el('div', 'nh'); h.appendChild(el('span', 'nt', def.title));
    if (def.origin) h.appendChild(el('span', 'no', '· ' + def.origin));
    h.appendChild(el('span', 'sp'));
    if (def.swap) { var sw = el('button', 'nb', '⇄'); sw.title = '입력 두 개 맞바꾸기'; sw.dataset.act = 'swap'; h.appendChild(sw); }
    var x = el('button', 'nb', '×'); x.title = '삭제'; x.dataset.act = 'del'; h.appendChild(x);
    e.appendChild(h);

    var io = el('div', 'nio'), nin = el('div', 'nin');
    def.inputs.forEach(function (p) {
      var r = el('div', 'nin-row'), pt = el('div', 'port in');
      pt.dataset.node = n.id; pt.dataset.port = p.id; pt.dataset.dir = 'in';
      r.appendChild(pt); r.appendChild(el('span', 'pl', p.label)); nin.appendChild(r);
    });
    if (!def.inputs.length && def.hint) nin.appendChild(el('div', 'hint', def.hint));
    io.appendChild(nin);
    var th = el('canvas', 'nth'); th.width = 96; th.height = 96; io.appendChild(th);
    if (def.outputs.length) {
      var po = el('div', 'port out'); po.dataset.node = n.id; po.dataset.port = 'out'; po.dataset.dir = 'out'; io.appendChild(po);
    }
    e.appendChild(io);

    var pp = buildParams(n);
    if (pp.children.length) e.appendChild(pp);
    if (def.note) e.appendChild(el('div', 'nnote', def.note));
    e.appendChild(el('div', 'nerr'));
    posNode(e, n);
    world.appendChild(e);
    nodeEls[n.id] = e;
    return e;
  }

  function renderAll() {
    Object.keys(nodeEls).forEach(function (id) { nodeEls[id].remove(); });
    nodeEls = {};
    Object.keys(S.graph.nodes).forEach(function (id) { buildNodeEl(S.graph.nodes[id]); });
    if (!S.graph.nodes[S.preview]) S.preview = defaultPreview();
    updateEmpty(); refreshSel(); applyView(); drawWires();
  }

  /* ============ 선 ============ */
  function portPos(id, port, dir) {
    var ne = nodeEls[id], n = S.graph.nodes[id];
    if (!ne || !n) return { x: 0, y: 0 };
    var pe = ne.querySelector('.port.' + dir + '[data-port="' + port + '"]');
    if (!pe) return { x: n.x, y: n.y };
    var x = 0, y = 0, e = pe;
    while (e && e !== ne) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
    return { x: n.x + 1 + x + pe.offsetWidth / 2, y: n.y + 1 + y + pe.offsetHeight / 2 };
  }
  function curve(a, b) {
    var dx = Math.max(60, Math.abs(b.x - a.x) * 0.5);
    return 'M' + a.x + ' ' + a.y + ' C' + (a.x + dx) + ' ' + a.y + ' ' + (b.x - dx) + ' ' + b.y + ' ' + b.x + ' ' + b.y;
  }
  function edgeKey(e) { return e.to + ':' + e.toPort; }
  var drawQueued = false;
  function drawWires() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(function () { drawQueued = false; drawWiresNow(); });
  }
  function drawWiresNow() {
    var keep = svg.querySelector('.tmp');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    Object.keys(nodeEls).forEach(function (id) {
      var ports = nodeEls[id].querySelectorAll('.port.on'), i;
      for (i = 0; i < ports.length; i++) ports[i].classList.remove('on');
    });
    S.graph.edges.forEach(function (e) {
      if (!nodeEls[e.from] || !nodeEls[e.to]) return;
      var a = portPos(e.from, e.fromPort || 'out', 'out'), b = portPos(e.to, e.toPort, 'in'), d = curve(a, b);
      var p = document.createElementNS(NS, 'path'); p.setAttribute('d', d);
      p.setAttribute('class', 'wire' + (S.selEdge === edgeKey(e) ? ' sel' : ''));
      var hit = document.createElementNS(NS, 'path'); hit.setAttribute('d', d); hit.setAttribute('class', 'wire-hit'); hit.dataset.key = edgeKey(e);
      svg.appendChild(p); svg.appendChild(hit);
      var po = nodeEls[e.from].querySelector('.port.out'), pi = nodeEls[e.to].querySelector('.port.in[data-port="' + e.toPort + '"]');
      if (po) po.classList.add('on'); if (pi) pi.classList.add('on');
    });
    if (keep) svg.appendChild(keep);
  }

  /* ============ 선택 ============ */
  function refreshSel() {
    Object.keys(nodeEls).forEach(function (id) { nodeEls[id].classList.toggle('sel', !!S.sel[id]); });
    updateViewerHead();
  }
  function selectOnly(id) { S.sel = {}; S.sel[id] = true; S.selEdge = null; setPreview(id); refreshSel(); drawWires(); }
  function clearSel() { S.sel = {}; S.selEdge = null; refreshSel(); drawWires(); }
  function setPreview(id) { S.preview = id; drawViewer(); updateViewerHead(); }

  /* ============ 계산 · 썸네일 · 미리보기 ============ */
  var rq = { pending: false, fast: false, timer: 0 };
  function recalc(fast) {
    rq.fast = !!fast; clearTimeout(rq.timer);
    if (!rq.pending) { rq.pending = true; requestAnimationFrame(function () { rq.pending = false; runNow(rq.fast ? R_FAST : R_FULL); }); }
    if (fast) rq.timer = setTimeout(function () { recalc(false); }, 220);
  }
  function runNow(R) {
    var t0 = performance.now();
    S.last = engine.run(S.graph, R || R_FULL);
    S.lastMs = Math.round(performance.now() - t0);
    drawThumbs(S.last); drawViewer(); drawWires(); updateViewerHead();
    return S.last;
  }
  /* 종이 색·투명 여부는 출력 노드가 정해요 (미리보기하는 노드가 출력이 아니면 첫 출력 노드를 따라요) */
  function outNode(id) {
    var n = S.graph.nodes[id];
    if (n && n.type === 'output') return n;
    var ids = Object.keys(S.graph.nodes), i;
    for (i = 0; i < ids.length; i++) if (S.graph.nodes[ids[i]].type === 'output') return S.graph.nodes[ids[i]];
    return null;
  }
  function viewOpts(id) {
    var o = outNode(id), P = PN.util.hex2rgb(o ? o.params.paper : '#ffffff');
    return { paper: [P[0] * 255, P[1] * 255, P[2] * 255], transparent: !!(o && o.params.transparent) };
  }
  function outField(res, id) { var o = res && res.outs && res.outs[id]; return o ? (o.out || null) : null; }
  function drawThumbs(res) {
    var vo = viewOpts(S.preview);
    Object.keys(S.graph.nodes).forEach(function (id) {
      var e = nodeEls[id]; if (!e) return;
      var cv = e.querySelector('.nth'), g = cv.getContext('2d'), f = outField(res, id);
      g.fillStyle = '#fff'; g.fillRect(0, 0, 96, 96);
      if (f) { g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(PN.fieldScratch(f, { paper: vo.paper }), 0, 0, 96, 96); }
      var er = e.querySelector('.nerr'), msg = res.errors[id] || '';
      er.textContent = msg ? '오류: ' + msg : ''; er.style.display = msg ? 'block' : 'none';
    });
  }
  function drawViewer() {
    var cv = $('#vcanvas'), W = cv.clientWidth, dpr = window.devicePixelRatio || 1;
    if (W < 2) return;
    var pw = Math.round(W * dpr);
    if (cv.width !== pw || cv.height !== pw) { cv.width = pw; cv.height = pw; }
    var g = cv.getContext('2d'), vo = viewOpts(S.preview); g.fillStyle = '#fff'; g.fillRect(0, 0, pw, pw);
    var f = S.preview && outField(S.last, S.preview);
    if (!f) return;
    if (vo.transparent) {                         // 투명 배경은 체크무늬로 보여요
      var q = Math.max(8, Math.round(pw / 32)), qx, qy;
      g.fillStyle = '#e4e4e4';
      for (qy = 0; qy * q < pw; qy++) for (qx = 0; qx * q < pw; qx++) if ((qx + qy) & 1) g.fillRect(qx * q, qy * q, q, q);
    }
    var sc = PN.fieldScratch(f, vo); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    if (S.tile2) { var h = pw / 2, i, j; for (j = 0; j < 2; j++) for (i = 0; i < 2; i++) g.drawImage(sc, i * h, j * h, h, h); }
    else g.drawImage(sc, 0, 0, pw, pw);
  }
  function updateViewerHead() {
    var n = S.preview && S.graph.nodes[S.preview], d = n && PN.defs[n.type];
    $('#vtitle').textContent = d ? '미리보기 · ' + d.title : '미리보기';
    $('#vinfo').textContent = S.last ? (S.last.R + 'px · ' + (S.lastMs || 0) + 'ms') : '';
    $('#v-png').disabled = !n || busy; $('#v-rec').disabled = !n;
    var o = outNode(S.preview), tb = $('#v-trans');
    if (tb) { tb.disabled = !o; tb.checked = !!(o && o.params.transparent); }
    var pl = $('#v-paper'); if (pl) pl.textContent = o ? '종이 ' + o.params.paper + (o.params.transparent ? ' · 투명으로 저장' : '') : '출력 노드를 만들면 종이 색을 정할 수 있어요';
  }

  /* ============ 되돌리기 · 저장 ============ */
  function snap() {
    var es = S.graph.edges.slice().sort(function (a, b) { return (a.to + a.toPort) < (b.to + b.toPort) ? -1 : 1; });
    return JSON.stringify({ nodes: S.graph.nodes, edges: es, nextId: S.graph.nextId });
  }
  function updateUndoBtns() { $('#b-undo').disabled = !S.undo.length; $('#b-redo').disabled = !S.redo.length; }
  function commit() {
    var s = snap();
    if (s !== S.committed) {
      S.undo.push(S.committed); if (S.undo.length > 60) S.undo.shift();
      S.redo.length = 0; S.committed = s;
    }
    updateUndoBtns(); scheduleSave();
  }
  function restore(str) {
    var o = JSON.parse(str);
    S.graph.nodes = o.nodes; S.graph.edges = o.edges; S.graph.nextId = o.nextId;
    S.sel = {}; S.selEdge = null;
    renderAll(); recalc(false); updateUndoBtns(); scheduleSave();
  }
  function undo() { if (!S.undo.length) return; S.redo.push(S.committed); S.committed = S.undo.pop(); restore(S.committed); }
  function redo() { if (!S.redo.length) return; S.undo.push(S.committed); S.committed = S.redo.pop(); restore(S.committed); }

  var saveTimer = 0;
  var warnedSave = false;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      PN.store.save(projectObject()).then(function (ok) {
        if (ok === false && !warnedSave) { warnedSave = true; toast('이 브라우저에는 자동 저장이 안 돼요(이미지가 커요). 「저장 (.json)」으로 파일에 저장해 두세요.'); }
      });
    }, 500);
  }
  function projectObject(noImages) {
    var imgs = {};
    if (!noImages) referencedImageIds().forEach(function (id) { imgs[id] = PN.images[id].url; });
    return { v: 2, nodes: S.graph.nodes, edges: S.graph.edges, nextId: S.graph.nextId, view: S.view, images: imgs, imagesIncluded: !noImages, saved: Date.now() };
  }
  /* 옛 저장본/샘플을 새 규격으로: 겹치기의 종이색은 출력으로 옮기고, 색 칸 수는 새 기본(6층)에 맞춰요 */
  function migrate(nodes) {
    var ids = Object.keys(nodes), paper = null;
    ids.forEach(function (id) {
      var n = nodes[id];
      PN.defs[n.type].params.forEach(function (sp) {
        if (sp.type !== 'colors' || !Array.isArray(n.params[sp.key])) return;
        var a = n.params[sp.key].slice(); while (a.length < sp.def.length) a.push(sp.def[a.length]); n.params[sp.key] = a;
        if (sp.srcKey) { var b = (Array.isArray(n.params[sp.srcKey]) ? n.params[sp.srcKey] : []).slice(); while (b.length < sp.def.length) b.push('ink'); n.params[sp.srcKey] = b; }
      });
      if (n.type === 'stack' && n.params.paper !== undefined) {
        if (/^#[0-9a-f]{6}$/i.test(n.params.paper) && n.params.paper.toLowerCase() !== '#ffffff' && !paper) paper = n.params.paper;
        delete n.params.paper;
      }
    });
    if (paper) ids.forEach(function (id) { if (nodes[id].type === 'output' && nodes[id].params.paper.toLowerCase() === '#ffffff') nodes[id].params.paper = paper; });
  }
  /* 저장된/불러온/샘플 프로젝트를 화면에 적용 (모르는 노드는 버리고, 빠진 설정값은 기본값으로 채워요) */
  function applyProject(p, undoable) {
    if (!p || typeof p.nodes !== 'object') throw new Error('프로젝트 형식이 아니에요');
    Object.keys(p.images || {}).forEach(function (id) { if (!PN.images[id]) PN.images[id] = { url: p.images[id], canvas: null, loading: false }; });
    var nodes = {}, max = 0;
    Object.keys(p.nodes).forEach(function (id) {
      var n = p.nodes[id]; if (!n || !PN.defs[n.type]) return;
      var params = PN.defaultParams(n.type), k;
      for (k in (n.params || {})) params[k] = n.params[k];
      nodes[id] = { id: id, type: n.type, x: +n.x || 0, y: +n.y || 0, params: params };
      var num = parseInt(String(id).replace(/\D/g, ''), 10); if (num > max) max = num;
    });
    migrate(nodes);
    var edges = (p.edges || []).filter(function (e) {
      return nodes[e.from] && nodes[e.to] && PN.defs[nodes[e.to].type].inputs.some(function (q) { return q.id === e.toPort; });
    }).map(function (e) { return { from: e.from, fromPort: e.fromPort || 'out', to: e.to, toPort: e.toPort }; });
    if (undoable) { S.undo.push(S.committed); if (S.undo.length > 60) S.undo.shift(); S.redo.length = 0; }
    else { S.undo = []; S.redo = []; }
    S.graph.nodes = nodes; S.graph.edges = edges; S.graph.nextId = Math.max(p.nextId || 1, max + 1);
    S.sel = {}; S.selEdge = null; S.preview = null;
    renderAll();
    S.committed = snap();
    updateUndoBtns();
  }
  function loadSample(i) {
    var s = PN.samples[i]; if (!s) return;
    applyProject(s.build(), true);
    S.preview = defaultPreview();
    fitView(); recalc(false); scheduleSave();
    toast('샘플 「' + s.name + '」을 불러왔어요 · 되돌리기로 이전 작업으로 돌아갈 수 있어요');
  }

  /* ============ 내보내기 · 기록 ============ */
  function stamp() { var d = new Date(), p = function (v) { return (v < 10 ? '0' : '') + v; }; return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); }
  function setBusy(b) { busy = b; $('#v-png').disabled = b || !S.preview; }
  function exportPNG(id, size) {
    if (busy || !S.graph.nodes[id]) return;
    var vo = viewOpts(id);
    setBusy(true); toast('계산하는 중… ' + size + 'px' + (size >= 4096 ? ' (오래 걸리고 메모리를 많이 써요. 멈추면 2048px로 낮춰 보세요)' : ''));
    setTimeout(function () {
      var done = function () { setBusy(false); updateViewerHead(); };
      try {
        var f = engine.exportField(S.graph, id, size), cv = PN.fieldToCanvas(f, vo);
        cv.toBlob(function (b) {
          if (!b) { toast('PNG를 만들지 못했어요. 해상도를 낮춰 보세요.'); cv.width = 1; done(); return; }
          PN.store.download(b, 'pattern-' + S.graph.nodes[id].type + '-' + size + (vo.transparent ? '-clear' : '') + '-' + stamp() + '.png');
          toast('PNG를 저장했어요 (' + size + '×' + size + (vo.transparent ? ', 배경 투명' : '') + ')'); cv.width = 1; done();
        }, 'image/png');
      } catch (err) {
        toast('저장하지 못했어요: ' + (err && err.message ? err.message : err) + ' · 해상도를 낮춰 보세요.'); done();
      }
    }, 40);
  }
  function valueLabel(sp, v) {
    if (sp.type === 'select') { for (var i = 0; i < sp.options.length; i++) if (sp.options[i][0] === v) return sp.options[i][1]; return String(v); }
    if (sp.type === 'bool') return v ? '켜짐' : '꺼짐';
    if (sp.type === 'colors') return (v || []).join(', ');
    if (sp.type === 'range') return fmt(v, sp);
    return String(v);
  }
  function buildRecord(targetId) {
    var inc = {}, order = [], seen = {};
    S.graph.edges.forEach(function (e) { (inc[e.to] = inc[e.to] || {})[e.toPort] = e; });
    function dfs(id) {
      if (seen[id] || !S.graph.nodes[id]) return; seen[id] = 1;
      PN.defs[S.graph.nodes[id].type].inputs.forEach(function (p) { var e = inc[id] && inc[id][p.id]; if (e) dfs(e.from); });
      order.push(id);
    }
    dfs(targetId);
    var num = {}; order.forEach(function (id, i) { num[id] = i + 1; });
    var L = ['Pattern Nodes — 방법론 기록', '만든 날: ' + new Date().toLocaleString('ko-KR'), '결과: ' + num[targetId] + '번 ' + PN.defs[S.graph.nodes[targetId].type].title, ''];
    order.forEach(function (id) {
      var n = S.graph.nodes[id], d = PN.defs[n.type];
      L.push(num[id] + '. ' + d.title + (d.origin ? ' (' + d.origin + ')' : ''));
      d.inputs.forEach(function (p) {
        var e = inc[id] && inc[id][p.id];
        L.push('   ' + p.label + ' ← ' + (e ? num[e.from] + '번 ' + PN.defs[S.graph.nodes[e.from].type].title : '비어 있음'));
      });
      d.params.forEach(function (sp) {
        if (sp.type === 'button' || sp.type === 'hidden' || sp.type === 'file') return;
        if (sp.show && !sp.show(n.params)) return;
        if (sp.type === 'colors' && sp.srcKey) {
          L.push('   ' + sp.label + ': ' + (n.params[sp.key] || []).map(function (c, i) { return (n.params[sp.srcKey] || [])[i] === 'mod' ? '모듈 색' : c; }).join(', '));
          return;
        }
        L.push('   ' + sp.label + ': ' + valueLabel(sp, n.params[sp.key]));
      });
      if (n.type === 'image') L.push('   이미지: ' + (n.params.name || '샘플 이미지'));
      L.push('');
    });
    return L.join('\n');
  }

  /* ============ 포인터 상호작용 ============ */
  function track(e, onMove, onUp) {
    try { stage.setPointerCapture(e.pointerId); } catch (x) { /* 무시 */ }
    function mv(ev) { onMove(ev); }
    function up(ev) {
      stage.removeEventListener('pointermove', mv); stage.removeEventListener('pointerup', up); stage.removeEventListener('pointercancel', up);
      try { stage.releasePointerCapture(e.pointerId); } catch (x) { /* 무시 */ }
      onUp(ev);
    }
    stage.addEventListener('pointermove', mv); stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  }

  function startPan(e) {
    var sx = e.clientX, sy = e.clientY, vx = S.view.x, vy = S.view.y, moved = false;
    stage.classList.add('panning');
    track(e, function (ev) {
      var dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      S.view.x = vx + dx; S.view.y = vy + dy; applyView();
    }, function () { stage.classList.remove('panning'); if (!moved) clearSel(); scheduleSave(); });
  }

  function startMarquee(e) {
    var r = stage.getBoundingClientRect(), x0 = e.clientX - r.left, y0 = e.clientY - r.top, base = e.ctrlKey || e.metaKey ? Object.assign({}, S.sel) : {};
    marq.hidden = false;
    function box(ev) { var x1 = ev.clientX - r.left, y1 = ev.clientY - r.top; return { l: Math.min(x0, x1), t: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }; }
    track(e, function (ev) { var b = box(ev); marq.style.left = b.l + 'px'; marq.style.top = b.t + 'px'; marq.style.width = b.w + 'px'; marq.style.height = b.h + 'px'; }, function (ev) {
      marq.hidden = true;
      var b = box(ev), s = S.view.s, wl = (b.l - S.view.x) / s, wt = (b.t - S.view.y) / s, wr = wl + b.w / s, wb = wt + b.h / s;
      S.sel = base;
      Object.keys(S.graph.nodes).forEach(function (id) {
        var n = S.graph.nodes[id], h = nodeEls[id] ? nodeEls[id].offsetHeight : 200;
        if (n.x < wr && n.x + 208 > wl && n.y < wb && n.y + h > wt) S.sel[id] = true;
      });
      refreshSel();
    });
  }

  function startNodeDrag(e, nodeEl) {
    var id = nodeEl.dataset.id;
    if (!S.sel[id]) { if (!e.shiftKey) S.sel = {}; S.sel[id] = true; }
    else if (e.shiftKey) delete S.sel[id];
    S.selEdge = null; setPreview(id); refreshSel(); drawWires();
    var ids = Object.keys(S.sel).filter(function (i) { return S.graph.nodes[i]; });
    var start = ids.map(function (i) { return { id: i, x: S.graph.nodes[i].x, y: S.graph.nodes[i].y }; });
    var sx = e.clientX, sy = e.clientY, moved = false;
    track(e, function (ev) {
      var dx = (ev.clientX - sx) / S.view.s, dy = (ev.clientY - sy) / S.view.s;
      if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 3) return;
      moved = true;
      start.forEach(function (o) { var n = S.graph.nodes[o.id]; n.x = Math.round(o.x + dx); n.y = Math.round(o.y + dy); posNode(nodeEls[o.id], n); });
      drawWires();
    }, function () { if (moved) commit(); });
  }

  function startWire(e, portEl) {
    e.preventDefault();
    var dir = portEl.dataset.dir, nid = portEl.dataset.node, pid = portEl.dataset.port, from, grabbed = null;
    if (dir === 'in') {
      var ed = edgeTo(nid, pid);
      if (ed) { grabbed = ed; removeEdge(ed); from = { node: ed.from, port: ed.fromPort || 'out', dir: 'out' }; }
      else from = { node: nid, port: pid, dir: 'in' };
    } else from = { node: nid, port: pid, dir: 'out' };
    drawWiresNow();
    var tmp = document.createElementNS(NS, 'path'); tmp.setAttribute('class', 'wire tmp'); svg.appendChild(tmp);
    var cur = toWorld(e.clientX, e.clientY), hot = null;
    function drawTmp() {
      var a = portPos(from.node, from.port, from.dir);
      tmp.setAttribute('d', from.dir === 'out' ? curve(a, cur) : curve(cur, a));
    }
    drawTmp();
    track(e, function (ev) {
      cur = toWorld(ev.clientX, ev.clientY); drawTmp();
      var t = document.elementFromPoint(ev.clientX, ev.clientY), pe = t && t.closest && t.closest('.port');
      if (hot) { hot.classList.remove('hot'); hot = null; }
      if (pe && pe.dataset.dir !== from.dir) { hot = pe; pe.classList.add('hot'); }
    }, function (ev) {
      if (hot) hot.classList.remove('hot');
      tmp.remove();
      var t = document.elementFromPoint(ev.clientX, ev.clientY), pe = t && t.closest && t.closest('.port'), ne = t && t.closest && t.closest('.node'), ok = false, id2;
      if (from.dir === 'out') {
        var tn, tp;
        if (pe && pe.dataset.dir === 'in') { tn = pe.dataset.node; tp = pe.dataset.port; }
        else if (ne) { tn = ne.dataset.id; tp = freeInput(tn); }
        if (tn && tp) ok = connect(from.node, from.port, tn, tp);
      } else {
        var fn;
        if (pe && pe.dataset.dir === 'out') fn = pe.dataset.node;
        else if (ne && defOf(ne.dataset.id) && defOf(ne.dataset.id).outputs.length) fn = ne.dataset.id;
        if (fn) ok = connect(fn, 'out', from.node, from.port);
      }
      if (grabbed || ok) { commit(); recalc(false); }
      drawWires();
    });
  }

  function onStageDown(e) {
    closeMenu();
    if (e.button === 2) return;
    var t = e.target;
    var port = t.closest && t.closest('.port');
    if (port) return startWire(e, port);
    if (e.button === 1) { e.preventDefault(); return startPan(e); }
    var nodeEl = t.closest && t.closest('.node');
    if (nodeEl) {
      if (t.closest('.nb')) return;
      var hdr = t.closest('.nh');
      if (hdr) { e.preventDefault(); return startNodeDrag(e, nodeEl); }
      var id = nodeEl.dataset.id;
      if (!S.sel[id] || !e.shiftKey) { if (!e.shiftKey) S.sel = {}; S.sel[id] = true; } else delete S.sel[id];
      S.selEdge = null; setPreview(id); refreshSel(); drawWires();
      return;
    }
    var hit = t.closest && t.closest('.wire-hit');
    if (hit) { S.selEdge = hit.dataset.key; S.sel = {}; refreshSel(); drawWires(); return; }
    if (e.shiftKey || e.ctrlKey || e.metaKey) return startMarquee(e);
    startPan(e);
  }

  function deleteSelection() {
    if (S.selEdge) {
      var found = S.graph.edges.filter(function (e) { return edgeKey(e) === S.selEdge; })[0];
      if (found) removeEdge(found);
      S.selEdge = null; commit(); recalc(false); drawWires(); return;
    }
    var ids = Object.keys(S.sel);
    if (!ids.length) return;
    removeNodes(ids); commit(); recalc(false);
  }
  function duplicateSelection() {
    var ids = Object.keys(S.sel).filter(function (i) { return S.graph.nodes[i]; });
    if (!ids.length) return;
    var map = {}, ne = {};
    ids.forEach(function (id) {
      var n = S.graph.nodes[id], nid = addNode(n.type, n.x + 36, n.y + 36, JSON.parse(JSON.stringify(n.params)));
      map[id] = nid; ne[nid] = true;
    });
    S.graph.edges.slice().forEach(function (e) {
      if (map[e.from] && map[e.to]) S.graph.edges.push({ from: map[e.from], fromPort: e.fromPort, to: map[e.to], toPort: e.toPort });
    });
    S.sel = ne; S.selEdge = null; refreshSel(); drawWires(); commit(); recalc(false);
  }

  /* ============ 초기화 ============ */
  function start() {
    stage = $('#stage'); world = $('#world'); svg = $('#wires'); marq = $('#marq');
    PN.onImageReady = function () { recalc(false); };

    stage.addEventListener('pointerdown', onStageDown);
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 1) * (e.ctrlKey ? 0.01 : 0.0015));
      zoomAt(e.clientX, e.clientY, k);
    }, { passive: false });
    stage.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      if (e.target.closest('.node')) return;
      var pos = toWorld(e.clientX, e.clientY); showMenu(e.clientX, e.clientY, addMenuGroups({ x: pos.x - 20, y: pos.y - 14 }));
    });
    stage.addEventListener('dblclick', function (e) {
      var t = e.target;
      if (t.closest && t.closest('.wire-hit')) {
        var key = t.closest('.wire-hit').dataset.key, f = S.graph.edges.filter(function (x) { return edgeKey(x) === key; })[0];
        if (f) { removeEdge(f); S.selEdge = null; commit(); recalc(false); drawWires(); }
        return;
      }
      if (t === stage || t === world || t.id === 'wires' || t.id === 'empty') {
        var pos = toWorld(e.clientX, e.clientY); showMenu(e.clientX, e.clientY, addMenuGroups({ x: pos.x - 20, y: pos.y - 14 }));
      }
    });
    world.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.nb'); if (!b) return;
      var id = b.closest('.node').dataset.id;
      if (b.dataset.act === 'del') { removeNodes([id]); commit(); recalc(false); }
      else if (b.dataset.act === 'swap') swapInputs(id);
    });
    document.addEventListener('pointerdown', function (e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);

    /* 이미지 끌어다 놓기: 이미지 노드 위면 교체, 빈 곳이면 새 이미지 노드 */
    stage.addEventListener('dragover', function (e) { e.preventDefault(); });
    stage.addEventListener('drop', function (e) {
      e.preventDefault();
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      if (!/^image\//.test(f.type)) { toast('이미지 파일만 올릴 수 있어요'); return; }
      var ne = e.target.closest && e.target.closest('.node');
      if (ne && ne.dataset.type === 'image') { setNodeImage(ne.dataset.id, f); return; }
      var pos = toWorld(e.clientX, e.clientY), id = addNode('image', pos.x - 104, pos.y - 20);
      selectOnly(id); setNodeImage(id, f);
    });

    document.addEventListener('keydown', function (e) {
      var tg = e.target, typing = tg && (tg.tagName === 'INPUT' && tg.type !== 'range' && tg.type !== 'checkbox' || tg.tagName === 'TEXTAREA');
      var mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) { if (typing) return; e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && (e.key === 'y' || e.key === 'Y')) { if (typing) return; e.preventDefault(); redo(); return; }
      if (typing || tg.tagName === 'SELECT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); }
      else if (mod && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); duplicateSelection(); }
      else if (e.key === 'Escape') { closeMenu(); clearSel(); }
      else if (e.key === 'Home' || e.key === 'f' || e.key === 'F') { if (!mod) fitView(); }
    });

    /* 위쪽 버튼 */
    $('#b-add').addEventListener('click', function (e) {
      var r = e.currentTarget.getBoundingClientRect(); showMenu(r.left, r.bottom + 2, addMenuGroups(centerPos()));
    });
    $('#b-sample').addEventListener('click', function (e) {
      var r = e.currentTarget.getBoundingClientRect();
      showMenu(r.left, r.bottom + 2, [{ title: '샘플 (현재 작업은 되돌리기로 복구할 수 있어요)', items: PN.samples.map(function (s, i) { return { label: s.name, desc: s.desc, fn: function () { loadSample(i); } }; }) }]);
    });
    $('#b-undo').addEventListener('click', undo);
    $('#b-redo').addEventListener('click', redo);
    $('#b-fit').addEventListener('click', fitView);
    $('#b-clear').addEventListener('click', function () {
      if (!Object.keys(S.graph.nodes).length) return;
      applyProject({ nodes: {}, edges: [], nextId: 1 }, true); recalc(false); scheduleSave();
      toast('모두 비웠어요 · 되돌리기(Ctrl/Cmd+Z)로 복구할 수 있어요');
    });
    $('#b-save').addEventListener('click', function () {
      var withImg = $('#b-saveimg').checked, obj = projectObject(!withImg), txt = JSON.stringify(obj);
      PN.store.download(new Blob([txt], { type: 'application/json' }), 'pattern-nodes-' + stamp() + (withImg ? '' : '-noimg') + '.json');
      toast(withImg ? 'JSON으로 저장했어요 (약 ' + (txt.length / 1048576).toFixed(1) + 'MB, 이미지 포함)' : 'JSON으로 저장했어요 (이미지 제외, 약 ' + Math.max(1, Math.round(txt.length / 1024)) + 'KB). 열면 이미지는 다시 올려야 해요.');
    });
    $('#b-load').addEventListener('click', function () { $('#f-load').click(); });
    $('#f-load').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      PN.store.readText(f).then(function (txt) {
        var proj = JSON.parse(txt);
        applyProject(proj, true);
        if (proj.view && isFinite(proj.view.s)) { S.view = proj.view; applyView(); } else fitView();
        recalc(false); scheduleSave();
        var miss = Object.keys(S.graph.nodes).filter(function (k) { var q = S.graph.nodes[k]; return q.type === 'image' && q.params.src && !PN.images[q.params.src]; }).length;
        toast('불러왔어요: ' + f.name + (miss ? ' · 이미지 ' + miss + '개가 빠져 있어요. 이미지 노드에서 다시 올려 주세요.' : ''));
      }).catch(function (err) { toast('불러오지 못했어요: ' + (err && err.message ? err.message : err)); });
      e.target.value = '';
    });

    /* 미리보기 패널 */
    $('#v-trans').addEventListener('change', function (e) {
      var o = outNode(S.preview); if (!o) return;
      o.params.transparent = e.target.checked; rebuildParams(o); commit(); recalc(false);
    });
    $('#v-tile').addEventListener('change', function (e) { S.tile2 = e.target.checked; drawViewer(); });
    $('#v-png').addEventListener('click', function () { if (S.preview) exportPNG(S.preview, parseInt($('#v-size').value, 10)); });
    $('#v-rec').addEventListener('click', function () {
      if (!S.preview) return;
      PN.store.download(new Blob([buildRecord(S.preview)], { type: 'text/plain;charset=utf-8' }), 'pattern-record-' + stamp() + '.txt');
      toast('방법론 기록을 저장했어요');
    });
    window.addEventListener('resize', function () { drawViewer(); drawWires(); });
    if (window.ResizeObserver) new ResizeObserver(function () { drawViewer(); }).observe($('#viewer'));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { drawWires(); });

    updateUndoBtns();
    PN.store.load().then(function (p) {
      var ok = false;
      if (p && p.nodes) {
        try { applyProject(p, false); if (p.view) { S.view = p.view; applyView(); } else fitView(); ok = true; } catch (e) { ok = false; }
      }
      if (!ok) { applyProject(PN.samples[0].build(), false); S.preview = defaultPreview(); fitView(); }
      recalc(false);
    });
  }

  PN.app = {
    S: S, engine: engine, addNode: addNode, connect: connect, runNow: runNow, recalc: recalc, snap: snap, commit: commit,
    undo: undo, redo: redo, fitView: fitView, exportPNG: exportPNG, buildRecord: buildRecord, loadSample: loadSample,
    applyProject: applyProject, projectObject: projectObject, drawWiresNow: drawWiresNow, swapInputs: swapInputs, setPreview: setPreview,
    setNodeImage: setNodeImage, viewOpts: viewOpts, outNode: outNode, rebuildParams: rebuildParams, nodeEls: function () { return nodeEls; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
