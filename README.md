# Mahjong Web

A self-hosted, four-seat Changsha Mahjong table for phones and desktop browsers. Play with friends or fill empty seats with bots. This is free play with points only: no accounts, payments, wagering, or cash value.

The [Changsha rules profile](docs/rules.md) and table presentation are provisional. See the [browser evidence and its limits](docs/browser-validation.md), [architecture](docs/architecture.md), and [wire protocol](docs/protocol.md).

## Run from source

Install the exact [.NET 10 SDK](global.json) and Node.js **26.13.1** LTS. From the repository root:

```sh
npm --prefix web ci && npm --prefix web run build
dotnet run --project src/Mahjong.Server --no-launch-profile -- --urls http://localhost:8080
```

Open [http://localhost:8080](http://localhost:8080). Stop with Ctrl+C. Build the client again after changing its source. NuGet restores use the checked-in lock files, including on local runs.

## Run with Docker Compose

With Docker Engine 28 or newer and the Compose plugin, build and start from the repository root:

```sh
# Stamp a clean checkout with its Git commit. Omit SOURCE_COMMIT for dirty trees or source archives.
SOURCE_COMMIT="$(git rev-parse HEAD)" docker compose up --build -d --wait
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080). Stop with `docker compose down`; it keeps the named data volume. Do not use `down -v` to stop the app. No separate database, Redis, .NET SDK, or Node process is needed at runtime.

See the [operations runbook](docs/operations.md) for HTTPS, ports, update and rollback, backup and restore, and build verification.

Licensed under the [GNU General Public License, version 3](LICENSE), included in publish output and the image. See the [original graphics and synthesized audio provenance](docs/assets.md); no assets from the reference product are bundled.
