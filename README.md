# CAD 2D & Planta Humanizada com IA (9Router + OpenAI Codex)

Solução completa em **Node.js** para engenharia e arquitetura que converte arquivos **DWG e DXF** em:
1. **Plantas Técnicas 2D:** SVG vetorial nítido (com zoom infinito), PNG de alta resolução e PDF pronto para plotagem.
2. **Raio-X de Cômodos (DXF Deep Extraction):** Extração de dados brutos do CAD (nomes de ambientes, coordenadas, louças sanitárias, equipamentos de cozinha, portas e cotas) interpretados via IA.
3. **Planta Humanizada Foto-Realista:** Renderização fidedigna com o modelo **`cx/gpt-image-2.5`** (OpenAI Codex via 9Router) posicionando os móveis e acabamentos rigorosamente nos cômodos corretos.
4. **Auditoria de Fidelidade:** Ferramentas visuais interativas para comparar e verificar o desenho: **Sobrepor Traçado CAD**, visualização **Lado a Lado** e **Cortina Antes/Depois**.

---

## 🚀 Arquitetura e Tecnologias

- **Motor CAD:** 100% JavaScript nativo (`nasjidwg` + `sharp`), sem dependência de AutoCAD ou executáveis C++.
- **Extração Semântica (`cadAnalyzer.js`):** Lê o DXF bruto e identifica textos de cômodos (`DORMI`, `COZINH`, `WC`, `ESTAR`), blocos sanitários (`VASOSA`, `LAVAT`), cozinha (`FOGÃO`, `PIA`, `GELADEIRA`), esquadrias e dimensões.
- **Interpretação por IA (9Router LLM):** Envia os metadados técnicos brutos para o 9Router (`ag/gemini-3.8-flash`) para determinar a função, piso e mobília de cada ambiente.
- **Renderização Humanizada (9Router Codex Image):** Utiliza **`cx/gpt-image-2.5`** via `/v1/images/generations` gerando uma vista ortográfica 2D estrita alinhada ao traçado CAD original.
- **Motor Alternativo:** Suporte ao Recraft API v4.1.

---

## 📦 Instalação e Execução

```bash
# 1. Instalar dependências
pnpm install # ou npm install

# 2. Iniciar o servidor
pnpm start # ou node server.js
```

Acesse no navegador:
```text
http://localhost:3000
```

---

## 🎨 Funcionalidades da Interface Web

- **Aba "Planta 2D":**
  - Converte DWG/DXF para SVG, PNG, PDF ou DXF.
  - Temas: *Paper White* (fundo branco com traço preto) e *Dark Blueprint* (fundo escuro com traço verde).
  - Pan & Zoom interativo no viewport.
- **Aba "Humanizada IA":**
  - Seletor de modelos de imagem: `cx/gpt-image-2.5` (Recomendado), `cx/gpt-image-2.5-flare`, `cx/gpt-image-2`, `recraftv4_1`.
  - Estilos de decoração: *Moderno*, *Alto Padrão / Luxo*, *Escandinavo*, *Industrial Urbano*.
  - Slider de Fidelidade Estrutural (Strength).
  - Observações customizadas (ex: *"piso amadeirado claro, bancada preta na cozinha"*).
  - **Botão `🔍 Raio-X dos Cômodos`:** Analisa os metadados do DWG/DXF e exibe instantaneamente a lista de ambientes, localização, louças/eletros detectados e pisos sugeridos.
  - **Botão `✨ Gerar Humanizada`:** Dispara a geração completa da planta humanizada.
- **Barra de Auditoria de Fidelidade:**
  - **🎯 Sobrepor Traçado:** Desenha as linhas vetoriais do CAD diretamente sobre o render humanizado com controle de opacidade (0% a 100%) e paleta de cores (Vermelho, Ciano, Verde, Preto, Branco).
  - **📑 Lado a Lado:** Compara a planta técnica CAD original e a planta humanizada em cards sincronizados.
  - **🌓 Cortina:** Divisor deslizante estilo "antes e depois".

---

## 📡 Endpoints da API

### 1. Raio-X dos Cômodos (Análise Semântica do CAD)
`POST /api/analyze-cad`
- **Body (Multipart Form):** `file`: arquivo `.dwg` ou `.dxf`
- **Retorno:** JSON com lista de cômodos, coordenadas, louças e equipamentos identificados, pisos sugeridos e mobília.

### 2. Gerar Planta Humanizada
`POST /api/humanize`
- **Body (Multipart Form):**
  - `file`: Arquivo `.dwg`, `.dxf` ou `.svg`
  - `model`: `cx/gpt-image-2.5` (padrão)
  - `style`: `modern`, `luxury`, `scandinavian`, `industrial`
  - `strength`: `0.40`
  - `customNotes`: texto opcional
- **Query Param:** `format=json` (padrão) ou `format=image` (retorna bytes PNG diretamente).

### 3. Conversão Técnica 2D
`POST /api/convert?format=svg&theme=light`
- Suporta formatos: `svg`, `png`, `pdf`, `dxf`.

### 4. Diagnóstico
`GET /api/status`

---

## 📂 Estrutura do Projeto

```text
├── 2 quartos - 70m2.dwg    # Arquivo DWG de teste de 2 dormitórios
├── cadAnalyzer.js          # Extrator de metadados DXF e interpretação semântica com IA
├── converter.js            # Motor 100% JS para DWG -> SVG/PNG/PDF/DXF
├── humanizer.js            # Integração 9Router (cx/gpt-image-2.5) e Recraft
├── server.js               # Servidor Express com fallback automático de portas
├── public/
│   └── index.html          # Interface web completa com auditoria de fidelidade
└── outputs/                # Imagens geradas e auditorias de traçado
```
