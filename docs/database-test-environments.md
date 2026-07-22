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

The concurrency phase proves three boundaries with separate database sessions:

- one actor/key produces one append plus one replay with the same reversal ID;
- different actors racing one receipt produce one winner and one fail-closed result;
- a ledger append committed while reversal waits on the parent lock produces a
  stale-CAS rejection and no reversal.
