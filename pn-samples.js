/* Pattern Nodes — pn-samples.js
   샘플 그래프. 이미지를 올리지 않아도 바로 돌아가게 노이즈·격자·샘플 이미지로만 만들었어요.
   스펙: nodes = [id, 종류, x, y, 설정값], edges = [보내는 노드, 받는 노드, 받는 포트] */
(function () {
  'use strict';
  var PN = window.PN;
  (PN.builds = PN.builds || {}).samples = '20261021b';

  function build(nodes, edges) {
    var g = { nodes: {}, edges: [], nextId: 1 };
    nodes.forEach(function (s) {
      var p = PN.defaultParams(s[1]), o = s[4] || {}, k;
      for (k in o) p[k] = o[k];
      g.nodes[s[0]] = { id: s[0], type: s[1], x: s[2], y: s[3], params: p };
      var num = parseInt(String(s[0]).replace(/\D/g, ''), 10);
      if (num >= g.nextId) g.nextId = num + 1;
    });
    edges.forEach(function (e) { g.edges.push({ from: e[0], fromPort: 'out', to: e[1], toPort: e[2] }); });
    return g;
  }

  PN.samples = [
    {
      id: 'fingerprint', name: '지문 위의 점', desc: '노이즈 능선(지문) 위로 점이 통과하고, 골에는 다른 잉크가 차요',
      build: function () {
        return build([
          ['n1', 'noise', 40, 40, { scale: 3, octaves: 2, seed: 4, contrast: 2 }],
          ['n2', 'relief', 330, 40, { mode: 'convex', lines: 14, width: 0.32 }],
          ['n3', 'relief', 330, 470, { mode: 'concave', lines: 14, width: 0.5, phase: 0.5 }],
          ['n4', 'grid', 40, 470, { kind: 'dots', nx: 20, ny: 20, size: 0.75 }],
          ['n5', 'hole', 620, 40, { threshold: 0.5 }],
          ['n6', 'stack', 910, 200, { shift: 0.012, angle: 30, colors: ['#EC008C', '#00AEEF', '#FFF200', '#222222'] }],
          ['n7', 'tile', 1200, 200, { n: 2, mode: 'mirror' }],
          ['n8', 'output', 1490, 200, {}]
        ], [
          ['n1', 'n2', 'in'], ['n1', 'n3', 'in'], ['n4', 'n5', 'material'], ['n2', 'n5', 'hole'],
          ['n5', 'n6', 'l1'], ['n3', 'n6', 'l2'], ['n6', 'n7', 'in'], ['n7', 'n8', 'in']
        ]);
      }
    },
    {
      id: 'swap', name: '재료와 규칙 맞바꾸기', desc: '같은 두 이미지를 서로 재료/구멍으로 꽂아서 정반대 무늬를 겹쳐요',
      build: function () {
        return build([
          ['n1', 'noise', 40, 40, { scale: 4, octaves: 2, seed: 9, contrast: 2.2 }],
          ['n2', 'relief', 330, 40, { mode: 'convex', lines: 10, width: 0.5 }],
          ['n3', 'grid', 40, 470, { kind: 'lines', nx: 10, ny: 10, size: 0.42 }],
          ['n4', 'hole', 620, 20, { threshold: 0.5, bridgeW: 0 }],
          ['n5', 'hole', 620, 470, { threshold: 0.5, bridgeW: 0.012, bridgeN: 6 }],
          ['n6', 'stack', 910, 260, { shift: 0.008, angle: 90, colors: ['#EC008C', '#222222', '#FFF200', '#222222'] }],
          ['n7', 'tile', 1200, 260, { n: 3, mode: 'brick' }],
          ['n8', 'output', 1490, 260, {}]
        ], [
          ['n1', 'n2', 'in'],
          ['n3', 'n4', 'material'], ['n2', 'n4', 'hole'],
          ['n2', 'n5', 'material'], ['n3', 'n5', 'hole'],
          ['n4', 'n6', 'l1'], ['n5', 'n6', 'l2'], ['n6', 'n7', 'in'], ['n7', 'n8', 'in']
        ]);
      }
    },
    {
      id: 'image', name: '이미지 → 볼록·오목 두 장', desc: '이미지 하나에서 볼록판과 오목판을 뽑아 어긋나게 겹쳐요 (내 이미지로 바꿔 보세요)',
      build: function () {
        return build([
          ['n1', 'image', 40, 40, { fit: 'mirror' }],
          ['n2', 'relief', 330, 40, { mode: 'convex', lines: 18, width: 0.55, tone: 0.8, smooth: 0.012 }],
          ['n3', 'relief', 330, 470, { mode: 'concave', lines: 9, width: 0.4, tone: 0, smooth: 0.02, phase: 0.5 }],
          ['n4', 'stack', 620, 230, { shift: 0.015, angle: 20, colors: ['#00AEEF', '#EC008C', '#FFF200', '#222222'] }],
          ['n5', 'tile', 910, 230, { n: 2, mode: 'mirror' }],
          ['n6', 'output', 1200, 230, {}]
        ], [
          ['n1', 'n2', 'in'], ['n1', 'n3', 'in'], ['n2', 'n4', 'l1'], ['n3', 'n4', 'l2'], ['n4', 'n5', 'in'], ['n5', 'n6', 'in']
        ]);
      }
    }
  ];
})();
