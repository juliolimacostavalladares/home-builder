const DxfParser = require('dxf-parser');

class CadAnalyzer {
  /**
   * Decodifica caracteres Unicode do padrão AutoCAD DXF (ex: \U+00F3 -> ó, \U+00C3 -> Ã)
   */
  decodeDxfUnicode(str) {
    if (!str) return '';
    return str.replace(/\\U\+([0-9A-Fa-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }

  /**
   * Extrai metadados completos de cômodos, equipamentos, louças e cotas do DXF
   */
  extractMetadata(dxfString) {
    const parser = new DxfParser();
    let parsed;
    try {
      parsed = parser.parseSync(dxfString);
    } catch (err) {
      console.warn('Erro ao parsear DXF com DxfParser:', err.message);
      return { rooms: [], fixtures: [], doors: [], dimensions: [], areaInfo: null };
    }

    const blocks = parsed.blocks || {};
    const entities = parsed.entities || [];

    const extracted = {
      rooms: [],
      fixtures: [],
      doors: [],
      dimensions: [],
      areaInfo: null
    };

    const fixtureKeywords = [
      { keys: ['VASOSA', 'VASO', 'BACIA'], label: 'Vaso Sanitário (Toilet)' },
      { keys: ['LAVAT', 'CUBA', 'LAVATORIO'], label: 'Lavatório / Cuba de Banheiro (Bathroom Sink)' },
      { keys: ['FOG', 'COOKTOP'], label: 'Fogão / Cooktop (Stove)' },
      { keys: ['PIA'], label: 'Pia de Cozinha / Cuba Inox (Kitchen Sink)' },
      { keys: ['GELAD', 'REFRIG'], label: 'Geladeira / Refrigerador (Refrigerator)' },
      { keys: ['CHUV', 'DUCHA', 'BOX'], label: 'Chuveiro / Ducha (Shower)' },
      { keys: ['TANQUE', 'LAVA_ROUPA', 'MAQ'], label: 'Tanque / Lavanderia (Washing Machine)' }
    ];

    // 1. Analisa blocos inseridos (INSERTS)
    entities.filter(e => e.type === 'INSERT').forEach(ins => {
      const rawName = this.decodeDxfUnicode(ins.name || '');
      const pos = {
        x: Number((ins.position?.x || 0).toFixed(2)),
        y: Number((ins.position?.y || 0).toFixed(2))
      };
      const blockDef = blocks[ins.name];

      // Detecta se o bloco contém texto de identificação de cômodo
      if (blockDef && blockDef.entities) {
        blockDef.entities.forEach(be => {
          if (be.type === 'TEXT' || be.type === 'MTEXT') {
            const text = this.decodeDxfUnicode(be.text).trim();
            if (/área total/i.test(text)) {
              extracted.areaInfo = { text, position: pos };
            } else if (text && text.length > 1 && !/^\d+(\.\d+)?$/.test(text)) {
              extracted.rooms.push({
                name: text,
                blockName: rawName,
                position: pos
              });
            }
          }
        });
      }

      // Detecta equipamentos e louças fixas
      const upperName = rawName.toUpperCase();
      for (const item of fixtureKeywords) {
        if (item.keys.some(k => upperName.includes(k))) {
          extracted.fixtures.push({
            type: item.label,
            blockName: rawName,
            position: pos
          });
          break;
        }
      }

      // Detecta portas
      if (/^P\d+/i.test(rawName) || /porta/i.test(rawName)) {
        extracted.doors.push({
          blockName: rawName,
          position: pos
        });
      }
    });

    // 2. Analisa textos avulsos do espaço do modelo
    entities.filter(e => e.type === 'TEXT' || e.type === 'MTEXT').forEach(te => {
      const text = this.decodeDxfUnicode(te.text).trim();
      const pos = {
        x: Number((te.startPoint?.x || te.position?.x || 0).toFixed(2)),
        y: Number((te.startPoint?.y || te.position?.y || 0).toFixed(2))
      };

      if (/^\d+\.\d+$/.test(text)) {
        extracted.dimensions.push(text);
      } else if (/área/i.test(text) || /\d+\s*m/i.test(text)) {
        extracted.areaInfo = extracted.areaInfo || { text, position: pos };
      } else if (text.length > 2 && !/^\d+$/.test(text)) {
        // Ignora anotações técnicas comuns de prancha que não são cômodos
        const isTechnicalNote = /^(escala|esc\.?|prancha|folha|desenho|projeto|autor|data|rev|revis[ãa]o|cota|cotas|n[ií]vel|nv\.?|norte|detalhe|corte|eleva[çc][ãa]o)\b/i.test(text) || /^\d+[\s\/\.:xX-]\d+$/.test(text);
        if (!isTechnicalNote && !extracted.rooms.some(r => r.name.toLowerCase() === text.toLowerCase())) {
          extracted.rooms.push({
            name: text,
            blockName: 'TEXT_ENTITY',
            position: pos
          });
        }
      }
    });

    return extracted;
  }

  /**
   * Usa LLM via 9Router para interpretar os dados brutos e gerar:
   * 1. Detalhamento de cada cômodo da residência
   * 2. Móveis e materiais adequados por ambiente
   * 3. Prompt arquitetônico de alta fidelidade
   */
  async interpretLayoutWithAi(cadMetadata, userStyle = 'modern', customNotes = '', nineRouterUrl, nineRouterKey, options = {}) {
    const url = (nineRouterUrl || process.env.NINEROUTER_URL || 'http://10.0.0.107:20128/v1').replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1/chat/completions';
    const key = nineRouterKey || process.env.NINEROUTER_KEY || 'sk-4d17a0a7e062b95e-dpfpwg-9d1ccc2f';
    const timeoutMs = options.timeoutMs || parseInt(process.env.CAD_AI_TIMEOUT_MS, 10) || 120000; // 120s timeout padrão para plantas complexas
    const model = options.model || process.env.CAD_ANALYZER_MODEL || 'ag/gemini-3.8-flash';
    const allowFallback = options.allowFallback ?? (options.noFallback !== true && process.env.CAD_ALLOW_FALLBACK !== 'false');

    const prompt = `Analise os seguintes dados técnicos brutos extraídos diretamente do arquivo CAD (DWG/DXF):
- Cômodos e textos encontrados na planta (com coordenadas): ${JSON.stringify(cadMetadata.rooms)}
- Equipamentos e louças fixas encontradas (com coordenadas): ${JSON.stringify(cadMetadata.fixtures)}
- Portas e acessos: ${cadMetadata.doors.length} portas identificadas
- Informação de Área: ${JSON.stringify(cadMetadata.areaInfo)}
- Estilo decorativo desejado: ${userStyle}
- Preferências adicionais do cliente: ${customNotes || 'Nenhuma'}

INSTRUÇÕES IMPORTANTES:
1. Filtre apenas os ambientes/cômodos reais da residência (descarte carimbos de prancha, escalas, títulos de projeto, notas de revisão e cotas).
2. Para cada cômodo válido, deduza sua função arquitetônica, localização espacial na planta, revestimento de piso condizente com o estilo (${userStyle}) e mobília/layout sugerido.
3. Se foram detectados equipamentos/louças fixas, vincule-os aos cômodos correspondentes pelas coordenadas.

Responda em formato JSON rigoroso (sem markdown adicional fora do bloco JSON) com a seguinte estrutura:
{
  "residenceSummary": "Breve resumo da residência (ex: Residência contemporânea de 3 dormitórios com 120m²)",
  "roomsAnalysis": [
    {
      "name": "Nome do Cômodo (ex: Suíte Master / Dormitório 1)",
      "location": "Localização na planta (ex: Ala Leste / Superior Direito)",
      "identifiedFixtures": ["Equipamentos encontrados nas coordenadas deste cômodo"],
      "flooring": "Piso sugerido para este cômodo de acordo com o estilo",
      "staging": "Móveis e decoração específicos para este cômodo respeitando a disposição da planta"
    }
  ],
  "imageGenerationPrompt": "Prompt arquitetônico em inglês altamente detalhado para alimentar a IA geradora de imagem (cx/gpt-image-2.5), descrevendo cada cômodo explicitamente por sua função, materiais de piso, móveis e posição das bancadas/louças identificadas no CAD, em vista superior ortográfica 2D estrita (top-down 90-degree orthographic view, completely flat, no tilt)."
}`;

    let lastError = null;
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[CadAnalyzer] Analisando ${cadMetadata.rooms.length} cômodos via IA (${model}) no 9Router (tentativa ${attempt}/${maxAttempts}, timeout: ${Math.round(timeoutMs / 1000)}s)...`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json'
          },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'system',
                content: 'Você é um arquiteto especialista em projetos executivos e plantas humanizadas. Analise os metadados técnicos do CAD e forneça a interpretação arquitetônica exata de cada cômodo em JSON rigoroso.'
              },
              { role: 'user', content: prompt }
            ],
            stream: false
          })
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`9Router chat HTTP ${res.status}: ${errText || res.statusText}`);
        }

        const data = await res.json();
        let rawContent = data.choices?.[0]?.message?.content || '';
        let cleaned = rawContent.trim();
        const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (match) {
          cleaned = match[1].trim();
        } else {
          const firstBrace = cleaned.indexOf('{');
          const lastBrace = cleaned.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            cleaned = cleaned.substring(firstBrace, lastBrace + 1);
          }
        }

        const parsedJson = JSON.parse(cleaned);
        console.log('[CadAnalyzer] Análise arquitetônica de cômodos concluída com sucesso via 9Router (IA).');
        return parsedJson;
      } catch (err) {
        lastError = err;
        console.warn(`[CadAnalyzer] Falha na tentativa ${attempt} com IA (${err.message}).`);
        if (attempt < maxAttempts) {
          console.log('[CadAnalyzer] Retentando chamada da IA em 1.5s...');
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    }

    if (!allowFallback) {
      throw new Error(`[CadAnalyzer] Falha ao analisar com IA: ${lastError?.message || 'Sem resposta do 9Router'}`);
    }

    console.warn(`[CadAnalyzer] Todas as tentativas com IA falharam (${lastError?.message}). Usando fallback arquitetônico.`);
    return this.createFallbackAnalysis(cadMetadata, userStyle, customNotes);
  }

  /**
   * Fallback heurístico inteligente estruturado
   */
  createFallbackAnalysis(cadMetadata, userStyle, customNotes) {
    const rooms = cadMetadata.rooms.map((r, i) => {
      const isKitchen = /cozinh/i.test(r.name);
      const isBath = /wc|b\.h|banh/i.test(r.name);
      const isBed = /dormi|quarto/i.test(r.name);
      const isLiving = /estar|sala/i.test(r.name);

      let flooring = 'Piso vinílico amadeirado carvalho claro';
      let staging = 'Mobiliário contemporâneo planejado sob medida';
      let fixtures = [];

      if (isKitchen) {
        flooring = 'Porcelanato cinza acetinado 80x80cm';
        staging = 'Bancada em granito escuro com cooktop, pia de inox e geladeira de embutir';
        fixtures = cadMetadata.fixtures.filter(f => /fog|pia|gelad/i.test(f.type)).map(f => f.type);
      } else if (isBath) {
        flooring = 'Porcelanato cinza acetinado antiderrapante';
        staging = 'Bancada com cuba esculpida, bacia sanitária moderna e box de vidro temperado';
        fixtures = cadMetadata.fixtures.filter(f => /vaso|lavat|chuv/i.test(f.type)).map(f => f.type);
      } else if (isBed) {
        staging = i === 0 ? 'Cama queen-size com cabeceira estofada, criados-mudos e guarda-roupa espelhado' : 'Cama box casal ou solteiro com bancada de estudos integrada';
      } else if (isLiving) {
        staging = 'Sofá retrátil cinza claro, mesa de centro, painel ripado de TV e mesa de jantar 4 lugares';
      }

      return {
        name: r.name,
        location: `Posição CAD (${r.position.x}, ${r.position.y})`,
        identifiedFixtures: fixtures,
        flooring,
        staging
      };
    });

    const prompt = `Top-down 2D orthographic architectural floor plan rendering, perfectly flat 90-degree aerial view, style: ${userStyle}. Layout contains: ${rooms.map(r => `${r.name} with ${r.flooring} and ${r.staging}`).join('; ')}. Clean white walls with crisp black outlines, warm natural illumination, soft drop shadows. Strict fidelity to CAD geometry.`;

    return {
      residenceSummary: `Residência com ${rooms.length} cômodos identificados no CAD (${cadMetadata.areaInfo?.text || '70m²'})`,
      roomsAnalysis: rooms,
      imageGenerationPrompt: prompt
    };
  }
}

module.exports = new CadAnalyzer();
