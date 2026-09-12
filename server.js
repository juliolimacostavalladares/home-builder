const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const converter = require('./converter');
const humanizer = require('./humanizer');
const cadAnalyzer = require('./cadAnalyzer');
const { Blueprint3D } = require('./blueprint3d');

const app = express();
const PORT = process.env.PORT || 3000;

// Diretórios
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/outputs', express.static(OUTPUT_DIR));

// Upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

// Diagnóstico
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    engine: '100% Pure Node.js (nasjidwg + sharp)',
    aiServices: {
      nineRouter: `${humanizer.nineRouterUrl} (Modelo padrão: ${humanizer.defaultImageModel})`,
      cadAnalysis: 'Ativo (Extração DXF + Análise Semântica de Cômodos e Mobília via 9Router LLM)'
    },
    supportedInputs: ['DWG', 'DXF'],
    endpoints: {
      convert: 'POST /api/convert (SVG, PNG, PDF, DXF)',
      analyze: 'POST /api/analyze-cad (Extrai e interpreta cômodos e mobília do CAD via IA)',
      humanize: 'POST /api/humanize (Gera Planta Humanizada 2D com base no raio-x dos cômodos)'
    }
  });
});

// 1. Endpoint 2D Blueprint (SVG, PNG, PDF, DXF)
app.post('/api/convert', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  }

  const filePath = req.file.path;
  const originalName = path.basename(req.file.originalname, path.extname(req.file.originalname));
  const format = (req.query.format || req.body.format || 'svg').toLowerCase();
  const theme = (req.query.theme || req.body.theme || 'dark').toLowerCase();

  try {
    const cadDoc = await converter.parseCadFile(filePath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    if (format === 'png') {
      const pngBuffer = await converter.toPng(cadDoc, { theme });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `inline; filename="${originalName}_2d.png"`);
      return res.send(pngBuffer);
    }

    if (format === 'pdf') {
      const pdfBuffer = await converter.toPdf(cadDoc, { theme });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${originalName}_2d.pdf"`);
      return res.send(pdfBuffer);
    }

    if (format === 'dxf') {
      const dxfString = await converter.toDxf(cadDoc);
      res.setHeader('Content-Type', 'application/dxf');
      res.setHeader('Content-Disposition', `attachment; filename="${originalName}.dxf"`);
      return res.send(dxfString);
    }

    const svgString = await converter.toSvg(cadDoc, { theme });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Content-Disposition', `inline; filename="${originalName}_2d.svg"`);
    return res.send(svgString);

  } catch (err) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    console.error('Erro na conversão 2D:', err);
    return res.status(500).json({ error: 'Erro ao converter planta.', details: err.message });
  }
});

// 2. Endpoint de Análise Profunda do CAD (Extração de Cômodos e Mobília via IA)
app.post('/api/analyze-cad', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  }

  const filePath = req.file.path;
  const style = req.body.style || req.query.style || 'modern';
  const customNotes = req.body.customNotes || req.query.customNotes || '';
  // Se noFallback não for explicitamente desativado, exige IA sem fallback silencioso
  const noFallback = req.body.noFallback !== false && req.body.noFallback !== 'false' && req.query.noFallback !== 'false';

  try {
    const cadDoc = await converter.parseCadFile(filePath);
    const dxfString = await converter.toDxf(cadDoc);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    const metadata = cadAnalyzer.extractMetadata(dxfString);
    const analysis = await cadAnalyzer.interpretLayoutWithAi(
      metadata,
      style,
      customNotes,
      humanizer.nineRouterUrl,
      humanizer.nineRouterKey,
      { noFallback }
    );

    return res.json({
      success: true,
      metadata,
      analysis
    });
  } catch (err) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    console.error('Erro ao analisar CAD:', err);
    return res.status(500).json({ error: 'Erro ao analisar arquivo CAD com IA.', details: err.message });
  }
});

// 3. Endpoint Planta Humanizada Realista Guiada pelo Raio-X do CAD
app.post('/api/humanize', upload.single('file'), async (req, res) => {
  let filePath = req.file ? req.file.path : null;
  const originalName = req.file ? path.basename(req.file.originalname, path.extname(req.file.originalname)) : 'planta';
  const style = req.body.style || req.query.style || 'modern';
  const strength = req.body.strength || req.query.strength || 0.40;
  const customNotes = req.body.customNotes || req.query.customNotes || '';
  const model = req.body.model || req.query.model || 'cx/gpt-image-2.5';
  const returnFormat = (req.query.format || req.body.format || 'json').toLowerCase(); // 'json' ou 'image'
  const noFallback = req.body.noFallback === true || req.body.noFallback === 'true' || req.query.noFallback === 'true';

  try {
    let baseImageBuffer;
    let svgString = '';
    let cadMetadata = null;
    let cadAnalysis = null;

    if (filePath) {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.dwg' || ext === '.dxf') {
        const cadDoc = await converter.parseCadFile(filePath);
        
        // 1. Extrai DXF e executa a interpretação dos cômodos via IA
        console.log('[CadAnalyzer] Extraindo dados brutos do CAD para análise semântica...');
        const dxfString = await converter.toDxf(cadDoc);
        cadMetadata = cadAnalyzer.extractMetadata(dxfString);
        console.log(`[CadAnalyzer] Extraídos: ${cadMetadata.rooms.length} cômodos, ${cadMetadata.fixtures.length} equipamentos/louças.`);

        cadAnalysis = await cadAnalyzer.interpretLayoutWithAi(
          cadMetadata,
          style,
          customNotes,
          humanizer.nineRouterUrl,
          humanizer.nineRouterKey,
          { noFallback }
        );

        // 2. Prepara imagem técnica e SVG quadrado
        const rawSvg = await converter.toSvg(cadDoc, { theme: 'light', width: 1024 });
        const prep = await humanizer.prepareFloorPlanImage(rawSvg, 1024, 1024);
        baseImageBuffer = prep.buffer;
        svgString = prep.squareSvg;
      } else if (ext === '.svg') {
        const rawSvg = fs.readFileSync(filePath, 'utf-8');
        const prep = await humanizer.prepareFloorPlanImage(rawSvg, 1024, 1024);
        baseImageBuffer = prep.buffer;
        svgString = prep.squareSvg;
      } else {
        baseImageBuffer = fs.readFileSync(filePath);
      }
      fs.unlinkSync(filePath);
    } else if (req.body.svgString) {
      const rawSvg = req.body.svgString;
      const prep = await humanizer.prepareFloorPlanImage(rawSvg, 1024, 1024);
      baseImageBuffer = prep.buffer;
      svgString = prep.squareSvg;
    } else {
      return res.status(400).json({ error: 'Envie um arquivo .dwg, .dxf ou o conteúdo SVG para humanizar.' });
    }

    console.log(`[Humanize] Iniciando geração da planta humanizada (Modelo: ${model}, Estilo: ${style}, Strength: ${strength})...`);

    // Executa a humanização via 9Router (cx/gpt-image-2.5) usando as instruções específicas de cada cômodo
    const result = await humanizer.humanizeFloorPlan(baseImageBuffer, {
      model,
      style,
      strength,
      customNotes,
      description: originalName,
      cadAnalysis
    });

    // Salva a imagem técnica de base em outputs/ para comparação e auditoria
    const techFilename = `tecnica_${Date.now()}.png`;
    const techPath = path.join(OUTPUT_DIR, techFilename);
    fs.writeFileSync(techPath, baseImageBuffer);
    const technicalUrl = `/outputs/${techFilename}`;

    // Salva localmente a imagem humanizada em outputs/
    const filename = `humanizada_${Date.now()}.png`;
    const localSavedPath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(localSavedPath, result.imageBuffer);

    const publicUrl = `/outputs/${filename}`;

    if (returnFormat === 'image') {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `inline; filename="${originalName}_humanizada.png"`);
      return res.send(result.imageBuffer);
    }

    return res.json({
      success: true,
      imageUrl: publicUrl,
      technicalUrl: technicalUrl,
      svgString: svgString,
      cadAnalysis: cadAnalysis,
      cadMetadata: cadMetadata,
      remoteUrl: result.remoteUrl,
      promptUsed: result.prompt,
      modelUsed: result.model,
      providerUsed: result.provider,
      style,
      strength
    });

  } catch (err) {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    console.error('Erro na humanização:', err);
    return res.status(500).json({
      error: 'Erro ao gerar planta humanizada.',
      details: err.message
    });
  }
});

// 4. Endpoint Blueprint3D Volumétrico (Paredes com vãos, pisos e volumetria)
app.post('/api/floorplan-3d', upload.single('file'), async (req, res) => {
  let filePath = req.file?.path;
  const isSample = req.query.sample === 'true' || req.body?.sample === 'true' || (!req.file && fs.existsSync(path.join(__dirname, 'public/samples/Planta_3_quartos-160m2.dwg')));

  if (!filePath && isSample) {
    filePath = path.join(__dirname, 'public/samples/Planta_3_quartos-160m2.dwg');
  }

  if (!filePath) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  }

  const cutHeight = req.body.cutHeight ? Number(req.body.cutHeight) : 1.30;
  const shouldUnlink = req.file && filePath === req.file.path;

  try {
    const cadDoc = await converter.parseCadFile(filePath);
    const dxfString = await converter.toDxf(cadDoc);
    if (shouldUnlink && fs.existsSync(filePath)) fs.unlinkSync(filePath);

    const result = Blueprint3D.processDxfTo3d(dxfString, { cutHeight });

    return res.json({
      success: true,
      floorplan: result.floorplan,
      volumetrics: result.volumetrics,
      metadata: result.metadata
    });
  } catch (err) {
    if (shouldUnlink && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    console.error('Erro ao gerar modelo 3D volumétrico:', err);
    return res.status(500).json({
      error: 'Erro ao gerar modelo 3D volumétrico.',
      details: err.message
    });
  }
});

function startServer(portToTry) {
  const server = app.listen(portToTry, () => {
    console.log(`====================================================`);
    console.log(`🚀 Servidor CAD & Planta Humanizada IA: http://localhost:${portToTry}`);
    console.log(`🎨 Motor IA Principal: 9Router cx/gpt-image-2.5 (OpenAI Codex)`);
    console.log(`🔍 Análise Semântica de Cômodos: Ativa via 9Router LLM`);
    console.log(`✨ DWG/DXF 2D -> Planta Humanizada Foto-Realista`);
    console.log(`====================================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
      console.warn(`⚠️ Porta ${portToTry} ocupada/reservada, tentando porta ${portToTry + 1}...`);
      startServer(portToTry + 1);
    } else {
      console.error('Erro no servidor:', err);
    }
  });
}

startServer(Number(PORT) || 3000);
