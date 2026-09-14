# Home Builder com Blueprint3D original

Este repositório também é distribuído como o plugin `home-builder-cad`. Para usar em outra máquina:

```sh
pnpm install
pnpm build:blueprint
cp .env.example .env
pnpm start
```

O manifesto está em `.codex-plugin/plugin.json`. O pacote `home-builder-cad.zip` não inclui segredos, dependências instaladas ou conversões temporárias.

O projeto inteiro de [furnishup/blueprint3d](https://github.com/furnishup/blueprint3d) está incorporado em `vendor/blueprint3d/`, a partir do [fork completo](https://github.com/juliolimacostavalladares/blueprint3d). A página principal abre a aplicação original, com editor 2D, ambiente 3D, móveis, texturas e salvar/carregar. O motor 3D próprio anterior foi removido.

```sh
pnpm install
pnpm build:blueprint
pnpm start
```

Abra http://localhost:3000 (o servidor informa outra porta se estiver ocupada).

1. Selecione DWG/DXF ou a planta de exemplo e clique em **Interpretar CAD com IA**.
2. Acompanhe extração, vetorização, inventário, interpretação, adaptação e validação.
3. Confira as camadas originais ou as categorias por cores. Clique num elemento para consultar seus dados CAD e use os filtros da legenda.
4. Após validação, use **Edit Floorplan**, **Design** e **Add Items** no editor original. **Baixar .blueprint3d** exporta o estado atual.

A IA recebe o CAD completo, imagens e o contrato v2 do Blueprint3D no serviço 9Router configurado. Ela entrega diretamente o JSON nativo, com geometria, dimensões locais e proveniência. O código valida essa resposta sem reconstruir paredes por heurísticas. Conversões que não passam no validador não substituem o modelo anterior. Não há garantia de interpretação universal para CAD ambíguo. Alturas ausentes usam valores padrão indicados no relatório.

**Cores:** paredes verdes, pisos vermelhos, janelas roxas, portas marrons; legendas e IDs acompanham o SVG. É uma convenção visual do projeto. O piso é derivado das paredes, não inventado como entidade CAD original.

### API e validação

- `POST /api/blueprint3d/jobs`: upload multipart `file`; retorna ID para acompanhar em `GET /api/blueprint3d/jobs/:id`.
- `/outputs/<id>/`: DXF, imagem, SVG original, SVG de camadas, inventário JSON, interpretação, SVG semântico e relatório. Arquivo nativo só é publicado após validação.
- `POST /api/blueprint3d`: usa o mesmo fluxo de IA de `/jobs`; a conversão geométrica antiga foi retirada das rotas.
- `GET /api/blueprint3d/contract`: contrato completo de entrada/saída e catálogo de modelos nativos.
- Conversão técnica SVG/PNG/PDF/DXF e Humanizada IA continuam em `/cad.html`.

Configure `NINEROUTER_URL`, `NINEROUTER_KEY` e opcionalmente `CAD_BLUEPRINT_MODEL`. `pnpm test` verifica o motor original, regressões geométricas, rastreabilidade, cores, contrato da IA e pipeline com IA simulada, sem enviar plantas. Os testes do contrato v2 usam respostas controladas e verificam que a geometria da IA é preservada integralmente. A versão v2 ainda aguarda validação real do provedor. Veja [integration/UPSTREAM.md](integration/UPSTREAM.md).

Detalhes do fluxo atual em [docs/contrato-conversao-ia.md](docs/contrato-conversao-ia.md).

## Funcionalidades técnicas e IA existentes

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
