# Database contract test environments

The manual-transfer reversal contract has two isolated PostgreSQL runners. Both
apply the same five-step plan: bootstrap, legacy rows, the forward migration,
functional contracts, and real multi-session concurrency checks.

## Installed or portable PostgreSQL

```powershell
npm run verify:reversal-target-db
```

The runner discovers `pg_config` or a Scoop PostgreSQL installation. A custom
runtime can be selected without changing the repository:

```powershell
$env:NINETY_NINE_PG_BIN = 'C:\path\to\postgresql\bin'
npm run verify:reversal-target-db
```

Each run creates a random-port cluster below the operating-system temporary
directory, stops it in a `finally` path, and verifies that the directory was
removed. It never starts or mutates a developer's persistent PostgreSQL data
directory.

## Docker Compose

```powershell
npm run verify:reversal-target-db:docker
```

The Compose runner uses an isolated PostgreSQL 17 project with no published
host port. SQL mounts are read-only, database storage is `tmpfs`, credentials
are test-only, and the runner always calls `down --volumes --remove-orphans`.
On Windows, Docker Desktop must be running with WSL 2 enabled; a newly enabled
WSL or Virtual Machine Platform feature requires a Windows restart first.

The Docker executable can be selected explicitly when it is not on `PATH`:

```powershell
$env:NINETY_NINE_DOCKER_EXE = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
npm run verify:reversal-target-db:docker
```

Verified on 2026-07-22 after enabling WSL 2 and restarting Windows: Docker
Desktop 4.83.0 with Engine 29.6.2 ran the full suite against
`postgres:17-alpine` (PostgreSQL 17.10). The runner removed its Compose
project, container, network, and volumes after the successful run.

The concurrency phase proves three boundaries with separate database sessions:

- one actor/key produces one append plus one replay with the same reversal ID;
- different actors racing one receipt produce one winner and one fail-closed result;
- a ledger append committed while reversal waits on the parent lock produces a
  stale-CAS rejection and no reversal.

## Central-fulfillment foundation

The P1-1 foundation has a separate four-step suite: an operational-shape
bootstrap, conservative legacy rows, the forward migration, and database
contracts.

```powershell
npm run verify:central-fulfillment-db
npm run verify:central-fulfillment-db:docker
```

The installed-runtime runner accepts PostgreSQL 17 or newer and uses the same
random-port temporary-cluster cleanup boundary as the reversal runner. The
Docker runner uses `postgres:17-alpine` with no published host port, read-only
SQL mounts, a read-only container filesystem, `tmpfs` database storage, and a
unique Compose project. It verifies that no project-labelled container,
network, or volume remains after `down --volumes --remove-orphans`.

Verified on 2026-07-22 against installed PostgreSQL 18.4 and isolated Docker
PostgreSQL 17.10. Both runs proved:

- payment completion and `storage_expires_at` never become inferred central
  receipt or storage facts;
- cancelled and explicit shipped evidence are the only automatic terminal
  legacy classifications;
- business, store, order-item, work, and center composite relationships fail
  closed;
- the unconfigured default center contains no invented address, while an
  active center requires a valid five-digit postal code and bounded contact
  data;
- fulfillment events reject update, delete, and truncate operations;
- only an Owner can read the foundation tables, and client/service roles have
  no direct mutation privileges;
- the foundation deliberately creates no new-order initialization trigger or
  fulfillment mutation RPC.

There is no concurrency phase yet because this migration exposes no workflow
writer. The later transition RPC migration must add version/CAS, idempotency,
lock-order, and multi-session competition tests before enabling operations.

A complete `supabase start` replay currently stops before this migration at
`20260718030000_add_role_levels_revenue_enforcement.sql`. That historical
migration requires the production Kakao Owner identity to exist before normal
seed files run, so an empty local Auth schema fails closed. This is a pre-existing
fresh-environment reproducibility gap, not a failure in the fulfillment
foundation; the isolated PostgreSQL suites remain the executable contract until
the Owner bootstrap is separated from schema migration replay.
