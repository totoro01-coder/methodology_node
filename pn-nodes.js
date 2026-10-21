/* Pattern Nodes — pn-nodes.js
   노드 정의. 노드 하나 = 포트(입력/출력) + 설정값 + 계산 함수 하나.
   새 노드는 reg('이름', {...}) 하나만 추가하면 메뉴와 화면에 자동으로 나타나요.
   약속: d = 불투명도/잉크 농도(0 = 비어 있음, 1 = 가득). c = 모듈의 색(없으면 검정 잉크).
   종이는 여기서 깔지 않고 '출력'(미리보기·PNG)에서 한 번만 깔아요. 입력 배열은 절대 수정하지 않아요. */
(function () {
  'use strict';
  var PN = window.PN;
  (PN.builds = PN.builds || {}).nodes = '20261021b';
  var U = PN.util, smooth = U.smooth, mkField = U.mkField, hash2 = U.hash2, hex2rgb = U.hex2rgb;

  function reg(type, def) {
    def.inputs = def.inputs || [];
    def.outputs = def.outputs === undefined ? ['out'] : def.outputs;
    def.params = def.params || [];
    PN.defs[type] = def;
  }
  PN.defaultParams = function (type) {
    var p = {};
    PN.defs[type].params.forEach(function (s) {
      if (s.type === 'button') return;
      if (s.def !== undefined) p[s.key] = Array.isArray(s.def) ? s.def.slice() : s.def;
    });
    return p;
  };
  PN.catOrder = ['소스', '규칙', '합치기', '끝'];

  /* ======================= 소스 ======================= */

  /* ---- 이미지 ---- */
  var scratchImg = {};
  function imgScratch(R) {
    var c = scratchImg[R];
    if (!c) { c = scratchImg[R] = document.createElement('canvas'); c.width = c.height = R; }
    return c;
  }
  function drawFit(g, cv, x, y, w, h, mode) {
    var sw = cv.width, sh = cv.height, s, dw, dh, cw, ch;
    if (mode === 'contain') {
      s = Math.min(w / sw, h / sh); dw = sw * s; dh = sh * s;
      g.drawImage(cv, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    } else {
      s = Math.max(w / sw, h / sh); cw = w / s; ch = h / s;
      g.drawImage(cv, (sw - cw) / 2, (sh - ch) / 2, cw, ch, x, y, w, h);
    }
  }
  function imageToDensity(cv, R, fit) {
    var c = imgScratch(R), g = c.getContext('2d', { willReadFrequently: true });
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#fff'; g.fillRect(0, 0, R, R);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    if (fit === 'mirror') {         // 거울 이음: 4방향으로 뒤집어 붙여서 가장자리가 이어지게
      var h = R / 2;
      drawFit(g, cv, 0, 0, h, h, 'cover');
      g.save(); g.translate(R, 0); g.scale(-1, 1); drawFit(g, cv, 0, 0, h, h, 'cover'); g.restore();
      g.save(); g.translate(0, R); g.scale(1, -1); drawFit(g, cv, 0, 0, h, h, 'cover'); g.restore();
      g.save(); g.translate(R, R); g.scale(-1, -1); drawFit(g, cv, 0, 0, h, h, 'cover'); g.restore();
    } else drawFit(g, cv, 0, 0, R, R, fit);
    var px = g.getImageData(0, 0, R, R).data, d = new Float32Array(R * R), i, o;
    for (i = 0; i < R * R; i++) {
      o = i * 4;
      d[i] = 1 - (0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) / 255;
    }
    if (R > 1024) { c.width = c.height = 1; delete scratchImg[R]; }
    return d;
  }

  /* 모듈: 투명 PNG의 모양·색을 그대로 가져와요 (농도로 바꾸지 않아요) */
  function imageToModule(id, cv, R, p) {
    var c = imgScratch(R), g = c.getContext('2d', { willReadFrequently: true });
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, R, R);
    var sx = 0, sy = 0, sw = cv.width, sh = cv.height;
    if (p.trim) { var bb = PN.imageBBox(id, 'alpha'); if (bb) { sx = bb.x; sy = bb.y; sw = bb.w; sh = bb.h; } }
    var box = R * (1 - 2 * p.pad), sc = Math.min(box / sw, box / sh), dw = sw * sc, dh = sh * sc;
    g.imageSmoothingEnabled = !p.pixel; g.imageSmoothingQuality = 'high';
    g.drawImage(cv, sx, sy, sw, sh, (R - dw) / 2, (R - dh) / 2, dw, dh);
    var px = g.getImageData(0, 0, R, R).data, N = R * R, d = new Float32Array(N), col = new Uint8ClampedArray(N * 4), i, o;
    for (i = 0; i < N; i++) {
      o = i * 4; d[i] = px[o + 3] / 255;
      col[o] = px[o]; col[o + 1] = px[o + 1]; col[o + 2] = px[o + 2]; col[o + 3] = 255;
    }
    if (R > 1024) { c.width = c.height = 1; delete scratchImg[R]; }
    return mkField(R, d, col);
  }

  reg('image', {
    title: '이미지', origin: '', cat: '소스',
    hint: '내 이미지를 올려요 (화면에 끌어다 놓아도 돼요)',
    note: '농도: 어두운 곳이 잉크가 많은 곳이에요. 모듈: 투명 PNG의 모양과 원래 색을 그대로 써요(여기엔 종이가 없어요).',
    params: [
      { key: 'src', type: 'file', label: '이미지', def: null },
      { key: 'name', type: 'hidden', def: '' },
      { key: 'kind', type: 'select', label: '쓰임', def: 'tone', options: [['tone', '농도 (명암)'], ['module', '모듈 (색·투명)']] },
      { key: 'fit', type: 'select', label: '맞춤', def: 'cover', options: [['cover', '채우기'], ['contain', '맞추기'], ['mirror', '거울 이음']], show: function (p) { return p.kind !== 'module'; } },
      { key: 'contrast', type: 'range', label: '대비', min: 0.3, max: 3, step: 0.01, def: 1, show: function (p) { return p.kind !== 'module'; } },
      { key: 'bright', type: 'range', label: '밝기', min: -0.5, max: 0.5, step: 0.01, def: 0, show: function (p) { return p.kind !== 'module'; } },
      { key: 'invert', type: 'bool', label: '반전', def: false, show: function (p) { return p.kind !== 'module'; } },
      { key: 'trim', type: 'bool', label: '여백 자르기', def: true, show: function (p) { return p.kind === 'module'; } },
      { key: 'pad', type: 'range', label: '안쪽 여백', min: 0, max: 0.4, step: 0.005, def: 0, show: function (p) { return p.kind === 'module'; } },
      { key: 'pixel', type: 'bool', label: '픽셀 유지', def: false, show: function (p) { return p.kind === 'module'; } }
    ],
    sigExtra: function (p) { return PN.imageReady(p.src) ? '1' : '0'; },
    compute: function (ins, p, ctx) {
      var R = ctx.R, N = R * R, cv = PN.imageCanvas(p.src), d, i, v;
      if (p.kind === 'module') return cv ? imageToModule(p.src, cv, R, p) : mkField(R, U.demoField(R));
      d = cv ? imageToDensity(cv, R, p.fit) : U.demoField(R);
      var k = p.contrast, b = p.bright, inv = p.invert;
      if (k !== 1 || b !== 0 || inv) {
        for (i = 0; i < N; i++) {
          v = (d[i] - 0.5) * k + 0.5 + b;
          v = v < 0 ? 0 : v > 1 ? 1 : v;
          d[i] = inv ? 1 - v : v;
        }
      }
      return mkField(R, d);
    }
  });

  /* ---- 노이즈 ---- */
  reg('noise', {
    title: '노이즈', origin: '', cat: '소스',
    hint: '이음새 없는 부드러운 얼룩',
    note: '굴곡 노드에 꽂으면 지문 같은 무늬가 나와요.',
    params: [
      { key: 'scale', type: 'range', label: '격자 수', min: 1, max: 24, step: 1, def: 3 },
      { key: 'octaves', type: 'range', label: '겹', min: 1, max: 5, step: 1, def: 2 },
      { key: 'rough', type: 'range', label: '거칠기', min: 0.2, max: 0.8, step: 0.01, def: 0.5 },
      { key: 'contrast', type: 'range', label: '대비', min: 0.5, max: 5, step: 0.05, def: 2 },
      { key: 'seed', type: 'seed', label: '시드', def: 4 }
    ],
    compute: function (ins, p, ctx) {
      var R = ctx.R, N = R * R, d = new Float32Array(N);
      var cells = Math.max(1, p.scale | 0), oct = Math.max(1, p.octaves | 0), per = p.rough, seed = p.seed | 0;
      var amp = 1, tot = 0, o, x, y, i, j;
      var ix0 = new Int32Array(R), ix1 = new Int32Array(R), ux = new Float32Array(R);
      for (o = 0; o < oct; o++) {
        var L = cells << o, lat = new Float32Array(L * L);
        for (j = 0; j < L; j++) for (i = 0; i < L; i++) lat[j * L + i] = hash2(i, j, seed * 7919 + o * 104729);
        for (x = 0; x < R; x++) {
          var fx = (x + 0.5) / R * L, ix = Math.floor(fx), t = fx - ix;
          ix0[x] = ix % L; ix1[x] = (ix + 1) % L; ux[x] = t * t * t * (t * (t * 6 - 15) + 10);
        }
        for (y = 0; y < R; y++) {
          var fy = (y + 0.5) / R * L, iy = Math.floor(fy), ty = fy - iy;
          var uy = ty * ty * ty * (ty * (ty * 6 - 15) + 10), r0 = (iy % L) * L, r1 = ((iy + 1) % L) * L, row = y * R;
          for (x = 0; x < R; x++) {
            var a = lat[r0 + ix0[x]], b = lat[r0 + ix1[x]], c2 = lat[r1 + ix0[x]], e = lat[r1 + ix1[x]], u = ux[x];
            var top = a + (b - a) * u, bot = c2 + (e - c2) * u;
            d[row + x] += amp * (top + (bot - top) * uy);
          }
        }
        tot += amp; amp *= per;
      }
      var k = p.contrast, v;
      for (i = 0; i < N; i++) {
        v = (d[i] / tot - 0.5) * k + 0.5;
        d[i] = v < 0 ? 0 : v > 1 ? 1 : v;
      }
      return mkField(R, d);
    }
  });

  /* ---- 격자 ---- */
  reg('grid', {
    title: '격자', origin: '', cat: '소스',
    hint: '점·선·체크 같은 규칙적인 무늬',
    note: '가로·세로 수가 정수라서 이음새 없이 반복돼요. 선은 한쪽을 0으로 두면 가로선/세로선이 돼요.',
    params: [
      { key: 'kind', type: 'select', label: '종류', def: 'dots', options: [['dots', '점'], ['lines', '선'], ['check', '체크'], ['diamond', '마름모']] },
      { key: 'nx', type: 'range', label: '가로 수', min: 0, max: 48, step: 1, def: 16 },
      { key: 'ny', type: 'range', label: '세로 수', min: 0, max: 48, step: 1, def: 16 },
      { key: 'size', type: 'range', label: '크기', min: 0.05, max: 0.98, step: 0.01, def: 0.6 },
      { key: 'soft', type: 'range', label: '부드럽게', min: 0, max: 0.5, step: 0.01, def: 0 },
      { key: 'phase', type: 'range', label: '위상', min: 0, max: 1, step: 0.01, def: 0 }
    ],
    compute: function (ins, p, ctx) {
      var R = ctx.R, N = R * R, d = new Float32Array(N), kind = p.kind, nx = p.nx | 0, ny = p.ny | 0;
      var size = p.size, soft = p.soft * 0.5, off = p.phase, x, y, i = 0, TAU = Math.PI * 2;
      if (kind !== 'lines') { if (nx < 1) nx = 1; if (ny < 1) ny = 1; }
      else if (nx === 0 && ny === 0) nx = 1;
      var cw = 1 / (nx || 1), ch = 1 / (ny || 1), half = 0.5 * Math.min(cw, ch);
      var aaLine = (Math.abs(nx) + Math.abs(ny)) * 2 / R * 0.7;
      var aaCell = (1 / R) / half * 0.7;
      for (y = 0; y < R; y++) {
        var fy0 = (y + 0.5) / R;
        for (x = 0; x < R; x++, i++) {
          var fx0 = (x + 0.5) / R, v, s;
          if (kind === 'lines') {
            var ph = nx * fx0 + ny * fy0 + off; ph -= Math.floor(ph);
            var dist = Math.abs(ph - 0.5) * 2; s = soft + aaLine;
            v = 1 - smooth(size - s, size + s, dist);
          } else if (kind === 'check') {
            var q = Math.sin(TAU * (nx * fx0 + off)) * Math.sin(TAU * (ny * fy0 + off));
            s = soft + 0.03; v = smooth(-s, s, q);
          } else {
            var ax = nx * fx0 + off, ay = ny * fy0 + off;
            ax -= Math.floor(ax); ay -= Math.floor(ay);
            var ex = (ax - 0.5) * cw, ey = (ay - 0.5) * ch, dd;
            if (kind === 'dots') dd = Math.sqrt(ex * ex + ey * ey) / half;
            else dd = (Math.abs(ex) + Math.abs(ey)) / half;
            s = soft + aaCell;
            v = 1 - smooth(size - s, size + s, dd);
          }
          d[i] = v;
        }
      }
      return mkField(R, d);
    }
  });

  /* ======================= 규칙 ======================= */

  /* ---- 구멍 (스텐실) ---- */
  reg('hole', {
    title: '구멍', origin: '스텐실', cat: '규칙', swap: ['material', 'hole'],
    inputs: [{ id: 'material', label: '재료' }, { id: 'hole', label: '구멍' }],
    note: '구멍 이미지에서 잉크가 있는 곳이 뚫려요. 재료는 거기로만 통과해요(재료의 색도 그대로). ⇄로 재료와 구멍을 맞바꿔 보세요.',
    params: [
      { key: 'threshold', type: 'range', label: '문턱값', min: 0, max: 1, step: 0.01, def: 0.5 },
      { key: 'soft', type: 'range', label: '가장자리', min: 0, max: 0.3, step: 0.005, def: 0.01 },
      { key: 'invert', type: 'bool', label: '반전', def: false },
      { key: 'ghost', type: 'range', label: '바깥 잔상', min: 0, max: 1, step: 0.01, def: 0 },
      { key: 'bridgeW', type: 'range', label: '다리 두께', min: 0, max: 0.06, step: 0.001, def: 0 },
      { key: 'bridgeN', type: 'range', label: '다리 칸 수', min: 1, max: 16, step: 1, def: 4 },
      { key: 'bridgeDir', type: 'select', label: '다리 방향', def: 'both', options: [['both', '가로+세로'], ['h', '가로'], ['v', '세로']] }
    ],
    compute: function (ins, p, ctx) {
      var R = ctx.R, N = R * R, out = new Float32Array(N);
      var md = ins.material ? ins.material.d : null, hd = ins.hole ? ins.hole.d : null;
      var thr = p.threshold, s = Math.max(p.soft, 0.002), inv = p.invert, ghost = p.ghost;
      var bw = p.bridgeW, bn = Math.max(1, p.bridgeN | 0), dir = p.bridgeDir, aa = 1 / R;
      var bx = new Float32Array(R), by = new Float32Array(R), i, x, y;
      if (bw > 0) {
        for (i = 0; i < R; i++) {
          var f = ((i + 0.5) / R * bn) % 1, dd = Math.abs(f - 0.5) / bn;
          var v = 1 - smooth(bw / 2 - aa, bw / 2 + aa, dd);
          bx[i] = dir === 'h' ? 0 : v;
          by[i] = dir === 'v' ? 0 : v;
        }
      }
      i = 0;
      for (y = 0; y < R; y++) {
        for (x = 0; x < R; x++, i++) {
          var m = hd ? smooth(thr - s, thr + s, hd[i]) : 1;
          if (inv) m = 1 - m;
          var bar = bx[x] > by[y] ? bx[x] : by[y];
          var open = m * (1 - bar);
          out[i] = (md ? md[i] : 1) * (open + (1 - open) * ghost);
        }
      }
      return mkField(R, out, ins.material ? ins.material.c : null);
    }
  });

  /* ---- 굴곡 (볼록/오목) ---- */
  reg('relief', {
    title: '굴곡', origin: '볼록·오목판화', cat: '규칙',
    inputs: [{ id: 'in', label: '입력' }],
    note: '밝기를 높낮이로 보고 등고선 능선을 만들어요. 볼록은 능선에, 오목은 골에 잉크가 남아서 정반대 무늬가 나와요.',
    params: [
      { key: 'mode', type: 'select', label: '방식', def: 'convex', options: [['convex', '볼록'], ['concave', '오목']] },
      { key: 'lines', type: 'range', label: '줄 수', min: 2, max: 48, step: 1, def: 12 },
      { key: 'width', type: 'range', label: '선 굵기', min: 0.05, max: 0.95, step: 0.01, def: 0.4 },
      { key: 'smooth', type: 'range', label: '매끄럽게', min: 0, max: 0.08, step: 0.001, def: 0.01 },
      { key: 'tone', type: 'range', label: '명암 반영', min: 0, max: 1, step: 0.01, def: 0 },
      { key: 'phase', type: 'range', label: '위상', min: 0, max: 1, step: 0.01, def: 0 }
    ],
    compute: function (ins, p, ctx) {
      var R = ctx.R, N = R * R, out = new Float32Array(N), src = ins.in;
      if (!src) return mkField(R, out);
      var h = U.blur(src.d, R, p.smooth * R, 2), mn = 1e9, mx = -1e9, i, x, y;
      for (i = 0; i < N; i++) { if (h[i] < mn) mn = h[i]; if (h[i] > mx) mx = h[i]; }
      var sc = mx > mn ? 1 / (mx - mn) : 0;
      var L = p.lines, w = p.width, tone = p.tone, sh = p.phase, concave = p.mode === 'concave';
      for (y = 0; y < R; y++) {
        var ym = ((y - 1 + R) % R) * R, yp = ((y + 1) % R) * R, row = y * R;
        for (x = 0; x < R; x++) {
          var xm = (x - 1 + R) % R, xp = (x + 1) % R;
          i = row + x;
          var hv = (h[i] - mn) * sc;
          var gx = Math.abs(h[row + xp] - h[row + xm]) * sc * 0.5, gy = Math.abs(h[yp + x] - h[ym + x]) * sc * 0.5;
          var g = gx > gy ? gx : gy;
          var v = hv * L + sh, pf = v - Math.floor(v), dist = Math.abs(pf - 0.5) * 2;
          var aa = g * L * 1.6 + 0.015; if (aa > 0.5) aa = 0.5;
          var wl = w * (1 - tone + tone * 2 * hv); if (wl > 0.98) wl = 0.98;
          var ink = wl <= 0.001 ? 0 : 1 - smooth(wl - aa, wl + aa, dist);
          out[i] = concave ? 1 - ink : ink;
        }
      }
      return mkField(R, out);
    }
  });

  /* ---- 변환 ---- */
  reg('transform', {
    title: '변환', origin: '모듈', cat: '규칙',
    inputs: [{ id: 'in', label: '입력' }],
    note: '모양을 줄이고 돌리고 옮겨요. 색도 같이 움직여요. 모듈마다 크기·각도를 달리해서 겹치기에 꽂아요. 중심은 화면 가운데예요.',
    params: [
      { key: 'scale', type: 'range', label: '크기', min: 0.05, max: 3, step: 0.01, def: 1 },
      { key: 'rotate', type: 'range', label: '회전', min: -180, max: 180, step: 1, def: 0 },
      { key: 'mx', type: 'range', label: '가로 이동', min: -0.5, max: 0.5, step: 0.005, def: 0 },
      { key: 'my', type: 'range', label: '세로 이동', min: -0.5, max: 0.5, step: 0.005, def: 0 },
      { key: 'wrap', type: 'bool', label: '반대편으로 이어붙이기', def: false },
      { key: 'pixel', type: 'bool', label: '픽셀 유지', def: false }
    ],
    compute: function (ins, p, ctx) {
      var src = ins.in, R = ctx.R, N = R * R;
      if (!src) return mkField(R);
      var sc = Math.max(0.01, p.scale), th = p.rotate * Math.PI / 180, co = Math.cos(th), si = Math.sin(th);
      if (sc === 1 && !p.rotate && !p.mx && !p.my) return src;
      var sd = src.d, scol = src.c, od = new Float32Array(N), oc = scol ? new Uint8ClampedArray(N * 4) : null;
      var wrap = !!p.wrap, pix = !!p.pixel;
      var ss = pix ? [[0.5, 0.5]] : R <= 1024 ? [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] : [[0.25, 0.25], [0.75, 0.75]];
      var ns = ss.length, x, y, s, i = 0, mx = p.mx, my = p.my;
      for (y = 0; y < R; y++) {
        for (x = 0; x < R; x++, i++) {
          var ad = 0, ar = 0, ag = 0, ab = 0;
          for (s = 0; s < ns; s++) {
            var u = (x + ss[s][0]) / R - 0.5 - mx, v = (y + ss[s][1]) / R - 0.5 - my;
            var a = (u * co + v * si) / sc + 0.5, b = (-u * si + v * co) / sc + 0.5;
            if (pix) {
              var ix = Math.floor(a * R), iy = Math.floor(b * R);
              if (wrap) { ix = ((ix % R) + R) % R; iy = ((iy % R) + R) % R; }
              else if (ix < 0 || iy < 0 || ix >= R || iy >= R) continue;
              var q = iy * R + ix, dq = sd[q];
              ad += dq;
              if (scol) { ar += scol[q * 4] * dq; ag += scol[q * 4 + 1] * dq; ab += scol[q * 4 + 2] * dq; }
              continue;
            }
            var fx = a * R - 0.5, fy = b * R - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), wx = fx - x0, wy = fy - y0, x1 = x0 + 1, y1 = y0 + 1;
            var w00 = (1 - wx) * (1 - wy), w10 = wx * (1 - wy), w01 = (1 - wx) * wy, w11 = wx * wy;
            var q00 = -1, q10 = -1, q01 = -1, q11 = -1;
            if (wrap) {
              x0 = ((x0 % R) + R) % R; x1 = ((x1 % R) + R) % R; y0 = ((y0 % R) + R) % R; y1 = ((y1 % R) + R) % R;
              q00 = y0 * R + x0; q10 = y0 * R + x1; q01 = y1 * R + x0; q11 = y1 * R + x1;
            } else {
              var xin0 = x0 >= 0 && x0 < R, xin1 = x1 >= 0 && x1 < R, yin0 = y0 >= 0 && y0 < R, yin1 = y1 >= 0 && y1 < R;
              if (xin0 && yin0) q00 = y0 * R + x0;
              if (xin1 && yin0) q10 = y0 * R + x1;
              if (xin0 && yin1) q01 = y1 * R + x0;
              if (xin1 && yin1) q11 = y1 * R + x1;
            }
            var d00 = q00 >= 0 ? sd[q00] * w00 : 0, d10 = q10 >= 0 ? sd[q10] * w10 : 0, d01 = q01 >= 0 ? sd[q01] * w01 : 0, d11 = q11 >= 0 ? sd[q11] * w11 : 0;
            ad += d00 + d10 + d01 + d11;
            if (scol) {
              if (q00 >= 0) { ar += scol[q00 * 4] * d00; ag += scol[q00 * 4 + 1] * d00; ab += scol[q00 * 4 + 2] * d00; }
              if (q10 >= 0) { ar += scol[q10 * 4] * d10; ag += scol[q10 * 4 + 1] * d10; ab += scol[q10 * 4 + 2] * d10; }
              if (q01 >= 0) { ar += scol[q01 * 4] * d01; ag += scol[q01 * 4 + 1] * d01; ab += scol[q01 * 4 + 2] * d01; }
              if (q11 >= 0) { ar += scol[q11 * 4] * d11; ag += scol[q11 * 4 + 1] * d11; ab += scol[q11 * 4 + 2] * d11; }
            }
          }
          od[i] = ad / ns;
          if (oc && ad > 1e-6) { var o = i * 4; oc[o] = ar / ad; oc[o + 1] = ag / ad; oc[o + 2] = ab / ad; oc[o + 3] = 255; }
        }
      }
      return mkField(R, od, oc);
    }
  });

  /* ---- 팽창·수축 ---- */
  reg('morph', {
    title: '팽창·수축', origin: '잉크 번짐', cat: '규칙',
    inputs: [{ id: 'in', label: '입력' }],
    note: '모양을 한 겹 부풀리거나 깎아요. 「테두리만」을 켜면 모양 둘레의 띠만 남아서, 같은 모듈의 윤곽선 층을 만들 수 있어요.',
    params: [
      { key: 'mode', type: 'select', label: '방식', def: 'dilate', options: [['dilate', '팽창 (부풀리기)'], ['erode', '수축 (깎기)']] },
      { key: 'amount', type: 'range', label: '크기', min: 0, max: 0.08, step: 0.001, def: 0.012 },
      { key: 'soft', type: 'range', label: '가장자리', min: 0, max: 0.4, step: 0.01, def: 0.08 },
      { key: 'ring', type: 'bool', label: '테두리만', def: false }
    ],
    compute: function (ins, p, ctx) {
      var src = ins.in, R = ctx.R, N = R * R;
      if (!src) return mkField(R);
      var r = p.amount * R, dil = p.mode !== 'erode', i;
      if (r < 1) return p.ring ? mkField(R, new Float32Array(N), null) : src;
      var sd = src.d, scol = src.c, b = U.blur(sd, R, r, 2), out = new Float32Array(N), sf = Math.max(0.01, p.soft) * 0.9;
      for (i = 0; i < N; i++) {
        var o = dil ? smooth(0.02, 0.02 + sf, b[i]) : smooth(0.97 - sf, 0.97, b[i]);
        out[i] = p.ring ? (dil ? o * (1 - sd[i]) : sd[i] * (1 - o)) : o;
      }
      var oc = scol;
      if (scol && dil) {                 // 부푼 가장자리의 색: 가까운 색을 번져 오게
        var ch = [0, 1, 2].map(function (k) {
          var t = new Float32Array(N), j;
          for (j = 0; j < N; j++) t[j] = sd[j] * scol[j * 4 + k];
          return U.blur(t, R, r, 2);
        });
        oc = new Uint8ClampedArray(N * 4);
        for (i = 0; i < N; i++) {
          var o4 = i * 4, w = b[i];
          if (sd[i] > 0.999 && !p.ring) { oc[o4] = scol[o4]; oc[o4 + 1] = scol[o4 + 1]; oc[o4 + 2] = scol[o4 + 2]; }
          else if (w > 1e-6) { oc[o4] = ch[0][i] / w; oc[o4 + 1] = ch[1][i] / w; oc[o4 + 2] = ch[2][i] / w; }
          oc[o4 + 3] = 255;
        }
      }
      return mkField(R, out, oc);
    }
  });

  /* ======================= 합치기 ======================= */

  /* ---- 겹치기 ---- */
  var STACK_IDS = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'];
  reg('stack', {
    title: '겹치기', origin: '분판·리소프린트', cat: '합치기', swap: ['l1', 'l2'],
    inputs: STACK_IDS.map(function (id, k) { return { id: id, label: '층 ' + (k + 1) }; }),
    note: '곱하기는 잉크가 비쳐 섞이고, 덮기는 위 층이 아래 층을 가려요. 층 1이 맨 아래, 층 6이 맨 위예요. 색은 층마다 「잉크 색」을 입히거나 「모듈 색」(모듈의 원래 색)을 그대로 써요. 층 번호가 클수록 더 어긋나요(리소프린트 오차) — 모듈을 중심에 맞춰 겹치려면 어긋남을 0으로. 종이 색은 출력에서 정해요.',
    params: [
      { key: 'colors', type: 'colors', label: '색', def: ['#00AEEF', '#EC008C', '#FFF200', '#222222', '#222222', '#222222'], srcKey: 'csrc' },
      { key: 'csrc', type: 'hidden', def: ['ink', 'ink', 'ink', 'ink', 'ink', 'ink'] },
      { key: 'mode', type: 'select', label: '합성', def: 'multiply', options: [['multiply', '곱하기'], ['max', '최대'], ['add', '더하기'], ['over', '덮기']] },
      { key: 'shift', type: 'range', label: '어긋남', min: 0, max: 0.08, step: 0.001, def: 0.012 },
      { key: 'angle', type: 'range', label: '방향', min: 0, max: 360, step: 1, def: 30 }
    ],
    compute: function (ins, p, ctx) {
      var R = ctx.R, N = R * R, d = new Float32Array(N), c = new Uint8ClampedArray(N * 4);
      var layers = [], cols = [], lcs = [], cidx = [], ridx = [], ang = p.angle * Math.PI / 180, step = p.shift * R;
      var srcs = p.csrc || [];
      STACK_IDS.forEach(function (id, k) {
        if (!ins[id]) return;
        var ox = Math.round(k * step * Math.cos(ang)), oy = Math.round(k * step * Math.sin(ang)), a = new Int32Array(R), b = new Int32Array(R), t;
        for (t = 0; t < R; t++) { a[t] = (((t - ox) % R) + R) % R; b[t] = ((((t - oy) % R) + R) % R) * R; }
        layers.push(ins[id].d); cols.push(hex2rgb((p.colors || [])[k] || '#222222'));
        lcs.push(srcs[k] === 'mod' && ins[id].c ? ins[id].c : null);
        cidx.push(a); ridx.push(b);
      });
      var mode = p.mode, nl = layers.length, x, y, i = 0, j;
      for (y = 0; y < R; y++) {
        for (x = 0; x < R; x++, i++) {
          var o = i * 4, dout = 0, r = 1, g = 1, b = 1, idx, v, col, lc, o2, cr, cg, cb;
          if (mode === 'multiply') {
            var tr = 1, tg = 1, tb = 1, tt = 1;
            for (j = 0; j < nl; j++) {
              idx = ridx[j][y] + cidx[j][x]; v = layers[j][idx];
              if (v <= 0) continue;
              lc = lcs[j];
              if (lc) { o2 = idx * 4; cr = lc[o2] / 255; cg = lc[o2 + 1] / 255; cb = lc[o2 + 2] / 255; }
              else { col = cols[j]; cr = col[0]; cg = col[1]; cb = col[2]; }
              tr *= 1 - v * (1 - cr); tg *= 1 - v * (1 - cg); tb *= 1 - v * (1 - cb); tt *= 1 - v;
            }
            dout = 1 - tt;
            if (dout > 1e-6) { r = (tr - tt) / dout; g = (tg - tt) / dout; b = (tb - tt) / dout; }
          } else if (mode === 'over') {
            var A = 0, Cr = 0, Cg = 0, Cb = 0, na;
            for (j = 0; j < nl; j++) {
              idx = ridx[j][y] + cidx[j][x]; v = layers[j][idx];
              if (v <= 0) continue;
              lc = lcs[j];
              if (lc) { o2 = idx * 4; cr = lc[o2] / 255; cg = lc[o2 + 1] / 255; cb = lc[o2 + 2] / 255; }
              else { col = cols[j]; cr = col[0]; cg = col[1]; cb = col[2]; }
              na = v + A * (1 - v);
              Cr = (cr * v + Cr * A * (1 - v)) / na; Cg = (cg * v + Cg * A * (1 - v)) / na; Cb = (cb * v + Cb * A * (1 - v)) / na;
              A = na;
            }
            dout = A; r = Cr; g = Cg; b = Cb;
          } else {
            var sum = 0, mxv = 0, wr = 0, wg = 0, wb = 0;
            for (j = 0; j < nl; j++) {
              idx = ridx[j][y] + cidx[j][x]; v = layers[j][idx];
              if (v <= 0) continue;
              lc = lcs[j];
              if (lc) { o2 = idx * 4; cr = lc[o2] / 255; cg = lc[o2 + 1] / 255; cb = lc[o2 + 2] / 255; }
              else { col = cols[j]; cr = col[0]; cg = col[1]; cb = col[2]; }
              sum += v; if (v > mxv) mxv = v;
              wr += v * cr; wg += v * cg; wb += v * cb;
            }
            dout = mode === 'max' ? mxv : (sum > 1 ? 1 : sum);
            if (sum > 0) { r = wr / sum; g = wg / sum; b = wb / sum; }
          }
          d[i] = dout;
          c[o] = (r < 0 ? 0 : r > 1 ? 1 : r) * 255; c[o + 1] = (g < 0 ? 0 : g > 1 ? 1 : g) * 255; c[o + 2] = (b < 0 ? 0 : b > 1 ? 1 : b) * 255; c[o + 3] = 255;
        }
      }
      return mkField(R, d, c);
    }
  });

  /* ======================= 끝 ======================= */

  /* ---- 반복 ---- */
  reg('tile', {
    title: '반복', origin: '패턴', cat: '끝',
    inputs: [{ id: 'in', label: '입력' }],
    note: '입력을 n×n칸으로 깔아요. 거울은 이음새가 생기지 않고, 벽돌은 한 줄씩 반 칸 어긋나요.',
    params: [
      { key: 'n', type: 'range', label: '반복 수', min: 1, max: 10, step: 1, def: 3 },
      { key: 'mode', type: 'select', label: '배치', def: 'plain', options: [['plain', '그대로'], ['mirror', '거울'], ['brick', '벽돌'], ['rot', '회전']] }
    ],
    compute: function (ins, p, ctx) {
      var src = ins.in, R = ctx.R, N = R * R;
      if (!src) return mkField(R);
      var n = Math.max(1, p.n | 0), mode = p.mode, sd = src.d, sc = src.c;
      if (n === 1) return src;            // 한 칸이면 원본 그대로 (흐려지지 않게)
      var od = new Float32Array(N), oc = sc ? new Uint8ClampedArray(N * 4) : null;
      var wrap = mode === 'plain' || mode === 'brick';
      var ss = R > 1024 ? [[0.25, 0.25], [0.75, 0.75]] : [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
      var ns = ss.length, x, y, s, i = 0;
      for (y = 0; y < R; y++) {
        for (x = 0; x < R; x++, i++) {
          var ad = 0, ar = 0, ag = 0, ab = 0;
          for (s = 0; s < ns; s++) {
            var U1 = (x + ss[s][0]) * n / R, V1 = (y + ss[s][1]) * n / R;
            var cx = Math.floor(U1), cy = Math.floor(V1), fx = U1 - cx, fy = V1 - cy;
            if (mode === 'brick') { if (cy & 1) { fx += 0.5; if (fx >= 1) fx -= 1; } }
            else if (mode === 'mirror') { if (cx & 1) fx = 1 - fx; if (cy & 1) fy = 1 - fy; }
            else if (mode === 'rot') {
              var r = (cx + cy) & 3, tx = fx, ty = fy;
              if (r === 1) { fx = 1 - ty; fy = tx; } else if (r === 2) { fx = 1 - tx; fy = 1 - ty; } else if (r === 3) { fx = ty; fy = 1 - tx; }
            }
            var sx = fx * R - 0.5, sy = fy * R - 0.5, x0 = Math.floor(sx), y0 = Math.floor(sy), wx = sx - x0, wy = sy - y0, x1 = x0 + 1, y1 = y0 + 1;
            if (wrap) { x0 = (x0 + R) % R; y0 = (y0 + R) % R; x1 = x1 % R; y1 = y1 % R; }
            else { x0 = x0 < 0 ? 0 : x0; y0 = y0 < 0 ? 0 : y0; x1 = x1 > R - 1 ? R - 1 : x1; y1 = y1 > R - 1 ? R - 1 : y1; }
            var w00 = (1 - wx) * (1 - wy), w10 = wx * (1 - wy), w01 = (1 - wx) * wy, w11 = wx * wy;
            var i00 = y0 * R + x0, i10 = y0 * R + x1, i01 = y1 * R + x0, i11 = y1 * R + x1;
            var e00 = sd[i00] * w00, e10 = sd[i10] * w10, e01 = sd[i01] * w01, e11 = sd[i11] * w11;   // 색은 불투명도로 가중 (투명한 곳의 색이 섞이지 않게)
            ad += e00 + e10 + e01 + e11;
            if (sc) {
              ar += sc[i00 * 4] * e00 + sc[i10 * 4] * e10 + sc[i01 * 4] * e01 + sc[i11 * 4] * e11;
              ag += sc[i00 * 4 + 1] * e00 + sc[i10 * 4 + 1] * e10 + sc[i01 * 4 + 1] * e01 + sc[i11 * 4 + 1] * e11;
              ab += sc[i00 * 4 + 2] * e00 + sc[i10 * 4 + 2] * e10 + sc[i01 * 4 + 2] * e01 + sc[i11 * 4 + 2] * e11;
            }
          }
          od[i] = ad / ns;
          if (oc && ad > 1e-6) { var o = i * 4; oc[o] = ar / ad; oc[o + 1] = ag / ad; oc[o + 2] = ab / ad; oc[o + 3] = 255; }
        }
      }
      return mkField(R, od, oc);
    }
  });

  /* ---- 출력 ---- */
  reg('output', {
    title: '출력', origin: '', cat: '끝', outputs: [],
    inputs: [{ id: 'in', label: '입력' }],
    note: '종이 색은 여기서 깔려요. 「배경 투명」을 켜면 종이 없이 모양만 PNG로 저장돼요. 오른쪽 미리보기에서도 저장할 수 있어요.',
    params: [
      { key: 'size', type: 'select', label: '해상도', def: '2048', options: [['1024', '1024px'], ['2048', '2048px'], ['4096', '4096px (무거워요)']] },
      { key: 'paper', type: 'color', label: '종이', def: '#ffffff' },
      { key: 'transparent', type: 'bool', label: '배경 투명', def: false },
      { key: 'export', type: 'button', label: 'PNG 저장', action: 'export' }
    ],
    compute: function (ins, p, ctx) { return ins.in || mkField(ctx.R); }
  });
})();
