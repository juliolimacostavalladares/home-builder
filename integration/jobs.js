const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { runPipeline } = require('./ai-pipeline');

module.exports = function mountJobs(app, receiveFile, { pipeline = runPipeline, config, root = path.join(__dirname, '../outputs') } = {}) {
  const jobs = new Map();
  let active = 0;
  const snapshot = job => {
    const artifacts = {};
    for (const name of ['conversion-contract.json', 'conversion-map.json', 'source.svg', 'source.png', 'source.dxf', 'layers.svg', 'inventory.json', 'semantic.svg', 'semantic-map.json', 'interpretation-1.json', 'interpretation-2.json', 'report.json', 'design.blueprint3d']) {
      if (fs.existsSync(path.join(root, job.id, name))) artifacts[name] = `/outputs/${job.id}/${name}`;
    }
    return { ...job, artifacts };
  };
  app.get('/api/blueprint3d/contract', (req,res)=>res.json(require('./ai-native-contract').runtimeContract()));
  app.get('/api/blueprint3d/recent', (req, res) => {
    const results = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) continue;
      try {
        const job = JSON.parse(fs.readFileSync(path.join(root, entry.name, 'job.json'), 'utf8'));
        if (job.status === 'ready') results.push({ id: entry.name, filename: job.filename, createdAt: job.createdAt });
      } catch { /* Incomplete or historical artifact directory. */ }
    }
    res.json(results.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,5));
  });
  app.get('/api/blueprint3d/jobs/:id', (req, res) => {
    let job = jobs.get(req.params.id);
    if (!job && /^[0-9a-f-]{36}$/.test(req.params.id)) {
      const stored = path.join(root, req.params.id, 'job.json');
      if (fs.existsSync(stored)) {
        job = JSON.parse(fs.readFileSync(stored, 'utf8'));
        if (job.status === 'running') job = { ...job, status: 'failed', error: 'O servidor reiniciou antes de concluir a conversão.' };
      }
    }
    if (!job) return res.status(404).json({ error: 'Conversão não encontrada nesta sessão do servidor.' });
    res.json(snapshot(job));
  });
  app.post(['/api/blueprint3d', '/api/blueprint3d/jobs'], receiveFile, (req, res) => {
    const reject = (status, message) => {
      if (req.file) fs.rmSync(req.file.path, { force: true });
      return res.status(status).json({ error: message });
    };
    if (!req.file) return reject(400, 'Envie um arquivo DWG ou DXF.');
    if (!['.dwg', '.dxf'].includes(path.extname(req.file.originalname).toLowerCase())) return reject(400, 'Formato permitido: DWG ou DXF.');
    if (active >= 2) return reject(429, 'Duas conversões estão em andamento. Aguarde a conclusão.');
    const id = randomUUID(), directory = path.join(root, id);
    fs.mkdirSync(directory, { recursive: true });
    // Preserve the extension for DWG/DXF readers; never use the supplied filename as a path.
    const input = path.join(directory, 'input' + path.extname(req.file.originalname).toLowerCase());
    fs.renameSync(req.file.path, input);
    const mode = (req.query.mode || req.body.mode || 'full').toLowerCase();
    const job = { id, mode, status: 'running', stages: [], filename: req.file.originalname, createdAt: new Date().toISOString() };
    const persist = () => fs.writeFileSync(path.join(directory, 'job.json'), JSON.stringify(job));
    jobs.set(id, job); active++; persist();
    for (const [key, old] of jobs) if (jobs.size > 100 && old.status !== 'running') jobs.delete(key);
    res.status(202).json(snapshot(job));
    Promise.resolve().then(() => pipeline(input, config(), { mode, directory, onStage: stage => { job.stages.push(stage); persist(); } }))
      .then(result => { job.result = result; job.status = 'ready'; })
      .catch(error => { job.status = 'failed'; job.error = error.message; job.diagnostics = error.diagnostics || []; })
      .finally(() => { persist(); active--; fs.rmSync(input, { force: true }); });
  });
};
