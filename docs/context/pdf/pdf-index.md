# PDF Index

## Objetivo

Evitar releitura completa de PDFs. Extraia PDFs para cache e busque trechos
especificos antes de abrir o arquivo original.

## Cache

- Diretorio bruto: `C:\Users\ezequiel.oliveira\.codex\cache\inventoryrfid-pdf\`
- Extrair: `scripts/extract_pdf_text.ps1 -PdfPath <arquivo.pdf>`
- Buscar: `scripts/search_pdf_cache.ps1 -Query "<trecho>"`

## PDFs Recorrentes

- `C:\Users\ezequiel.oliveira\Downloads\Rascunho_TCC_V5.pdf`
  - Uso: versao enviada/analisada pelo professor.
  - Observacao: possui comentarios/anotacoes do professor alem do texto do TCC.
- `docs/tcc/PRINCIPAL.pdf`
  - Uso: PDF compilado atual do projeto.
  - Gerar com: `scripts/compile_tcc_pdf.ps1`.
- PDFs em `docs/tcc/Revisão de Literatura/`
  - Uso: apoio teorico, sempre com cuidado de autoria e citacao.

## Regras

- Para comentario do professor, buscar no PDF enviado e separar comentario de
  texto academico.
- Para norma/ABNT/disciplina, registrar pagina ou trecho consultado.
- Nao copiar texto de PDFs para o TCC; sintetizar com voz propria e citacao
  quando a ideia tecnica vier de fonte externa.
