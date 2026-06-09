# Instrucoes Locais do InventoryRFID

Estas instrucoes complementam `~/.codex/AGENTS.md`. Para assuntos de dominio,
TCC, arquitetura, evidencias e comandos deste projeto, siga este arquivo antes
das regras globais.

## Objetivo do Projeto

InventoryRFID e um prototipo web para inventario patrimonial com apoio de RFID.
O sistema combina backend Django REST, frontend Next.js, banco SQLite local e
scripts de comunicacao RFID. O TCC deve descrever o que foi implementado e
validado, sem ampliar a evidencia alem do prototipo.

## Stack e Comandos Principais

- Backend: `backend/`, Django REST Framework, SQLite local.
- Frontend: `frontend/`, Next.js, TypeScript.
- TCC: `docs/tcc/PRINCIPAL.tex`, abnTeX2/MiKTeX.
- Scripts RFID e utilitarios: `scripts/`.

Comandos vencedores no Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\compile_tcc_pdf.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\extract_pdf_text.ps1 -PdfPath C:\Users\ezequiel.oliveira\Downloads\Rascunho_TCC_V5.pdf
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\search_pdf_cache.ps1 -Query "Figura ilegivel"
cd backend; python manage.py test
cd frontend; npm.cmd run lint
```

`latexmk` pode falhar neste ambiente porque o MiKTeX exige Perl. Para compilar o
TCC, prefira `scripts/compile_tcc_pdf.ps1`, que usa `pdflatex + bibtex`.

## Ordem Obrigatoria de Leitura

1. Leia este `AGENTS.md`.
2. Leia o mapa curto relevante em `docs/context/`.
3. Para texto academico, abra somente os capitulos afetados em `docs/tcc/`.
4. Para comportamento do sistema, confirme no codigo/testes antes de afirmar no TCC.
5. Para PDFs, busque primeiro no cache/indice antes de abrir o PDF completo.

## Mapas Locais

| Assunto | Documento | Fonte principal |
| --- | --- | --- |
| Resumo do projeto | `docs/context/00-project-brief.md` | `README.md` |
| Estrutura do TCC | `docs/context/10-tcc-map.md` | `docs/tcc/*.tex` |
| Aplicacao/codigo | `docs/context/20-application-map.md` | `backend/`, `frontend/`, `scripts/` |
| Diagramas | `docs/context/30-diagrams-map.md` | `docs/tcc/figs/` |
| Evidencias | `docs/context/40-evidence-map.md` | `CAPIV_Resultados.tex`, testes e screenshots |
| PDFs | `docs/context/pdf/pdf-index.md` | cache em `~/.codex/cache/inventoryrfid-pdf/` |

## Regras Academicas

- Fonte de verdade para comportamento: codigo e testes.
- Fonte de verdade para evidencia: Capitulo IV, screenshots e testes executados.
- Fonte de verdade para figuras no texto: arquivo renderizado/incluido no PDF.
- Nao transformar possibilidade tecnica em resultado validado.
- A validacao fisica fica limitada ao leitor RFID de proximidade, uma tag,
  comunicador intermediario e API.
- Fluxos de sensor/gateway ou leitores em rede podem aparecer como verificacao
  funcional por software ou expansao futura, nao como validacao fisica completa.
- Em tabelas de validacao, inclua apenas cenarios sustentados por evidencia local.

## Busca e Economia de Tokens

- Use primeiro `docs/context/` para decidir quais arquivos abrir.
- Use `rg` com escopo reduzido, por exemplo `rg -n "resolver" backend/core`.
- Evite abrir PDFs inteiros; use `scripts/extract_pdf_text.ps1` e
  `scripts/search_pdf_cache.ps1`.
- Para comparar texto do PDF, extraia com Poppler e compare trechos relevantes.
- Para diagramas, confira texto do capitulo, fonte editavel e render usado no TCC.

## Verificacao

- Mudanca textual no TCC: compilar `scripts/compile_tcc_pdf.ps1` e checar
  `docs/tcc/PRINCIPAL.log` para referencias indefinidas.
- Mudanca em evidencia/validacao: comparar Capitulo III, Capitulo IV e testes.
- Mudanca tecnica: rodar testes do backend relevantes e sincronizar README/TCC se
  a descricao do comportamento mudar.

## Aprendizagem Local

Registre achados locais nos mapas em `docs/context/` quando eles evitarem
redescoberta. Se a regra servir para outros projetos, registre um resumo global
em `~/.codex/knowledge/` conforme a regra `1 vez resolve / 2 registra / 3 promove`.
