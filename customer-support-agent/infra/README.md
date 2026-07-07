# Infra — CorpDB

SQLite REST API in Docker for the multi-agent workshop.

## Prerequisites

- Docker + Docker Compose

## Start

```bash
cd infra
docker compose up --build -d
```

## Verify

```bash
curl http://localhost:3001/health
# {"status":"ok"}

curl http://localhost:3001/customers/cust_001
curl http://localhost:3001/bills/cust_002?paid=0
curl http://localhost:3001/accounts/cust_001
```

## Stop (without losing data)

```bash
docker compose down
```

## Reset the database

```bash
docker compose down -v   # deletes the volume
docker compose up --build -d
```

## Port

`3001` — configurable via the `PORT` variable in `docker-compose.yml`.

## Full contract

See [API_CONTRACT.md](./API_CONTRACT.md).
