# InventoryRFID

InventoryRFID is a web prototype for patrimonial inventory management with RFID
support. The project combines a Django REST backend, a Next.js frontend, local
SQLite persistence for development, and auxiliary scripts for RFID integration.

The prototype focuses on the functional flow of inventory control: registering
assets, readers and locations, receiving RFID events, updating inventory state,
supporting audits, recording inconsistencies, and keeping an operational
history.

## Main Features

- Management of patrimonial items, locations, users and RFID readers.
- RFID event ingestion through a REST API using `X-RFID-Token`.
- Reading windows for RFID capture and audit routines.
- Comparison between expected and detected items during audits.
- Registration and follow-up of inconsistencies such as unknown tags, missing
  items and divergent locations.
- Operational history for readings, movements, audits and relevant changes.

## Architecture

The repository is organized into four main areas:

```text
backend/    Django REST API and domain rules
frontend/   Next.js web interface
scripts/    RFID, TCC and support automation
docs/       Architecture notes and TCC material
```

The backend follows a simple three-layer organization:

```text
backend/core/
|-- api/              # ViewSets, serializers, permissions, URLs and pagination
|-- domain/           # Models, business rules and use cases
|-- infrastructure/   # RFID/device/HTTP integration details
`-- migrations/       # Database schema evolution through Django ORM
```

Normal frontend API calls use Basic Authentication. RFID ingestion and command
flows use a separate `X-RFID-Token` header.

## Environment Variables

Sensitive values must not be committed to Git. Use local environment files or
deployment-level configuration for real credentials.

Main backend variables:

- `DJANGO_ENV`: use `dev` or `prod`.
- `DJANGO_SECRET_KEY`: Django secret key.
- `DJANGO_DEBUG`: enables or disables debug mode.
- `DJANGO_ALLOWED_HOSTS`: comma-separated allowed hosts.
- `DJANGO_CORS_ALLOWED_ORIGINS`: comma-separated CORS origins for production.
- `RFID_INGEST_TOKEN`: token accepted by RFID ingestion endpoints.
- `RFID_ONLINE_TIMEOUT_SECONDS`: timeout used to mark RFID readers offline.
- `RFID_COMMAND_TIMEOUT_SECONDS`: timeout for HTTP commands sent to readers.

Main frontend variables:

- `NEXT_PUBLIC_API_BASE_URL`: backend API base URL.
- `NEXT_PUBLIC_RFID_INGEST_TOKEN`: token used by frontend RFID test helpers.

An example frontend environment file is available at `frontend/.env.example`.

## Running The Backend

From the repository root:

```powershell
cd backend
python manage.py migrate
python manage.py runserver
```

The API runs at:

```text
http://127.0.0.1:8000
```

## Running The Frontend

In another terminal:

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

The web interface runs at:

```text
http://localhost:3000
```

## RFID Communicator

The intermediary RFID communicator can be started from the repository root:

```powershell
py scripts\rfid\comunicador_intermediario.py
```

It reads tags from a local RFID device and forwards events to the backend API.

## Tests And Checks

Backend tests:

```powershell
cd backend
python manage.py test core
```

Frontend build and lint:

```powershell
cd frontend
npm.cmd run build
npm.cmd run lint
```

TCC PDF verification:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check_tcc_all.ps1
```

Continuous TCC rebuild while editing:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watch_tcc.ps1
```

## TCC And Documentation

Academic material is located in `docs/tcc`. The main LaTeX entrypoint is:

```text
docs/tcc/PRINCIPAL.tex
```

Project context maps and support documentation are located in `docs/context` and
`docs/`.

## Security Notes

Before publishing or deploying this project:

- Do not commit real `.env` files, local databases, credentials or tokens.
- Replace development defaults such as `dev-rfid-token` and development Django
  secrets in production.
- Review scripts and demo data for hardcoded test users or passwords.
- Avoid publishing third-party PDFs unless redistribution is allowed.
