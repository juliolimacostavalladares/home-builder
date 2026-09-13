(() => {
  const $ = id => document.getElementById(id);
  let file, busy = false, artifacts = {}, inventory, roles = new Map(), map, modelReady = false, workspace = 'cad';
  function status(message, state = '') { $('status').textContent = message; $('status').setAttribute('data-state', state); }
  function controls() { $('import').disabled = busy || !file; $('extract-2d').disabled = busy || !file; $('sample').disabled = busy; $('cad-file').disabled = busy; }
  function showWorkspace(view) {
    if (view !== 'cad' && !modelReady) return;
    workspace = view;
    $('editor').hidden = view === 'cad';
    $('technical').hidden = view !== 'cad' || !artifacts[$('view').value];
    $('viewer-placeholder').hidden = view !== 'cad' || !$('technical').hidden;
    for (const [id, name] of [['view-cad','cad'], ['view-plan','2d'], ['view-model','3d']]) $(id).setAttribute('aria-pressed', String(name === view));
    if (view !== 'cad') $('editor').contentWindow.homeBuilderBridge.showView(view);
  }
  $('view-cad').addEventListener('click', () => showWorkspace('cad'));
  $('view-plan').addEventListener('click', () => showWorkspace('2d'));
  $('view-model').addEventListener('click', () => showWorkspace('3d'));
  function resetResult() {
    modelReady = false; artifacts = {}; inventory = null; roles = new Map(); map = null;
    for (const id of ['download','view-cad','view-plan','view-model']) $(id).disabled = true;
    $('editor-result').textContent = ''; $('warnings').replaceChildren();
    $('model-status').textContent = 'Conversão em andamento. A planta editável e o modelo 3D ainda não estão disponíveis.';
    $('viewer-placeholder').textContent = 'Lendo o CAD. O desenho original aparecerá aqui assim que estiver disponível.';
    showWorkspace('cad');
  }
  function failed(error) {
    status(error.message, 'error');
    $('model-status').textContent = 'Modelo 3D indisponível: a conversão não foi concluída.';
    $('viewer-placeholder').textContent = 'Não foi possível gerar a planta editável e o modelo 3D nesta tentativa.';
    if (!modelReady) showWorkspace('cad');
  }
  function selectFile(selected) { file = selected; controls(); status(`${file.name}: pronto para interpretar a imagem e as entidades CAD.`); }
  function roleFor(id) { while (id) { if (roles.has(id)) return roles.get(id); id = id.includes('/') ? id.slice(0,id.lastIndexOf('/')) : ''; } return 'Camada CAD original'; }
  function showView() {
    const name = $('view').value;
    $('vector').data = artifacts[name] || 'about:blank';
    $('view-description').textContent = name === 'semantic.svg' ? 'Categorias interpretadas pela IA: paredes verdes, pisos vermelhos, janelas roxas e portas marrons.' : name === 'layers.svg' ? 'Cores por camada original do CAD. Elas ainda não representam categorias identificadas pela IA.' : 'Desenho original extraído do CAD. A interpretação para o Blueprint3D é uma etapa separada.';
    $('entity').textContent = name === 'source.svg' ? 'Esta é a visualização original do arquivo. Para consultar os IDs das entidades, selecione Camadas originais CAD quando disponível.' : 'Selecione uma entidade para consultar seu ID, camada, classificação e dados CAD.';
    $('filters').replaceChildren();
    if (name === 'semantic.svg' && map) for (const [role, label] of Object.entries(map.labels)) {
      const wrapper = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.checked = true;
      input.addEventListener('change', () => {
        for (const shape of $('vector').contentDocument?.querySelectorAll('[data-role]') || []) if (shape.dataset.role === role) shape.style.display = input.checked ? '' : 'none';
      });
      wrapper.style.color = map.colors[role]; wrapper.append(input, document.createTextNode(label)); $('filters').append(wrapper);
    }
  }
  $('view').addEventListener('change', showView);
  $('vector').addEventListener('load', () => {
    const doc = $('vector').contentDocument;
    doc?.addEventListener('click', event => {
      const shape = event.target.closest('[data-entity-id], [data-floor-id]');
      if (!shape) return;
      if (shape.dataset.floorId) { $('entity').textContent = `${shape.dataset.floorId}: piso calculado pelo Blueprint3D a partir das paredes. Não é uma entidade original do CAD.`; return; }
      const record = inventory?.instances.find(item => item.id === shape.dataset.entityId);
      $('entity').textContent = JSON.stringify({ classification: roleFor(shape.dataset.entityId), ...record }, null, 2);
    });
  });
  async function review(job) {
    const previousView = $('view').value;
    artifacts = job.artifacts || {};
    inventory = artifacts['inventory.json'] ? await (await fetch(artifacts['inventory.json'])).json() : null;
    roles = new Map(); map = null;
    const interpretation = artifacts['interpretation-2.json'] || artifacts['interpretation-1.json'];
    if (interpretation) for (const group of (await (await fetch(interpretation)).json()).assignments || []) for (const id of group.ids || []) roles.set(id, group.role);
    if (artifacts['semantic-map.json']) map = await (await fetch(artifacts['semantic-map.json'])).json();
    for (const option of $('view').options) option.disabled = !artifacts[option.value];
    $('view').value = artifacts[previousView] ? previousView : ['semantic.svg','layers.svg','source.svg'].find(name => artifacts[name]) || '';
    $('view-cad').disabled = !$('view').value;
    $('technical').open = true;
    $('artifacts').replaceChildren();
    for (const [name, label] of [['source.svg','Abrir desenho CAD'],['source.png','Imagem PNG'],['conversion-contract.json','Contrato CAD → Blueprint3D'],['conversion-map.json','Correspondências'],['inventory.json','Inventário CAD'],['source.dxf','DXF'],['semantic.svg','SVG colorido'],['report.json','Relatório'],['design.blueprint3d','Arquivo Blueprint3D']]) if (artifacts[name]) {
      const a = document.createElement('a'); a.href = artifacts[name]; a.textContent = label; a.download = name; $('artifacts').append(a);
    }
    showView();
    showWorkspace(workspace);
  }
  $('cad-file').addEventListener('change', e => { if (e.target.files[0]) selectFile(e.target.files[0]); });
  $('sample').addEventListener('click', async () => {
    busy = true; controls();
    try { const response = await fetch('/samples/Planta_3_quartos-160m2.dwg'); if (!response.ok) throw new Error('Exemplo indisponível.'); selectFile(new File([await response.blob()], 'Planta_3_quartos-160m2.dwg')); }
    catch (error) { status(error.message); } finally { busy = false; controls(); }
  });
  async function followJob(job) {
      resetResult();
      let previewKey;
      async function update() {
        $('stages').replaceChildren(...job.stages.map(stage => { const li = document.createElement('li'); li.textContent = stage.message; return li; }));
        if (job.status === 'running') status(job.stages.at(-1)?.message || 'Conversão em andamento…');
        const key = Object.keys(job.artifacts || {}).join('|');
        if (key !== previewKey) { await review(job); previewKey = key; }
      }
      await update();
      while (job.status === 'running') {
        await new Promise(resolve => setTimeout(resolve, 1500));
        const poll = await fetch(`/api/blueprint3d/jobs/${job.id}`); job = await poll.json(); if (!poll.ok) throw new Error(job.error);
        await update();
      }
      await review(job);
      if (job.status !== 'ready') throw new Error([job.error, ...(job.diagnostics || [])].join(' '));
      if (job.result?.design) {
        const bridge = $('editor').contentWindow.homeBuilderBridge;
        if (!bridge?.ready) throw new Error('O editor não iniciou. O arquivo validado está disponível nos artefatos.');
        $('editor').hidden = false;
        const result = bridge.load(job.result.design);
        modelReady = true;
        $('view-plan').disabled = false; $('view-model').disabled = false;
        $('download').disabled = false;
        $('model-status').textContent = `${job.filename}: planta e modelo 3D disponíveis.`;
        showWorkspace('2d');
        $('editor-result').textContent = `${result.walls} paredes · ${result.rooms} pisos fechados`;
        $('warnings').replaceChildren();
        const warnings = job.result.report?.warnings || [];
        if (warnings.length > 0) {
          const summary = document.createElement('summary'); summary.textContent = 'Relatório da adaptação'; $('warnings').append(summary);
          for (const warning of warnings) { const p = document.createElement('p'); p.textContent = warning; $('warnings').append(p); }
        }
        status(job.result.report?.strategy === 'ai-native' ? `${job.filename}: modelo produzido pela IA no contrato ${job.result.report.contractVersion}, validado e importado.` : `${job.filename}: modelo Blueprint3D gerado com sucesso a partir das camadas arquitetônicas (${job.result.report?.walls} paredes).`);
      } else {
        // Modo 2D exclusivo (sem IA e sem 3D)
        modelReady = false;
        $('view-plan').disabled = true; $('view-model').disabled = true;
        $('download').disabled = true;
        $('model-status').textContent = `${job.filename}: desenho 2D vetorial detalhado pronto.`;
        showWorkspace('cad');
        $('editor-result').textContent = `${job.result?.report?.instancesCount || ''} entidades CAD`;
        status(`${job.filename}: planta 2D técnica extraída com fidelidade total (sem IA).`);
      }
  }
  async function submitJob(mode = 'full') {
    if (busy || !file) return;
    busy = true; controls(); resetResult(); $('stages').replaceChildren();
    status(mode === '2d' ? 'Extraindo planta técnica 2D do CAD (sem IA)…' : 'Enviando CAD para interpretação…');
    try {
      const body = new FormData(); body.append('file', file);
      const response = await fetch(`/api/blueprint3d/jobs?mode=${mode}`, { method: 'POST', body });
      let job = await response.json(); if (!response.ok) throw new Error(job.error);
      history.replaceState(null, '', '?job=' + encodeURIComponent(job.id));
      await followJob(job);
    } catch (error) { failed(error); } finally { busy = false; controls(); }
  }
  $('import-form').addEventListener('submit', async event => {
    event.preventDefault();
    await submitJob('full');
  });
  $('extract-2d').addEventListener('click', async () => {
    await submitJob('2d');
  });
  const resumeId = new URLSearchParams(location.search).get('job');
  if (!resumeId) fetch('/api/blueprint3d/recent').then(response=>response.json()).then(jobs=>{
    if (!jobs.length) return;
    $('recent').href = '?job=' + encodeURIComponent(jobs[0].id);
    $('recent').textContent = 'Abrir última conversão validada'; $('recent').hidden = false;
  }).catch(()=>{});
  if (resumeId) window.addEventListener('load', async () => {
    busy = true; controls();
    try {
      const response = await fetch('/api/blueprint3d/jobs/' + encodeURIComponent(resumeId));
      const job = await response.json(); if (!response.ok) throw new Error(job.error);
      await followJob(job);
    } catch (error) { failed(error); } finally { busy = false; controls(); }
  });
  $('download').addEventListener('click', () => {
    const data = $('editor').contentWindow.homeBuilderBridge.save();
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'planta.blueprint3d'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
})();
