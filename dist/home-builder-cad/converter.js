const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const sharp = require('sharp');

class CadConverter {
  constructor() {
    this.binDir = path.join(__dirname, 'bin');
    this.nasjiPromise = import('nasjidwg');
  }

  async getNasji() {
    return await this.nasjiPromise;
  }

  /**
   * Converte arquivo DWG ou DXF em Documento CAD em memória (Pure Node.js)
   */
  async parseCadFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const buffer = fs.readFileSync(filePath);
    const nasji = await this.getNasji();

    if (ext === '.dwg') {
      try {
        // Tenta ler nativamente em JS/TS via nasjidwg
        return nasji.readDwg(buffer);
      } catch (err) {
        console.warn(`[CadConverter] Leitura nativa DWG falhou (${err.message}). Tentando fallback para dwg2dxf...`);
        // Fallback: se houver dwg2dxf instalado
        const dxfPath = `${filePath}.dxf`;
        await this.dwgToDxfCli(filePath, dxfPath);
        const dxfBuffer = fs.readFileSync(dxfPath);
        if (fs.existsSync(dxfPath)) fs.unlinkSync(dxfPath);
        return nasji.readDxf(dxfBuffer);
      }
    } else if (ext === '.dxf') {
      return nasji.readDxf(buffer);
    } else {
      throw new Error(`Formato não suportado: ${ext}`);
    }
  }

  /**
   * Converte o documento CAD para SVG 2D (vetorial)
   */
  async toSvg(cadDoc, options = {}) {
    const nasji = await this.getNasji();
    const theme = options.theme || 'dark';
    const isDark = theme === 'dark';

    const bg = isDark ? '#12161f' : '#ffffff';
    const stroke = isDark ? '#4ade80' : '#0f172a';

    let svg = nasji.writeSvg(cadDoc, {
      background: bg,
      stroke: stroke,
      width: options.width || 1200
    });

    // CORREÇÃO CRUCIAL:
    // No AutoCAD, a Cor 7 é a cor lógica padrão (branco no CAD escuro / preto na plotagem em papel branco).
    // Quando exportado com fundo branco, linhas #ffffff ficam invisíveis (tudo branco).
    // Aqui garantimos que no tema 'light', traços brancos se tornem pretos (#0f172a).
    if (!isDark) {
      svg = svg.replace(/stroke="#ffffff"/gi, 'stroke="#0f172a"');
      svg = svg.replace(/stroke="white"/gi, 'stroke="#0f172a"');
      svg = svg.replace(/stroke="#fff"/gi, 'stroke="#0f172a"');
    } else {
      svg = svg.replace(/stroke="#000000"/gi, 'stroke="#4ade80"');
      svg = svg.replace(/stroke="black"/gi, 'stroke="#4ade80"');
    }

    // Calibra a espessura da linha caso a planta esteja desenhada em metros (viewBox < 20)
    svg = svg.replace(/stroke-width="0\.0[0-2][0-9]*"/gi, 'stroke-width="0.045"');

    return svg;
  }

  /**
   * Converte o documento CAD para imagem PNG (rasterizada de alta resolução)
   */
  async toPng(cadDoc, options = {}) {
    const theme = options.theme || 'dark';
    const isDark = theme === 'dark';
    const svgString = await this.toSvg(cadDoc, { ...options, theme });
    const width = options.width || 1920;

    return await sharp(Buffer.from(svgString), { density: 300 })
      .resize({ width, withoutEnlargement: true })
      .flatten({ background: isDark ? '#12161f' : '#ffffff' })
      .png({ quality: 95 })
      .toBuffer();
  }

  /**
   * Converte o documento CAD para PDF vetorial direto
   */
  async toPdf(cadDoc, options = {}) {
    const nasji = await this.getNasji();
    const pdfResult = nasji.writePdf(cadDoc, {
      width: options.width || 842,
      stroke: options.theme === 'light' ? 0x111111 : 0x22c55e
    });

    if (pdfResult && pdfResult.data) {
      return Buffer.from(pdfResult.data);
    }
    throw new Error('Falha ao gerar dados do PDF');
  }

  /**
   * Converte documento CAD para string DXF (DWG -> DXF em 100% JavaScript)
   */
  async toDxf(cadDoc) {
    const nasji = await this.getNasji();
    return nasji.writeDxf(cadDoc);
  }

  /**
   * Procura executável CLI de fallback no sistema se existir
   */
  findExecutable(name) {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const localPath = path.join(this.binDir, `${name}${ext}`);
    if (fs.existsSync(localPath)) return localPath;
    return name;
  }

  async dwgToDxfCli(dwgPath, dxfPath) {
    const exe = this.findExecutable('dwg2dxf');
    return new Promise((resolve, reject) => {
      execFile(exe, ['-y', '-o', dxfPath, dwgPath], (error) => {
        if (error) {
          return reject(new Error(`dwg2dxf CLI falhou: ${error.message}`));
        }
        resolve(dxfPath);
      });
    });
  }
}

module.exports = new CadConverter();
