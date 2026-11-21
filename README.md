# Mahjong Web

A self-hosted, four-seat Changsha Mahjong table for phones and desktop browsers. Play with friends or fill empty seats with bots. This is free play with points only: no accounts, payments, wagering, or cash value.

The [Changsha rules profile](docs/rules.md) and table presentation are provisional. See the [browser evidence and its limits](docs/browser-validation.md), [architecture](docs/architecture.md), and [wire protocol](docs/protocol.md).

## Run the published image

After [CI verifies the public GHCR image](docs/operations.md#run-the-published-image), run it on a Linux/amd64 Docker host. Choose an unused named volume; don't reuse or delete the legacy Mahjong Autotable volume.

```sh
docker run -d --name lantern-table --restart unless-stopped --pull=always --platform linux/amd64 \
  --publish 127.0.0.1:8911:8080 --mount type=volume,source=lantern-table-data,target=/data \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --env Mahjong__AllowHttpLoopbackOrigin=true \
  ghcr.io/long2know/mahjong-web:latest
```

Open [http://127.0.0.1:8911](http://127.0.0.1:8911); change `8911` if needed. No JWT, SQLite connection string, or app credentials are required: the browser gets a protected guest cookie, backed by SQLite and a key ring under `/data`. Stop with `docker stop lantern-table` to keep the data.

To keep an existing `/mahjong` route, start a revision that supports mounts with `--env BASE_URL=/mahjong` and open `http://127.0.0.1:8911/mahjong/`. See the [published Compose example](docs/operations.md#keep-an-existing-mahjong-route-and-bind-mount) for keeping the existing bind mount without reusing the legacy database, and the [HTTPS proxy contract](docs/operations.md#https-for-other-devices).

For a TLS proxy that already preserves `Host`, `/mahjong` and WebSocket upgrades, add `--env Mahjong__BehindHttpsProxy=true` and keep the raw HTTP upstream private to that proxy. No app hostname or proxy IP setting is needed.

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

Open [http://127.0.0.1:8080](http://127.0.0.1:8080). To use a subpath, set `BASE_URL=/mahjong` when creating the service and open `/mahjong/` on that origin; the same built image works at either path. Stop with `docker compose down`; it keeps the named data volume. Do not use `down -v` to stop the app. No separate database, Redis, .NET SDK, or Node process is needed at runtime.

See the [operations runbook](docs/operations.md) for HTTPS, ports, update and rollback, backup and restore, and build verification.

Licensed under the [GNU General Public License, version 3](LICENSE), included in publish output and the image. See the [original graphics and synthesized audio provenance](docs/assets.md); no assets from the reference product are bundled.
