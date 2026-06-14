# TCC Map

## Arquivos Principais

- `docs/tcc/PRINCIPAL.tex`: arquivo mestre do TCC.
- `docs/tcc/CapI_Introducao.tex`: problema, objetivos e justificativa.
- `docs/tcc/CapII_RefTeorico.tex`: revisao teorica e trabalhos relacionados.
- `docs/tcc/CapIII_MateriaisMetodos.tex`: metodologia, requisitos, arquitetura,
  modelagem e protocolo de validacao.
- `docs/tcc/CAPIV_Resultados.tex`: implementacao observada, telas, evidencias e
  sintese da validacao funcional.
- `docs/tcc/CapV_TestesRes.tex`: conclusao, contribuicoes, limites e trabalhos futuros.
- `docs/tcc/TCC.bib`: referencias bibliograficas.

## Automacao

- `scripts/compile_tcc_pdf.ps1`: recompila `docs/tcc/PRINCIPAL.pdf`.
- `scripts/check_tcc_all.ps1`: recompila e resume o status do PDF, referencias,
  citacoes e erros de LaTeX em um unico comando.
- `scripts/watch_tcc.ps1`: observa alteracoes em `docs/tcc` e recompila o TCC
  automaticamente apos salvar arquivos relevantes.

## Leitura Por Tipo de Pedido

- Coerencia de requisito/modelagem: Capitulo III + `docs/context/20-application-map.md`.
- Evidencia e resultados: Capitulo IV + `docs/context/40-evidence-map.md`.
- Conclusao: Capitulo V + objetivos do Capitulo I + evidencias do Capitulo IV.
- Citacao/referencia: trecho afetado + `TCC.bib`; nao copiar texto de PDFs.
- Comentarios do professor: `docs/context/pdf/pdf-index.md` e cache de PDF.

## Pontos Sensíveis

- Nao prometer validacao fisica de sensor/gateway.
- Nao adicionar linhas de validacao sem evidencia.
- Evitar tom generico: cada paragrafo deve apontar para o prototipo, a literatura
  citada ou a delimitacao experimental.
- Manter a cadeia: problema -> objetivos -> metodologia -> resultados -> conclusao.
