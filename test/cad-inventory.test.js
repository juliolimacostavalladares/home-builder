const {test}=require('node:test');
const assert=require('node:assert/strict');
const {inventory}=require('../integration/cad-inventory');
const line='0\nLINE\n8\nWALL\n10\n0\n20\n0\n11\n1\n21\n0\n';
const insert=(name,x=0)=>`0\nINSERT\n8\nWALL\n2\n${name}\n10\n${x}\n20\n0\n`;
const block=(name,entities)=>`0\nBLOCK\n8\n0\n2\n${name}\n70\n0\n10\n0\n20\n0\n3\n${name}\n1\n\n${entities}0\nENDBLK\n8\n0\n`;
const dxf=(entities,blocks='')=>`0\nSECTION\n2\nBLOCKS\n${blocks}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;

test('Ordinary drawings above 12000 entities remain complete in the local inventory',()=>{
  const data=inventory(dxf(line.repeat(12001)));
  assert.equal(data.stats.rootEntities,12001);
  assert.equal(data.stats.expandedInstances,12001);
  assert.equal(data.stats.maxDepth,0);
  assert.equal(data.source.entities.length,12001);
  assert.equal(data.instances.length,12001);
  assert.equal(data.instances.at(-1).id,'e12000');
});

test('Repeated block placements retain distinct IDs and full transformed geometry',()=>{
  const data=inventory(dxf(insert('OUTER')+insert('OUTER',10),block('OUTER',insert('INNER',2))+block('INNER',line)));
  assert.equal(data.stats.rootEntities,2);
  assert.equal(data.stats.expandedInstances,6);
  assert.equal(data.stats.maxDepth,2);
  assert.equal(data.instances.length,6);
  assert.deepEqual(data.instances.map(e=>e.id),['e0','e0/b0','e0/b0/b0','e1','e1/b0','e1/b0/b0']);
  assert.equal(data.instances[2].worldVertices[0].x,2);
  assert.equal(data.instances[5].worldVertices[0].x,12);
});

test('Expansion is counted before allocation and is not mistaken for unique definitions',()=>{
  assert.throws(()=>inventory(dxf(insert('MANY')+insert('MANY'),block('MANY',line.repeat(50000)))),error=>{
    assert.equal(error.code,'CAD_INVENTORY_LIMIT');
    assert.equal(error.details.rootEntities,2);
    assert.equal(error.details.expandedInstances,100002);
    assert.equal(error.details.referencedBlocks,1);
    assert.equal(error.details.limit,100000);
    assert.match(error.message,/Nenhum dado foi truncado/);
    return true;
  });
});

test('Actual INSERT cycles identify the cycle instead of expanding until a generic limit',()=>{
  assert.throws(()=>inventory(dxf(insert('A'),block('A',insert('B'))+block('B',insert('A')))),error=>{
    assert.equal(error.code,'CAD_BLOCK_CYCLE');
    assert.deepEqual(error.details.cycle,['A','B','A']);
    return true;
  });
});

test('Undefined referenced blocks cannot silently lose their geometry',()=>{
  assert.throws(()=>inventory(dxf(insert('MISSING'))),error=>error.code==='CAD_BLOCK_MISSING');
});

test('Memoized shallow blocks do not bypass the nesting depth limit in another branch',()=>{
  const definitions=Array.from({length:13},(_,i)=>block(`B${i}`,i===12?line:insert(`B${i+1}`))).join('');
  assert.throws(()=>inventory(dxf(insert('B12')+insert('B0'),definitions)),error=>error.code==='CAD_BLOCK_DEPTH');
});
