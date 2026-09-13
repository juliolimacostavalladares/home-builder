# CAD → Blueprint3D: contrato executável v2

A IA recebe o contexto técnico completo e gera o documento de destino. O aplicativo não reconstrói paredes a partir de uma lista de categorias. A importação exige o JSON nativo completo, coordenadas, dimensões locais e proveniência; não existe fallback para o conversor geométrico anterior.

O contrato de referência é [`integration/contracts/cad-blueprint3d-v2.json`](../integration/contracts/cad-blueprint3d-v2.json), disponibilizado também em `GET /api/blueprint3d/contract`. Esse mesmo catálogo alimenta o prompt, a validação de categorias, as cores e as legendas. `runtimeContract()` acrescenta dimensões medidas dos modelos originais de porta/janela, sem expor segredos ou parâmetros de rede.

## Contexto entregue à IA

- DXF completo, inclusive o texto bruto, e metadados expostos pelo parser.
- Entidades, handles, camadas, blocos, hierarquia, matrizes e coordenadas WCS.
- Imagem original e vista por camadas, sem deduzir medidas a partir de pixels.
- Contrato de coordenadas, unidades, cantos, paredes, pisos e objetos do Blueprint3D.
- Catálogo arquitetônico de paredes, retornos, pisos, portas, janelas, pilares, vigas, lajes, cobertura, escadas, rampas, níveis, fundações, instalações, equipamentos e documentação técnica.
- Capacidades e limitações reais do destino; premissas devem ser identificadas.

`source` conserva cada entidade completa; `instances.entityRef` evita repetir os dados dos blocos no transporte. O inventário gravado mantém ambos, além do DXF bruto. O limite de contexto é explícito; dados não são truncados silenciosamente.

## Responsabilidade da IA

A IA interpreta a função de cada entidade, agrupa representações do mesmo elemento, escolhe os eixos e junções equivalentes, entrega cantos compartilhados/interseções divididas e associa os vãos às paredes. Ela produz `design`, `transform`, `assignments`, `provenance`, `assumptions` e `notes` no contrato v2. Espessura e altura pertencem a cada parede; não há inferência global posterior nem ajuste automático dos valores produzidos.

`wall_detail` permite relacionar retorno/batente à parede ou ao vão que o representa. `floor_boundary` representa a borda física de piso aberto pelas propriedades públicas do motor, sem altura. A IA justifica as relações; IDs de exemplo, prefixos de bloco, cores e contagens de cômodos não são regras de conversão.

## Responsabilidade do código

O código transporta e valida: esquema, unidades, referências, recursos locais permitidos, proveniência completa dos elementos físicos, duplicação, sobreposição, interseções, colocação dos vãos e pisos no motor original. Ele não move cantos, emparelha faces, fecha lacunas ou cria geometria da resposta. Um erro é devolvido à IA com sua resposta anterior, com no máximo duas tentativas; o modelo carregado permanece até uma resposta válida.

Os artefatos `conversion-contract.json`, `conversion-map.json`, `interpretation-*.json`, `inventory.json` e `report.json` permitem conferir o processo. O `.blueprint3d` contém a geometria recebida da IA. A suíte usa respostas controladas com espessuras diferentes e verifica que essa geometria permanece idêntica.

Os módulos geométricos antigos permanecem apenas para regressões históricas; nenhuma rota de importação chama `convertDxf`, `centerlines`, `inferSettings`, `repairJunctions` ou `addOpenings`. `POST /api/blueprint3d` e `/api/blueprint3d/jobs` usam o mesmo fluxo novo. Resultados históricos salvos continuam legíveis e são identificados na interface.

## Limites que fazem parte do contrato

O Blueprint3D original representa uma planta plana, paredes retas, pisos por ciclos e objetos de catálogo. Ter uma categoria arquitetônica não cria automaticamente suporte paramétrico no destino. Lajes estruturais, coberturas inclinadas, níveis adicionais, vigas e instalações sem correspondente implementado ficam preservados e declarados, nunca disfarçados de paredes ou decoração. A validação técnica não demonstra, sozinha, que toda interpretação semântica da IA está correta.

A separação entre primitivas gráficas e componentes arquitetônicos é compatível com a [referência DXF da Autodesk](https://help.autodesk.com/cloudhelp/2023/ENU/AutoCAD-DXF/files/GUID-A35B8C2A-1885-4A8E-8533-E61D8A423D62.htm) e com o catálogo de elementos do [IFC da buildingSMART](https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcBuiltElement.htm). Este contrato é próprio da integração; não se apresenta como implementação completa de IFC.
