# Operations

## Deployment and configuration

Run **one** ASP.NET Core process per data directory. It serves the built client, HTTP API, and WebSocket at the root of one origin by default, or under a single configured prefix on that origin. No shared DB, Redis, runtime Node, or second replica is needed. The container listens on `8080`, runs as the non-root .NET `app` user (UID `1654`), and stores SQLite and ASP.NET Data Protection keys together on a writable volume mounted at `/data`.

| Setting | Purpose |
|---|---|
| `MAHJONG_PORT` | Compose host port, default `8080`; published on `127.0.0.1` only. |
| `MAHJONG_IMAGE` | Local Compose image tag, default `mahjong-web:local`. No registry pull of the application image. |
| `BASE_URL` | Runtime path, e.g. `/mahjong`. Unset, empty or `/` serves the root. Use case-sensitive path segments with ASCII letters, digits, `.`, `_`, `~` or `-`; no empty or dot (`.` or `..`) segments, escapes, host, query, or fragment. One trailing slash is normalized. Invalid values fail startup. |
| `BUILD_VERSION`, `SOURCE_COMMIT` | Image build inputs; defaults `0.1.0` and `unknown`. Use a full SHA from a clean checkout. The app's `/api/version` endpoint and the OCI `version`/`revision` labels report the artifact identity. Runtime environment changes don't change it. |
| `Mahjong__DataDirectory` | Private, writable data directory. Defaults to `mahjong-web` in the OS local application data directory, or `/data` in the image. Don't put it in the publish directory. |
| `Mahjong__AllowHttpLoopbackOrigin` | Compose enables this for local HTTP through the Docker bridge. The request origin must still be loopback. Off in the standalone image; keep it off for HTTPS and never use it with a publicly bound HTTP port. |
| `Mahjong__PublicOrigin` | Exact public HTTPS origin with no path or trailing slash, e.g. `https://mahjong.example.test`. If not set, the app uses the effective request scheme and host. |
| `Mahjong__TrustedProxies__0`, `Mahjong__TrustedProxies__1`, … | Exact proxy peer IPs as seen by Kestrel. Setting a list replaces default loopback trust. Compose passes through `Mahjong__TrustedProxies__0`; for more peers use a Compose override. |

Use the Compose named volume unless you can guarantee ownership and permissions on a bind mount. The container's UID/GID must be able to create and modify SQLite files and the key ring; do not make the directory world-writable. Room state, names, invite information, and protection keys are sensitive; restrict and encrypt backups, and keep them separate from the software image. The key ring is not automatically encrypted at rest.

`GET /health/live` checks that HTTP can serve; `GET /health/ready` checks readiness after migrations and recovery and while SQLite is usable. Prefix these routes and `/api/version` with `BASE_URL` when mounted, e.g. `/mahjong/health/ready`. Docker's healthcheck does this automatically. The app does not serve unprefixed routes on a mounted deployment. Inspect `docker compose logs mahjong` if readiness doesn't return. Keep access logs free of credentials, cookies, invite codes, and private message bodies.

## Run the published image

Use the [README Docker command](../README.md#run-the-published-image) with Docker Engine 28 or newer on Linux/amd64 once the `Publish the verified GHCR image` job in [CI](https://github.com/long2know/mahjong-web/actions/workflows/ci.yml) logs a verified `latest` digest for the desired commit. The image is anonymously pullable after verification. The old `Mahjong.Autotable.Api.dll` image isn't this app: start `Mahjong.Server.dll` with a fresh data directory, and leave the legacy database and backups intact. No legacy SQLite connection string, database provider, JWT signing key, or CORS settings apply. The app opens `mahjong.db` and creates a `keys/` directory under the selected data directory; browsers get a protected guest cookie. This is not a migration.

To select a known revision, replace `:latest` with `:sha-<full-commit>`, or pin `ghcr.io/long2know/mahjong-web@sha256:<manifest-digest>` from the publish log for exact bytes. Keep `--pull=always`, then check `/health/ready` and `/api/version` at the chosen loopback port (e.g. `curl -fsS http://127.0.0.1:8911/api/version` at root). The reported revision must match the intended commit. For remote access, use the HTTPS setup below, pass its application settings with `docker run --env`, and set the proxy upstream to the chosen loopback port.

If GHCR denies the job's push, the maintainer of the existing package linked to `long2know/mahjong-webgl` should open its package settings, choose **Manage Actions access**, and add `long2know/mahjong-web` with **Write**. Then rerun the publish job for the current `main` push. The job uses the repository's Actions token; no PAT in the repo is needed.

### Keep an existing `/mahjong` route and bind mount

This Compose example keeps the host mount and uses a fresh subdirectory within it for the new app. Use a verified image revision that includes `BASE_URL` support. Before starting, create `${DOCKER_DATA}/games/mahjong/data/mahjong-web` as an empty, private directory. The container user (UID `1654`) needs traversal through the mounted parent and write access to the new directory. Do not overwrite the old database or recursively change permissions on existing data.

```yaml
services:
  mahjong:
    image: ghcr.io/long2know/mahjong-web:latest
    pull_policy: always
    ports:
      - "127.0.0.1:8911:8080"
    environment:
      BASE_URL: /mahjong
      Mahjong__DataDirectory: /data/mahjong-web
      Mahjong__PublicOrigin: https://games.example.test
      # Mahjong__TrustedProxies__0: set to the exact peer IP if it isn't loopback.
      # Legacy SQLite connection string and database provider: not used.
      # Authentication__JwtSigningKeys__0: not used.
      # Legacy CORS settings: not used.
    volumes:
      - ${DOCKER_DATA}/games/mahjong/data:/data
```

Replace `https://games.example.test` with your existing scheme and hostname, **without** `/mahjong`. Point the existing TLS proxy to the loopback port above, and configure it as described below. Check `curl -fsS http://127.0.0.1:8911/mahjong/health/ready` and `curl -fsS http://127.0.0.1:8911/mahjong/api/version` on the host; then open `https://games.example.test/mahjong/` in a browser.

## HTTPS for other devices

HTTP is for loopback development only. Terminate TLS at a trusted reverse proxy and keep Kestrel inaccessible to clients except through that proxy. Export `Mahjong__AllowHttpLoopbackOrigin=false`, `Mahjong__PublicOrigin` and, if the proxy peer isn't loopback, `Mahjong__TrustedProxies__0` before creating the Compose service. Docker port forwarding can make a host proxy appear to originate from a bridge address: trust only the actual, expected peer, never a wildcard or all container networks. Keep the upstream inaccessible to untrusted peers. Only one forwarded hop is supported.

For `BASE_URL=/mahjong`, **preserve the prefix** upstream unless your existing proxy needs to strip it. Route only `/mahjong` and `/mahjong/...`, not `/mahjong-other`. Forward `/mahjong/...` unchanged and remove any client-supplied `X-Forwarded-Prefix`. The app redirects `GET /mahjong` to `/mahjong/` with the original query string. Invite codes use URL fragments, which the browser retains across that redirect without sending them to the server.

For example, in Nginx's `http` context with a certificate for the existing hostname (use the service's actual loopback port):

```nginx
map $http_upgrade $mahjong_connection {
    default upgrade;
    '' close;
}

server {
    listen 443 ssl;
    server_name mahjong.example.test;
    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/private-key.pem;

    location = /mahjong {
        return 308 /mahjong/$is_args$args;
    }

    location ^~ /mahjong/ {
        proxy_pass http://127.0.0.1:8911;
        proxy_http_version 1.1;
        proxy_set_header Host mahjong.example.test;
        proxy_set_header X-Forwarded-Host mahjong.example.test;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Prefix "";
        proxy_set_header Forwarded "";
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $mahjong_connection;
        proxy_read_timeout 180s;
    }
}
```

If the proxy **strips the prefix**, keep the exact `/mahjong` redirect at the edge, use `proxy_pass http://127.0.0.1:8911/;` (with the trailing slash), and replace `proxy_set_header X-Forwarded-Prefix "";` with `proxy_set_header X-Forwarded-Prefix /mahjong;` in that location. The server requires a single exact value matching the configured path from the same trusted peer as other forwarded headers. Never send this header on other public routes, append it to a client value, or send it while preserving the prefix. For root hosting, use `location /` instead of both `/mahjong` locations, omit `BASE_URL`, and leave the prefix header unset.

Overwrite forwarded headers rather than trusting client-supplied values. Preserve the browser's `Origin`; verify that `wss://<host>/mahjong/ws` (or `/ws` for root) works, wrong or missing origins are rejected, and the guest cookie is `Secure`, `HttpOnly`, `SameSite=Lax`, and scoped to the configured path. Verify on your actual network and proxy before opening access. Redirect HTTP to the canonical HTTPS origin at the edge if you listen on port 80. Do not expose the raw HTTP port publicly. Other apps at the same origin are not a browser security boundary; use a separate origin if those apps are not trusted.

## Stop, backup, update, and restore

`docker compose stop mahjong` stops the server without deleting its container or volume. `docker compose down` removes the container and network but keeps data. Never use `down -v`, remove the volume, or start a second writer to make a backup.

### Make an offline backup

Warn players that play will be interrupted; downtime does not pause deadlines. From the repository root, using the same Compose project and image as the running server:

```sh
set -eu
umask 077
mkdir -p backups
backup="backups/mahjong-data-$(date -u +%Y%m%dT%H%M%SZ).tar"
container="$(docker compose ps --all --quiet mahjong)"
test -n "$container"
docker compose stop --timeout 30 mahjong
test "$(docker inspect --format '{{.State.Status}}:{{.State.ExitCode}}' "$container")" = exited:0

# The separate helper runs tar, not the application; there must be no other writer.
docker compose run --rm --no-deps -T --entrypoint tar mahjong \
  -C /data -cpf - . > "$backup.part"
tar -tf "$backup.part" >/dev/null
mv "$backup.part" "$backup"
sha256sum "$backup" > "$backup.sha256"
docker compose up -d --no-build --wait
```

Copy the **whole stable data directory** after a graceful stop: `mahjong.db`, any SQLite WAL/SHM sidecars, `keys/`, and other contents. Do not copy just the main database from a live process, or use a partial archive left by a failed command. For a native run, stop the process gracefully first, then `tar -C` the configured data directory with the same full-directory semantics. Store archives with the image ID and `/api/version` at the time of backup. Schedule backups based on acceptable data loss; retain only what you need, secure a separate copy, and periodically rehearse a restore.

### Update or save the image

Take and verify an offline backup before an update, skipping the final `up` so play stays stopped until the update succeeds. Save or tag the old image before retagging `mahjong-web:local`:

```sh
docker image tag mahjong-web:local mahjong-web:rollback
docker image save -o backups/mahjong-rollback-image.tar mahjong-web:rollback
SOURCE_COMMIT="$(git rev-parse HEAD)" docker compose build mahjong
docker compose up -d --no-build --wait
```

Use the intended clean checkout for each build. Check readiness, version, and a guest reconnect after the update. EF Core applies migrations on startup before readiness. Don't point older application code at a database already migrated by a newer build; roll back the **matching** pre-update image and data backup. `docker image load -i backups/mahjong-rollback-image.tar` loads a saved image locally; an image archive is never a substitute for a data backup.

For a published-image deployment, likewise stop and take an offline data backup, record the old image digest, and remove only the stopped container. Recreate it with the verified new image and the same Lantern Table volume and settings. Restarting an existing container doesn't pick up a new image. Roll back using the saved digest and its matching data backup.

### Restore and verify

Run `docker compose stop --timeout 30 mahjong` in the original project before reusing its host port or hostname. Restore into a **fresh** volume (new Compose project), with the original volume retained as a fallback. Use an image that matches the saved database; the example uses the loaded rollback tag. Set `backup` to the actual data archive first, and use the same public origin and trusted proxy settings for the restored service.

```sh
set -eu
sha256sum -c "$backup.sha256"
export MAHJONG_IMAGE=mahjong-web:rollback
restore_project=mahjong-restored
if docker volume inspect "${restore_project}_data" >/dev/null 2>&1; then
  echo 'Choose a new project: its restore volume already exists.' >&2
  exit 1
fi

docker compose -p "$restore_project" run --rm --no-deps -T --entrypoint tar mahjong \
  -C /data -xpf - < "$backup"
docker compose -p "$restore_project" up -d --no-build --wait
```

Check the app's `/health/ready` and `/api/version`, including any configured prefix. From a browser on the **original origin and path** with its original, still-valid guest cookie, reconnect to a previously saved room and confirm the same seat and room state (allow for elapsed deadlines). A successful response from the landing page does not prove a restore. Do not delete the old volume until this recovery is verified.

## Identity, retention, and deadlines

- Guests have a 30-day protected browser cookie, refreshed by the guest endpoint, not an account or password reset. Expired profiles without a seat are eligible for pruning. Clearing the cookie, changing origin or mount, or losing the key ring can lose access to a seat. Keep the DB and keys in the same backup, and don't share key rings between unrelated deployments.
- Rooms expire after 24 hours without successful human subscription or a room command. Room checkpoints keep the last 30 chat messages. Command leases last 10 minutes; receipts support safe retries during the lease and are pruned on expiry. Backups preserve the state as of the backup, not actions that occurred after it.
- Timers use persisted deadlines; an outage or restore doesn't grant extra play time. After recovery, elapsed windows and overdue automatic resume are processed by the service. Keep the host clock synchronized.
- No real money, payments, wagering, or user accounts. Operate on a trusted network or with suitable network-level access controls; invite rooms aren't a substitute for protecting the deployment.

## Verify a build

From the repository root, with the pinned SDK and Node and a clean checkout. Use a fresh publish directory:

```sh
npm --prefix web ci && npm --prefix web run build
dotnet test tests/Mahjong.Rules.Tests/Mahjong.Rules.Tests.csproj -c Release -p:RestoreLockedMode=true \
  -- RunConfiguration.TreatNoTestsAsError=true
dotnet test tests/Mahjong.Server.Tests/Mahjong.Server.Tests.csproj -c Release -p:RestoreLockedMode=true \
  -- RunConfiguration.TreatNoTestsAsError=true
version=0.1.0
revision="$(git rev-parse HEAD)"
publish="artifacts/publish-$revision"
dotnet publish src/Mahjong.Server/Mahjong.Server.csproj -c Release --no-restore -o "$publish" \
  -p:UseAppHost=false -p:ContinuousIntegrationBuild=true \
  -p:Version="$version" -p:InformationalVersion="$version+$revision" \
  -p:IncludeSourceRevisionInInformationalVersion=false
bash scripts/smoke-published.sh "$publish" "$version" "$revision"
```

The smoke check starts only the published app and checks real JS/CSS assets, the 32 KiB gzip cold-shell budget, version, health and WebSocket admission. It sets guest preferences, plays a legal choice and pauses the game, then restores an offline archive into a fresh directory. It verifies the old cookie, preferences, exact paused checkpoint, and command receipt. Run again with `SMOKE_PATH_BASE=/mahjong` to check the same publish at a runtime mount.

CI installs Chromium and WebKit from the locked Playwright dependency, tests against the published app, and retains browser evidence for seven days. To run both engines locally after installing the browsers and their dependencies:

```sh
ASPNETCORE_ENVIRONMENT=Testing Mahjong__Testing__BotDelayMilliseconds=100 \
  bash scripts/smoke-published.sh "$publish" "$version" "$revision" --with-browser
```

For parallel local runs, use distinct `MAHJONG_GEOMETRY_PORT`, `SMOKE_PLAYWRIGHT_OUTPUT_DIR`, and `PLAYWRIGHT_HTML_OUTPUT_DIR` values. The loopback Vite server runs only the dev geometry harness; it isn't a deployment dependency.

On a host with a working Docker daemon, use the same `version` and `revision` values for the separate runtime image smoke:

```sh
docker compose --env-file /dev/null config --quiet
BUILD_VERSION="$version" SOURCE_COMMIT="$revision" docker compose build mahjong
bash scripts/smoke-container.sh mahjong-web:local "$version" "$revision"
```

The image smoke prints the image ID and checks labels, non-root execution, a writable named volume, no Node or SDK, and readiness. It verifies the original guest after recreating the container and after archive restore into a separate volume. It also runs that image with `BASE_URL=/mahjong` and checks Docker health and actual mounted play. It uses disposable loopback containers and volumes, not a deployed service. Only a push to `main` in the upstream repository can publish, after both CI suites pass and the exact candidate is smoke-tested. Publication verifies public access to the commit-tagged image before moving `latest` to the same manifest; it does not deploy anything.

The base-image digests in the [Dockerfile](../Dockerfile) were checked against the public registries. Update the [.NET SDK pin](../global.json), image references, and CI tools together as required; verify updates against the official [.NET release metadata](https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json) and [Node release schedule](https://github.com/nodejs/Release#release-schedule).
When intentionally changing a NuGet reference, regenerate the affected project lock files with `dotnet restore <project> -p:RestoreLockedMode=false --force-evaluate`, then verify in locked mode.

### Artifact licenses and provenance

Native publish and the runtime image include the project [GPL v3 license](../LICENSE) and a `licenses/` directory:

| Runtime dependency | Source and bundled license |
|---|---|
| EF Core, Microsoft.Data.Sqlite, and Microsoft.Extensions.DependencyModel 10.0.15 | [Server NuGet lock](../src/Mahjong.Server/packages.lock.json); [MIT grant](https://github.com/dotnet/dotnet/blob/8e0f8ed2312954727f8919d7d1c2f78b483b4ee7/src/efcore/LICENSE.txt) and DependencyModel's packaged `THIRD-PARTY-NOTICES.TXT`. |
| SQLitePCLRaw bundle, core, provider and native SQLite 2.1.13 | [Server NuGet lock](../src/Mahjong.Server/packages.lock.json); Apache-2.0 and [upstream notice](https://github.com/ericsink/SQLitePCL.raw/blob/cbca586f45c727531091be43f76924580769ca54/NOTICE.TXT). The 2.1.13 packages declare the license and copyright but do not embed notice files or identify a source commit; the bundled notice is the upstream version whose last change predates the package. |
| ASP.NET and .NET 10.0.15 | The pinned ASP.NET base image retains its own runtime licenses and notices. A native publish uses the runtime installed on the host. |

Vite 7.3.8, TypeScript 5.9.3 and Playwright 1.65.1 are build/test tools pinned in the [web npm lock](../web/package-lock.json); the production client omits Vite's legacy modulepreload helper. The [.NET Rules test lock](../tests/Mahjong.Rules.Tests/packages.lock.json) and [.NET Server test lock](../tests/Mahjong.Server.Tests/packages.lock.json) are separate from the runtime. Update [the notice inventory](../scripts/licenses/THIRD-PARTY.txt) and [publish copy settings](../Directory.Build.targets) when changing a shipped dependency. If distributing the image or another binary, provide the corresponding source as required by the GPL.

**Verification, 2026-11-19:** Locked Rules (55) and Server (8) tests passed, as did [14 Chromium/WebKit cases](browser-validation.md) against the published app. Native publish passed the notice check, HTTP/WebSocket play, and offline restore. A separate local Nginx TLS test passed secure cookies, WSS, invalid-origin rejection, and recovery. Compose configuration validated, but the Docker API socket was not available; those native runs do not qualify the runtime image or a container-to-proxy deployment.
