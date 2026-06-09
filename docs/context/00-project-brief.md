# InventoryRFID Project Brief

## Resumo

InventoryRFID e um prototipo web para apoiar inventario patrimonial com eventos
RFID. O projeto combina cadastros patrimoniais, leitores RFID, leitura de tags,
auditoria, inconsistencias e historico operacional.

## Fonte de Verdade

- Comportamento implementado: `backend/core/`, `frontend/` e testes em
  `backend/core/tests/`.
- Narrativa academica: `docs/tcc/*.tex`.
- Evidencia do TCC: `docs/tcc/CAPIV_Resultados.tex`,
  `docs/tcc/figs/sistema/` e testes executados.
- Diagramas usados no texto: renders e fontes em `docs/tcc/figs/`.

## Limites da Validacao

- Validacao fisica: leitor RFID USB/de proximidade, uma tag, comunicador
  intermediario e API.
- Validacao de software: eventos representativos como `motion_detected`,
  `start_reading` e `tags_read`.
- Fora do escopo comprovado: desempenho fisico, alcance, leitura simultanea,
  ambiente com muitas tags e sensores fisicos integrados.

## Regra de Ouro

So afirmar como resultado aquilo que estiver sustentado por codigo, teste,
captura, Capitulo IV ou PDF renderizado. O restante deve ser descrito como
possibilidade, limitacao ou trabalho futuro.
