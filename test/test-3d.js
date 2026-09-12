const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CadConverter = require('../converter');
const { Blueprint3D, SceneBuilder, config } = require('../blueprint3d');

async function runTests() {
  console.log('--- Iniciando Validação Autônoma do Modelo Volumétrico 3D ---');

  const dwgPath = '/Users/macbookpro/Desktop/12_plantas_baixas_3_quartos/Planta_3_quartos-160m2.dwg';
  assert(fs.existsSync(dwgPath), 'Arquivo DWG de teste deve existir');

  // 1. Teste de Leitura e Conversão CAD para DXF
  console.log('1. Testando leitura do DWG e geração de DXF...');
  const cadDoc = await CadConverter.parseCadFile(dwgPath);
  assert(cadDoc, 'Documento CAD deve ser lido com sucesso');
  const dxfString = await CadConverter.toDxf(cadDoc);
  assert(typeof dxfString === 'string' && dxfString.length > 0, 'DXF gerado deve ser uma string não vazia');
  console.log('✓ Leitura CAD & DXF OK');

  // 2. Teste do Processamento 3D (Corte 1.30m - Planta Baixa 3D)
  console.log('2. Testando Blueprint3D.processDxfTo3d (corte 1.30m)...');
  const res130 = Blueprint3D.processDxfTo3d(dxfString, { cutHeight: 1.30 });
  assert(res130.floorplan, 'Floorplan deve ser retornado');
  assert(res130.volumetrics, 'Dados volumétricos devem ser retornados');
  assert(res130.volumetrics.totalWalls > 0, 'Paredes devem ser detectadas');
  assert(res130.volumetrics.totalRooms > 0, 'Cômodos fechados devem ser detectados');
  assert(res130.volumetrics.totalDoors > 0, 'Portas devem ser detectadas');
  assert(res130.volumetrics.totalWindows > 0, 'Janelas devem ser detectadas');
  assert.strictEqual(res130.volumetrics.cutHeight, 1.30, 'Altura de corte deve ser 1.30m');
  console.log(`✓ Planta Baixa 3D OK: ${res130.volumetrics.totalWalls} paredes, ${res130.volumetrics.totalRooms} cômodos, ${res130.volumetrics.totalDoors} portas, ${res130.volumetrics.totalWindows} janelas`);

  // 3. Teste do Processamento 3D (Corte 2.80m - Maquete Cheia com Vergas)
  console.log('3. Testando Blueprint3D.processDxfTo3d (corte 2.80m maquete cheia)...');
  const res280 = Blueprint3D.processDxfTo3d(dxfString, { cutHeight: 2.80 });
  assert.strictEqual(res280.volumetrics.cutHeight, 2.80, 'Altura de corte deve ser 2.80m');
  assert(res280.metadata.meshesCount > 0, 'Meshes Three.js devem ser geradas');
  console.log(`✓ Maquete Cheia OK: ${res280.metadata.meshesCount} meshes 3D na cena Three.js`);

  // 4. Teste de Polígonos de Cômodos e Centros
  console.log('4. Testando consistência geométrica dos cômodos...');
  for (const room of res130.volumetrics.roomsList) {
    assert(room.name, 'Cômodo deve possuir nome');
    assert(room.area > 0.5, `Área do cômodo ${room.name} deve ser válida (> 0.5m²), obtida: ${room.area}`);
    assert(room.polygon.length >= 3, 'Polígono do cômodo deve ter no mínimo 3 vértices');
    assert(room.floorType === 'hardwood' || room.floorType === 'porcelain' || room.floorType === 'exterior', 'Piso deve ter tipo válido');
  }
  console.log('✓ Consistência geométrica dos cômodos validada');

  // 5. Teste da API HTTP /api/floorplan-3d
  console.log('5. Testando endpoint HTTP /api/floorplan-3d no servidor local...');
  const formData = new FormData();
  formData.append('file', new Blob([fs.readFileSync(dwgPath)]), 'planta.dwg');
  formData.append('cutHeight', '1.30');

  const response = await fetch('http://localhost:3000/api/floorplan-3d', {
    method: 'POST',
    body: formData
  });

  assert.strictEqual(response.status, 200, 'HTTP status deve ser 200 OK');
  const json = await response.json();
  assert.strictEqual(json.success, true, 'Resposta da API deve conter success=true');
  assert(json.floorplan && json.metadata, 'Resposta deve conter floorplan e metadata');
  console.log('✓ Endpoint HTTP /api/floorplan-3d validado com sucesso');

  console.log('\n=============================================');
  console.log('🎉 TODOS OS TESTES PASSARAM COM SUCESSO! 🎉');
  console.log('=============================================');
}

runTests().catch(err => {
  console.error('❌ Falha na validação:', err);
  process.exit(1);
});
