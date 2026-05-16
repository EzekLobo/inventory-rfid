# InventoryRFID

Projeto organizado em tres partes principais:

- `backend/`: API Django e banco SQLite local.
- `frontend/`: interface Next.js.
- `scripts/`: rotinas auxiliares, como o comunicador RFID.

## Arquitetura

O projeto segue uma divisao simples em tres camadas, sem frameworks extras:

- **API**: ViewSets, serializers/DTOs, permissoes, paginacao e respostas HTTP.
- **Service/Domain**: services como `SyncManager` e `AuditoriaManager` concentram regras de negocio.
- **Infrastructure**: Django ORM, migrations, banco de dados, comunicacao HTTP com antenas e comunicador RFID.

No Django REST, a camada API cumpre o papel de controller. Os serializers funcionam como DTOs dentro dessa camada, sem virar uma camada separada.

Estrutura resumida:

```text
backend/core/
|-- api/              # Controllers, serializers/DTOs, permissoes e paginacao
|-- domain/           # Regras de negocio e casos de uso
|-- infrastructure/   # Integracoes RFID/HTTP e infraestrutura operacional
`-- migrations/       # Evolucao do banco via Django ORM

scripts/rfid/
`-- comunicador_intermediario.py
```

## Otimizacao e boas praticas

- O processador RFID aceita injecao simples de dependencias pelo construtor, facilitando testes sem adicionar um framework de DI.
- Os serializers funcionam como DTOs leves para separar dados externos dos models.
- Os models operacionais possuem indices para consultas frequentes de leituras, timeline, inconsistencias e estado das antenas.
- Configuracoes sensiveis e variaveis de ambiente devem ficar fora do codigo em ambientes reais.

Variaveis principais:

- `DJANGO_ENV`: use `dev` ou `prod`.
- `DJANGO_SECRET_KEY`: chave secreta do Django.
- `DJANGO_DEBUG`: ativa/desativa debug.
- `DJANGO_ALLOWED_HOSTS`: hosts permitidos separados por virgula.
- `DJANGO_CORS_ALLOWED_ORIGINS`: origens CORS permitidas em producao.
- `RFID_INGEST_TOKEN`: token usado pelo comunicador RFID.
- `RFID_ONLINE_TIMEOUT_SECONDS`: limite para considerar antena offline.
- `RFID_COMMAND_TIMEOUT_SECONDS`: timeout de comandos HTTP para antenas.

## Executar o backend

```powershell
cd backend
python manage.py runserver
```

A API fica em `http://127.0.0.1:8000`.

## Executar o frontend

Em outro terminal:

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

A interface fica em `http://localhost:3000`.

## Executar o comunicador RFID

```powershell
py scripts\rfid\comunicador_intermediario.py
```
