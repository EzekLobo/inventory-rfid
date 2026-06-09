# Application Map

## Backend

- `backend/manage.py`: entrada Django.
- `backend/inventario_rfid/settings.py`: configuracoes Django/DRF.
- `backend/core/api/viewsets.py`: endpoints REST, autenticacao, leitores,
  eventos RFID, auditoria e inconsistencias.
- `backend/core/api/serializers.py`: formatos de entrada/saida da API.
- `backend/core/api/permissions.py`: permissoes operacionais.
- `backend/core/domain/models.py`: entidades persistidas.
- `backend/core/domain/services.py`: regras de leitura, deduplicacao,
  inconsistencias e resolucao.
- `backend/core/infrastructure/rfid_handler.py`: comunicacao e estado de leitores.
- `backend/core/tests/`: testes funcionais de API, RFID, auditoria e inconsistencias.

## Frontend

- `frontend/app/`: telas Next.js.
- `frontend/app/page.tsx`: painel inicial.
- `frontend/app/auditoria/page.tsx`: auditoria.
- `frontend/app/inconsistencias/page.tsx`: acompanhamento e resolucao.
- `frontend/app/configuracoes/page.tsx`: usuarios, permissoes e cadastros.
- `frontend/lib/api.ts`: cliente dos endpoints.
- `frontend/lib/types.ts`: tipos usados na interface.

## Scripts

- `scripts/rfid/comunicador_intermediario.py`: ponte entre leitor local e API.
- `scripts/compile_tcc_pdf.ps1`: compilacao mecanica do TCC.
- `scripts/extract_pdf_text.ps1`: extracao de texto PDF com cache.
- `scripts/search_pdf_cache.ps1`: busca em textos extraidos.

## Contratos RFID

- `motion_detected`: abre janela de leitura.
- `start_reading`: comando retornado ao leitor durante janela ativa.
- `tags_read`: envia tags capturadas para processamento.

## Checagens Rapidas

```powershell
rg -n "class .*ViewSet|router.register" backend/core/api
rg -n "motion_detected|start_reading|tags_read|duplic|inconsist" backend/core
rg -n "resolverInconsistencia|listInconsistencias|permissions" frontend
```
