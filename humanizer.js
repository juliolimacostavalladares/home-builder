const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

class FloorPlanHumanizer {
  constructor() {
    this.recraftToken = process.env.RECRAFT_API_TOKEN || 'ZS1mcfJHJbEuJqt847X4QNR6YdJrejHrIrdHIMN8qsfTBWqmaRwwbeYStJOlZEwi';
    this.nineRouterUrl = process.env.NINEROUTER_URL || 'http://10.0.0.107:20128/v1';
    this.nineRouterKey = process.env.NINEROUTER_KEY || 'sk-4d17a0a7e062b95e-dpfpwg-9d1ccc2f';
    this.defaultImageModel = 'cx/gpt-image-2.5';
  }

  /**
   * Ajusta o viewBox do SVG para formato 1:1 quadrado mantendo a proporção geométrica original
   * e centralizando a planta perfeitamente no centro da tela.
   */
  makeSvgSquare(svgString) {
    if (!svgString) return '';
    const vbRegex = /viewBox="([^"]+)"/;
    const match = svgString.match(vbRegex);
    if (!match) return svgString;
    const parts = match[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length !== 4) return svgString;

    let [x, y, w, h] = parts;
    if (w > h) {
      const diff = w - h;
      y -= diff / 2;
      h = w;
    } else if (h > w) {
      const diff = h - w;
      x -= diff / 2;
      w = h;
    }

    let newSvg = svgString.replace(vbRegex, `viewBox="${x} ${y} ${w} ${h}"`);
    newSvg = newSvg.replace(/width="[^"]+"/, 'width="1024"');
    newSvg = newSvg.replace(/height="[^"]+"/, 'height="1024"');
    return newSvg;
  }

  /**
   * Envia requisição para o 9Router (OpenAI-compatible) para gerar/refinar prompt arquitetônico
   */
  async generateArchitecturalPrompt(userStyle = 'modern', roomDescription = '', customNotes = '') {
    const defaultTemplates = {
      modern: 'High-end architectural 2D floor plan visualization, perfectly flat top-down orthographic view, strictly preserving original room layout and wall positions. Warm Scandinavian oak hardwood flooring in living room and bedrooms, contrasted with light grey matte porcelain tiles in kitchen and bathroom. Living room furnished with tailored modern sofa, coffee table, minimalist dining table. Comfortable beds with crisp neutral linens, built-in wardrobes. Modern kitchen with black granite countertop, stainless sink and cooktop. Glass shower enclosure in bathroom. Soft natural daylight, subtle interior drop shadows casting from structural walls, clean catalog aesthetic, photorealistic 8k textures.',
      luxury: 'Ultra-luxury architectural 2D floor plan render, perfectly flat top-down orthographic view, strictly preserving blueprint geometry. Polished Calacatta marble flooring with subtle brass inlays in living spaces, chevron dark walnut hardwood in bedrooms. High-end Italian designer furniture, velvet sofa, recessed architectural cove lighting, master suite with king-size bed and walk-in wardrobe, spa-like bathroom with glass shower, gourmet kitchen with waterfall marble island. Subtle ambient occlusion and realistic wall drop shadows.',
      scandinavian: 'Scandinavian style 2D floor plan visualization, flat top-down orthographic perspective, strictly preserving blueprint layout. Pale bleached pine wood flooring, minimalist white and beige aesthetic, comfortable grey linen sofa, light wood dining table with wishbone chairs, bedrooms with organic cotton bedding, bright airy natural daylight, potted plants, clean lines and soft shadows.',
      industrial: 'Industrial chic architectural 2D floor plan render, top-down flat orthographic view, strictly preserving blueprint geometry. Polished micro-cement and concrete flooring, exposed brick accents, cognac leather sofa, reclaimed wood coffee table, matte black metal fixtures, stainless steel and dark concrete countertops, warm subtle accent lighting and soft shadows.'
    };

    let basePrompt = defaultTemplates[userStyle] || defaultTemplates.modern;
    if (customNotes) {
      basePrompt += ` Specific client notes: ${customNotes}.`;
    }

    // Tenta conectar ao 9Router ativo
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout

      const baseUrl = this.nineRouterUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
      const endpoint = `${baseUrl}/v1/chat/completions`;

      const headers = { 'Content-Type': 'application/json' };
      if (this.nineRouterKey) headers['Authorization'] = `Bearer ${this.nineRouterKey}`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: 'ag/gemini-3.8-flash',
          messages: [
            {
              role: 'system',
              content: 'You are an elite architectural visualizer. Generate a concise, photorealistic prompt for generating a humanized 2D floor plan from an architectural CAD blueprint. Describe high-end flooring materials (wood, tiles), furniture layout, soft lighting, and realistic wall drop shadows. The image must be a perfectly flat top-down 2D orthographic plan strictly faithful to the blueprint wall positions.'
            },
            {
              role: 'user',
              content: `Style: ${userStyle}. Details: ${roomDescription || '2 bedroom apartment'}. Custom preferences: ${customNotes || 'none'}`
            }
          ],
          stream: false,
          max_tokens: 350
        })
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data.choices && data.choices[0] && data.choices[0].message) {
          let aiPrompt = data.choices[0].message.content.trim();
          aiPrompt = aiPrompt.replace(/^(\*\*.*?\*\*|#+.*?\n|>+)\s*/gim, '').trim();
          console.log('[9Router] Prompt arquitetônico gerado via 9Router:', aiPrompt.slice(0, 140) + '...');
          return aiPrompt;
        }
      } else {
        console.warn(`[9Router] Status HTTP ${res.status}, utilizando template.`);
      }
    } catch (err) {
      console.warn(`[9Router] Aviso: ${err.message}. Utilizando template.`);
    }

    return basePrompt;
  }

  /**
   * Prepara o SVG da planta para o modelo de IA:
   * Garante alto contraste (linhas pretas nítidas sobre fundo branco) e formato quadrado 1024x1024.
   * Retorna o buffer PNG rasterizado e o SVG quadrado correspondente (para sobreposição 100% precisa).
   */
  async prepareFloorPlanImage(svgString, targetWidth = 1024, targetHeight = 1024) {
    let cleanSvg = svgString;

    // Converte traços brancos para traços pretos arquitetônicos nítidos
    cleanSvg = cleanSvg.replace(/stroke="#ffffff"/gi, 'stroke="#0f172a"');
    cleanSvg = cleanSvg.replace(/stroke="white"/gi, 'stroke="#0f172a"');
    cleanSvg = cleanSvg.replace(/fill="#12161f"/gi, 'fill="#ffffff"');
    cleanSvg = cleanSvg.replace(/fill="#0d1117"/gi, 'fill="#ffffff"');

    // Assegura espessura visível de paredes
    cleanSvg = cleanSvg.replace(/stroke-width="[^"]+"/gi, 'stroke-width="0.05"');

    // Converte para viewBox quadrado perfeitamente centralizado
    const squareSvg = this.makeSvgSquare(cleanSvg);

    // Rasteriza em PNG de alta nitidez 1024x1024
    const buffer = await sharp(Buffer.from(squareSvg), { density: 200 })
      .resize(targetWidth, targetHeight, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .flatten({ background: '#ffffff' })
      .png({ quality: 100 })
      .toBuffer();

    return {
      buffer,
      squareSvg
    };
  }

  /**
   * Executa a humanização da planta via 9Router (OpenAI Codex - cx/gpt-image-2.5) ou Recraft
   */
  async humanizeFloorPlan(imageBuffer, options = {}) {
    const style = options.style || 'modern';
    const strength = options.strength !== undefined ? Number(options.strength) : 0.40;
    const customNotes = options.customNotes || '';
    const requestedModel = options.model || this.defaultImageModel;

    // 1. Gera prompt arquitetônico especializado (prioriza a interpretação profunda do CAD via IA)
    const prompt = options.promptOverride ||
                   options.cadAnalysis?.imageGenerationPrompt ||
                   await this.generateArchitecturalPrompt(style, options.description, customNotes);

    // 2. Determina o motor: 9Router (padrão) ou Recraft
    const isRecraft = requestedModel.toLowerCase().startsWith('recraft');

    if (!isRecraft) {
      // MOTOR 9ROUTER (cx/gpt-image-2.5, cx/gpt-image-2.5-flare, etc.)
      const baseUrl = this.nineRouterUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
      const endpoint = `${baseUrl}/v1/images/generations`;

      console.log(`[9Router Image] Enviando para ${endpoint} usando modelo: ${requestedModel}...`);

      const headers = {
        'Content-Type': 'application/json'
      };
      if (this.nineRouterKey) {
        headers['Authorization'] = `Bearer ${this.nineRouterKey}`;
      }

      const b64DataUrl = 'data:image/png;base64,' + imageBuffer.toString('base64');
      const enhancedPrompt = `${prompt} STRICT INSTRUCTION: This is an exact 2D top-down architectural floor plan humanization. You must strictly preserve the wall layout, room divisions, door openings, and proportions shown in the input reference floor plan image. Add realistic flooring textures, furniture layout, lighting, and soft drop shadows.`;

      const payload = {
        model: requestedModel,
        prompt: enhancedPrompt,
        image: b64DataUrl,
        size: '1024x1024',
        image_detail: 'high',
        output_format: 'png',
        response_format: 'b64_json'
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Erro na API 9Router (${res.status}): ${errText}`);
      }

      const data = await res.json();
      if (!data.data || !data.data[0]) {
        throw new Error('9Router não retornou dados de imagem válidos.');
      }

      let resultBuffer;
      let remoteUrl = null;

      if (data.data[0].b64_json) {
        resultBuffer = Buffer.from(data.data[0].b64_json, 'base64');
      } else if (data.data[0].url) {
        remoteUrl = data.data[0].url;
        const imgRes = await fetch(remoteUrl);
        resultBuffer = Buffer.from(await imgRes.arrayBuffer());
      } else {
        throw new Error('9Router não retornou nem b64_json nem url.');
      }

      return {
        remoteUrl,
        imageBuffer: resultBuffer,
        prompt,
        model: requestedModel,
        provider: '9Router (OpenAI Codex)'
      };

    } else {
      // MOTOR RECRAFT (v4.1)
      console.log(`[Recraft Image] Enviando para API Recraft usando modelo: ${requestedModel}...`);
      const blob = new Blob([imageBuffer], { type: 'image/png' });
      const formData = new FormData();
      formData.append('image', blob, 'floorplan.png');
      formData.append('prompt', prompt);
      formData.append('strength', strength.toString());
      formData.append('model', requestedModel || 'recraftv4_1');

      const res = await fetch('https://external.api.recraft.ai/v1/images/imageToImage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.recraftToken}`
        },
        body: formData
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Erro na API Recraft (${res.status}): ${errText}`);
      }

      const data = await res.json();
      if (!data.data || !data.data[0] || !data.data[0].url) {
        throw new Error('Recraft não retornou a URL da imagem humanizada.');
      }

      const remoteUrl = data.data[0].url;
      const imgRes = await fetch(remoteUrl);
      const resultBuffer = Buffer.from(await imgRes.arrayBuffer());

      return {
        remoteUrl,
        imageBuffer: resultBuffer,
        prompt,
        model: requestedModel,
        provider: 'Recraft AI',
        creditsUsed: data.credits || 35
      };
    }
  }
}

module.exports = new FloorPlanHumanizer();
