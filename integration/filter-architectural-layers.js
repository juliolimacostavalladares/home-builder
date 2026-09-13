const { readAiResponse } = require('./ai-response');

/**
 * Heurística de fallback para classificação de camadas CAD
 */
function heuristicFilter(layers) {
  const excludePattern = /telha|telhado|roof|cobertura|eletro|hidro|plumb|encanamento|esgoto|tubul|cota|dim|dimension|corte|section|fachada|elevat|carimbo|title|folha|selo|prancha|eixo_estrutura/i;
  const includePattern = /parede|wall|alvenaria|porta|door|janela|window|esquadria|abertur|room|ambien|comodo|piso|floor|arquitet/i;

  const include = [];
  const exclude = [];

  for (const layer of layers) {
    const name = layer.name;
    const sampleText = (layer.samples || []).join(' ');
    
    // Verificar se amostras indicam telhado, corte ou instalações
    if (excludePattern.test(name) || (sampleText && excludePattern.test(sampleText))) {
      exclude.push(name);
    } else if (includePattern.test(name) || (sampleText && includePattern.test(sampleText))) {
      include.push(name);
    } else if (layer.count > 0 && !excludePattern.test(name)) {
      // Se não for expressamente excluída e tiver geometria
      include.push(name);
    } else {
      exclude.push(name);
    }
  }

  // Garantir que ao menos uma camada de parede seja incluída
  if (!include.some(l => /parede|wall|alvenaria/i.test(l))) {
    const walls = layers.filter(l => /parede|wall|alvenaria/i.test(l.name)).map(l => l.name);
    if (walls.length) include.push(...walls);
  }

  return { include: [...new Set(include)], exclude: [...new Set(exclude)], method: 'heuristic' };
}

/**
 * Filtra camadas de um CAD usando IA (com fallback heurístico) para reter apenas
 * elementos arquitetônicos de planta baixa (paredes, portas, janelas, ambientes)
 * e descartar telhado/cobertura, cortes, fachadas, hidráulica/encanamento, elétrica e cotas.
 */
async function filterArchitecturalLayers(sourceEntities, blocks = {}, config = {}, { onProgress } = {}) {
  // 1. Mapear camadas e coletar estatísticas e amostras
  const layerMap = new Map();
  for (const entity of sourceEntities) {
    const name = entity.layer || '0';
    if (!layerMap.has(name)) {
      layerMap.set(name, { name, count: 0, types: new Set(), samples: new Set() });
    }
    const item = layerMap.get(name);
    item.count++;
    if (entity.type) item.types.add(entity.type);
    if (entity.name) item.samples.add(entity.name);
    if (entity.text && entity.text.trim().length > 1) {
      item.samples.add(entity.text.trim().slice(0, 30));
    }
  }

  const layers = Array.from(layerMap.values()).map(l => ({
    name: l.name,
    count: l.count,
    types: Array.from(l.types),
    samples: Array.from(l.samples).slice(0, 6)
  })).sort((a, b) => b.count - a.count);

  if (!layers.length) return { include: ['0'], exclude: [], method: 'default' };

  // Se houver poucas camadas e poucas entidades, não é necessário filtrar agressivamente
  if (layers.length <= 3 && sourceEntities.length < 500) {
    return { include: layers.map(l => l.name), exclude: [], method: 'all_small' };
  }

  // 2. Tentar classificar com IA via 9Router se configurado
  if (config.url) {
    try {
      onProgress?.('IA analisando camadas para filtrar telhado, encanamento, elétrica e cortes...');
      const endpoint = config.url.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1/chat/completions';
      const model = config.model || process.env.CAD_BLUEPRINT_MODEL || 'ag/claude-opus-4-6-thinking';

      const prompt = `Você é um arquiteto especialista em projetos CAD. Analise as camadas abaixo de um arquivo DWG/DXF e retorne SOMENTE um JSON válido com duas listas:
"include": lista de camadas essenciais da planta baixa (paredes, alvenaria, portas, janelas/esquadrias da planta, vãos, pisos e nomes de ambientes).
"exclude": lista de camadas que NÃO pertencem à planta baixa arquitetônica (cobertura/telhado, telhas, cortes, fachadas, instalações elétricas, hidráulica/encanamento, tubulações, cotas e anotações técnicas).

Camadas do projeto:
${JSON.stringify(layers, null, 2)}`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.key ? { Authorization: 'Bearer ' + config.key } : {})
        },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          model,
          stream: false,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (response.ok) {
        const text = await response.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          // pode ser SSE se o provedor ignorar stream: false
          json = await readAiResponse(new Response(text, { headers: response.headers }));
        }
        const content = json.choices?.[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
          if (Array.isArray(parsed.include) && parsed.include.length > 0) {
            // Validar que as camadas retornadas existem no CAD
            const validInclude = parsed.include.filter(name => layerMap.has(name));
            if (validInclude.length > 0) {
              return {
                include: validInclude,
                exclude: Array.isArray(parsed.exclude) ? parsed.exclude.filter(name => layerMap.has(name)) : [],
                method: 'ai',
                model
              };
            }
          }
        }
      }
    } catch (aiError) {
      console.warn('Aviso: Falha na classificação de camadas por IA, aplicando filtro heurístico:', aiError.message);
    }
  }

  // 3. Fallback heurístico
  return heuristicFilter(layers);
}

module.exports = { filterArchitecturalLayers, heuristicFilter };
