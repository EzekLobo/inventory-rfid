# Evidence Map

## Evidencias no TCC

- Capitulo IV descreve telas, fluxo de leitura, auditoria, inconsistencias,
  log operacional e sintese da validacao funcional.
- Screenshots ficam em `docs/tcc/figs/sistema/`.
- Tabela de validacao funcional fica em `docs/tcc/CAPIV_Resultados.tex`.

## Evidencias Tecnicas

- Testes de RFID/API: `backend/core/tests/test_rfid_processor.py` e
  `backend/core/tests/test_pipeline_api.py`.
- Testes de auditoria: `backend/core/tests/test_auditoria.py`.
- Testes de inconsistencias: `backend/core/tests/test_inconsistencias.py`.
- Regras de dominio: `backend/core/domain/services.py`.
- Endpoints: `backend/core/api/viewsets.py`.

## Uso Academico

- Se um comportamento aparece em codigo mas nao no Capitulo IV, trate como
  implementado, mas nao como evidencia central da validacao.
- Se uma linha de tabela de validacao nao tiver suporte em teste, captura ou
  narrativa de resultados, agrupe ou remova.
- Se a conclusao mencionar contribuicao, ela deve voltar para objetivo,
  implementacao e evidencia.

## Comandos de Apoio

```powershell
cd backend; python manage.py test
rg -n "resolvida|duplicada|offline|motion_detected|tags_read" backend/core/tests
rg -n "Sintese da validacao|validacao funcional|Inconsistencias" docs/tcc/CAPIV_Resultados.tex
```
