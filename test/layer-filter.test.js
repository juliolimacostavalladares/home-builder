const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { filterArchitecturalLayers, heuristicFilter } = require('../integration/filter-architectural-layers');
const { runPipeline } = require('../integration/ai-pipeline');

test('Heuristic layer filtering excludes roof, plumbing, electrical, dimensions and cuts', () => {
  const sampleLayers = [
    { name: 'PAREDE', count: 120, samples: ['Alvenaria 15cm'] },
    { name: 'P1-PAREDE', count: 80, samples: [] },
    { name: 'ESQUADRIAS', count: 45, samples: ['P1 80x210', 'J1 120x120'] },
    { name: 'TELHADO', count: 300, samples: ['Telha Cerâmica', 'Cumeeira'] },
    { name: 'TELHAS', count: 150, samples: [] },
    { name: 'HIDRO_ESGOTO', count: 90, samples: ['Tubo PVC 100mm'] },
    { name: 'ELETROD', count: 60, samples: ['Ponto de luz'] },
    { name: 'COTAS', count: 200, samples: ['2.50', '3.80'] },
    { name: 'CORTE_AA', count: 50, samples: ['Nível +2.80'] },
    { name: 'FACHADA_FRONTAL', count: 70, samples: [] }
  ];

  const result = heuristicFilter(sampleLayers);

  assert.ok(result.include.includes('PAREDE'), 'Must include PAREDE');
  assert.ok(result.include.includes('P1-PAREDE'), 'Must include P1-PAREDE');
  assert.ok(result.include.includes('ESQUADRIAS'), 'Must include ESQUADRIAS');

  assert.ok(result.exclude.includes('TELHADO'), 'Must exclude TELHADO');
  assert.ok(result.exclude.includes('TELHAS'), 'Must exclude TELHAS');
  assert.ok(result.exclude.includes('HIDRO_ESGOTO'), 'Must exclude HIDRO_ESGOTO');
  assert.ok(result.exclude.includes('ELETROD'), 'Must exclude ELETROD');
  assert.ok(result.exclude.includes('COTAS'), 'Must exclude COTAS');
  assert.ok(result.exclude.includes('CORTE_AA'), 'Must exclude CORTE_AA');
  assert.ok(result.exclude.includes('FACHADA_FRONTAL'), 'Must exclude FACHADA_FRONTAL');
});

test('Pipeline fallback generates valid Blueprint3D model when AI interpretation is unavailable', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-filter-test-'));
  const dxf = `0
SECTION
2
HEADER
9
$INSUNITS
70
6
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
8
PAREDE
10
0
20
0
11
4
21
0
0
LINE
8
PAREDE
10
4
20
0
11
4
21
3
0
LINE
8
PAREDE
10
4
20
3
11
0
21
3
0
LINE
8
PAREDE
10
0
20
3
11
0
21
0
0
LINE
8
TELHADO
10
0
20
5
11
4
21
5
0
LINE
8
ELETROD
10
1
20
1
11
2
21
1
0
LINE
8
COTAS
10
0
20
-1
11
4
21
-1
0
ENDSEC
0
EOF
`;
  const input = path.join(dir, 'input.dxf');
  fs.writeFileSync(input, dxf);
  const stages = [];

  try {
    const result = await runPipeline(input, { url: 'http://example.invalid/v1' }, {
      directory: dir,
      onStage: s => stages.push(s.name)
    });

    assert.ok(result.design, 'Must have Blueprint3D design');
    assert.ok(result.design.floorplan, 'Must have floorplan');
    assert.equal(result.design.floorplan.walls.length, 4, 'Must have 4 walls from PAREDE layer');
    assert.ok(fs.existsSync(path.join(dir, 'design.blueprint3d')), 'design.blueprint3d file must be written');
    assert.ok(fs.existsSync(path.join(dir, 'layer-filter.json')), 'layer-filter.json must be written');
    const filterSaved = JSON.parse(fs.readFileSync(path.join(dir, 'layer-filter.json'), 'utf8'));
    assert.ok(filterSaved.exclude.includes('TELHADO'));
    assert.ok(filterSaved.exclude.includes('COTAS'));
    assert.ok(filterSaved.exclude.includes('ELETROD'));
    assert.ok(stages.includes('filter'), 'filter stage was logged');
    assert.ok(stages.includes('ready'), 'ready stage was reached');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
