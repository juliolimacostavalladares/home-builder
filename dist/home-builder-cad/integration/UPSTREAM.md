# Blueprint3D original incorporado

**Fluxo atual: contrato v2.** A IA produz diretamente o documento nativo; o código apenas valida e importa. Consulte [contrato-conversao-ia.md](../docs/contrato-conversao-ia.md). As seções de conversão geométrica e os testes reais abaixo registram a implementação anterior; não descrevem as novas rotas de importação.

- Origem: https://github.com/furnishup/blueprint3d
- Fork completo: https://github.com/juliolimacostavalladares/blueprint3d
- Commit: `cac8b62c1a3839e929334bdc125bf8a74866be9e`
- Cópia integral versionável: `vendor/blueprint3d/` (fontes, aplicação example, modelos, texturas, bibliotecas e licença).
- Os arquivos originais não foram alterados. O `package-lock.json` adicional fixa o build legado.

`npm run build:blueprint` instala com o lockfile e executa o Grunt original. Os bundles gerados ficam no local esperado pelo próprio projeto: `example/js/blueprint3d.js` e `three.min.js`.

A rota `/blueprint3d/` serve o HTML original e acrescenta um único script da nossa aplicação, `public/blueprint-bridge.js`, antes de `example.js`. Esse adaptador captura a instância criada pelo exemplo e chama `model.loadSerialized`/`exportSerialized`. Todos os controles, desenhos, pisos, paredes, móveis e renderização continuam sendo os originais. Somente `example/` é servido publicamente.

O motor anterior `blueprint3d/`, o cliente Three.js próprio e `/api/floorplan-3d` foram removidos. A conversão CAD fica em `integration/`, sem importar o antigo motor.

## Contrato

`{ floorplan: { corners: { id: { x, y } }, walls: [{ corner1, corner2 }], wallTextures: [], floorTextures: {}, newFloorTextures: {} }, items: [] }`

As coordenadas nativas são centímetros. O conversor centraliza a origem e inverte Y. Recebe eixos diretamente ou infere eixos de pares de faces paralelas próximos à espessura informada. Interseções são divididas e duplicatas removidas. Vãos apoiados em blocos `P<n>` ou linhas de janelas reconhecidas recebem objetos InWallItem nativos.

A inferência não reconstrói CAD arbitrário com fidelidade garantida: curvas não viram paredes, espessuras muito diferentes da selecionada podem deixar trechos ausentes, portas/janelas sem padrão reconhecido precisam de edição e os pisos exigem ciclos fechados. A interface mostra extremidades abertas, premissas de alturas e advertências. Não há IA nem geração de malhas no conversor.

## Interpretação CAD por IA e auditoria visual

A interface principal agora usa `POST /api/blueprint3d/jobs` e consulta `GET /api/blueprint3d/jobs/:id`. O fluxo anterior permanece apenas como API geométrica de compatibilidade. A seção de limitações acima descreve essa API anterior.

O fluxo novo extrai DXF, SVG e PNG; preserva o DXF integral e inventaria os dados expostos pelo parser (entidades, handles, camadas, blocos, matrizes e posições mundiais). Envia inventário e imagens ao serviço configurado por `NINEROUTER_URL`/`NINEROUTER_KEY`. `CAD_BLUEPRINT_MODEL` seleciona o modelo; `CAD_BLUEPRINT_TIMEOUT_MS` limita cada chamada. Não são enviadas coordenadas geradas por pixels: a IA retorna somente papéis associados aos IDs existentes. Nenhuma resposta pode definir coordenadas livres. A classificação é validada e pode ser repetida uma vez com o diagnóstico da falha.

As posições são calculadas deterministicamente das entidades. O motor original valida os ciclos, triangulação de pisos e cobertura das identificações de ambientes. A importação no navegador só ocorre após sucesso; falhas preservam o modelo carregado. Isso não prova equivalência universal: plantas ambíguas, entidades não suportadas e semântica ausente podem ser recusadas. A classificação real ainda precisa ser avaliada com plantas representativas. Alturas não presentes no CAD continuam sendo premissas explícitas no relatório.

A vista semântica usa uma convenção do projeto, não um padrão universal de cores CAD: verde paredes, vermelho pisos derivados, roxo janelas, marrom portas, azul ambientes/cotas, turquesa equipamentos e cinza anotações/hachuras. Cada traço tem ID e ligação aos dados originais; filtros controlam a visibilidade. A vista de camadas originais tem paleta independente e não se apresenta como classificação da IA. Entidades que o renderizador semântico não desenha continuam no DXF/inventário e são contabilizadas na imagem.

Artefatos ficam em `outputs/<uuid>/`; são locais, servidos pela aplicação e não têm limpeza automática. O inventário da sessão mantém até 100 jobs e no máximo duas conversões simultâneas. Limites explícitos: 12000 instâncias, 12 níveis de blocos, 1,5 MB de inventário por chamada, 2000 segmentos estruturais. O processo recusa excessos sem truncar silenciosamente o CAD.

### Verificação real de setembro de 2026

A planta de exemplo foi interpretada pelo serviço 9Router autorizado. A classificação foi reutilizada após conferência do SHA-256 para testar correções do adaptador sem novas inferências. O resultado abriu no editor 2D/3D original: 12 regiões de piso, 16 identificações de ambientes cobertas e 20 vãos nativos. Há 13 arestas auxiliares de piso aberto; não contam como paredes físicas.

`floor_boundary` identifica uma borda CAD real de piso aberto. A integração `public/native-cad-properties.js` aplica altura/espessura zero nessas arestas pelas propriedades públicas do motor e preserva os campos adicionais ao salvar/carregar. Nas demais paredes, aplica a espessura inferida. Ligações entre a face CAD de piso e o eixo nativo são limitadas à meia espessura diagonal da parede. O código original continua intacto. Arquivos abertos fora desta integração, no exemplo upstream sem o adaptador, ignoram esses campos extras.

O verificador independente de segmentos bloqueia eixos ou trechos longos ausentes. Pequenos retornos/jambas cuja correspondência não pode comprovar ficam explicitamente no relatório (`sourceCoverage.unverifiedShortReturns`); arcos têm limites de discretização próprios. Esses casos impedem afirmar equivalência integral universal. A espessura inferida global também não prova equivalência de CAD com várias espessuras locais; alturas continuam premissas quando faltam no arquivo.

A API persiste jobs em disco; o link da conversão reabre o resultado sem novo upload. A leitura do provedor aceita JSON e SSE, e o inventário transportado usa referências às entidades originais para evitar metadados duplicados sem remover dados.
