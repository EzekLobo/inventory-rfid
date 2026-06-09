# Diagrams Map

## Diagramas do TCC

- Casos de uso: `docs/tcc/figs/casos_uso_rfid.drawio`,
  `casos_uso_rfid.png` e `casos_uso_rfid.tex`.
- Banco de dados: `docs/tcc/figs/diagrama_banco_rfid.mmd`,
  `diagrama_banco_rfid.png` e `diagrama_banco_rfid.tex`.
- Fluxo de atividade RFID: `docs/tcc/figs/fluxo_atividade_rfid.mmd`,
  `fluxo_atividade_rfid.png` e `fluxo_atividade_rfid.tex`.
- Sequencia RFID: `docs/tcc/figs/fluxo_rfid_sequence.mmd` e
  `fluxo_rfid_sequence.tex`.
- Arquitetura geral: `docs/tcc/figs/arquitetura_geral_rfid.drawio`,
  `arquitetura_geral_rfid.pdf` e `arquitetura_geral_rfid.tex`.

## Fonte de Verdade Visual

Para revisao academica, priorize a figura efetivamente incluida no PDF/TCC.
Fontes editaveis alternativas so devem orientar ajustes quando estiverem
sincronizadas com o render usado pelo LaTeX.

## Regras de Coerencia

- Casos de uso representam interacao de atores; regras internas como
  deduplicacao e validacao de tag devem ficar em requisitos/fluxos.
- Arquitetura nao deve sugerir validacao fisica de sensores/gateways nao testados.
- Diagrama de banco deve acompanhar models/migrations, mas pode ser conceitual.
- Texto, caption, label, fonte editavel e render devem contar a mesma historia.
