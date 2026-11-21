#!/usr/bin/env bash
set -euo pipefail

if (( $# < 3 || $# > 4 )) || [[ ${4:-} != "" && $4 != --with-browser ]]; then
  echo "Usage: bash scripts/smoke-published.sh PUBLISH_DIR VERSION COMMIT [--with-browser]" >&2
  exit 2
fi

publish=$(realpath -- "$1")
version=$2
revision=$3
if [[ ! -s "$publish/Mahjong.Server.dll" || ! -s "$publish/index.html" ]]; then
  echo "Missing published server or index.html in $publish" >&2
  exit 1
fi
for notice in LICENSE licenses/{THIRD-PARTY,Microsoft.NET-MIT,Apache-2.0,SQLitePCLRaw-NOTICE,Microsoft.Extensions.DependencyModel-NOTICES}.txt; do
  if [[ ! -s "$publish/$notice" ]]; then
    echo "Missing published license or notice: $publish/$notice" >&2
    exit 1
  fi
done

umask 077
mkdir -p artifacts
work="$PWD/artifacts/infra-smoke-$$-$RANDOM"
mkdir -- "$work"
data="$work/data"
restored="$work/restored"
archive="$work/data.tar"
state="$work/guest.json"
mount=${SMOKE_PATH_BASE:-}
export TMPDIR="$work/scratch"
mkdir -- "$TMPDIR"
server_pid=

stop_server() {
  local pid=$server_pid
  server_pid=
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid"
  fi
  wait "$pid"
}

cleanup() {
  local status=$?
  if [[ -n $server_pid ]]; then
    stop_server || true
  fi
  rm -rf -- "$data" "$restored" "$archive" "$state" "$TMPDIR"
  if (( status == 0 )); then
    rm -rf -- "$work"
  else
    echo "Published smoke failed; server logs: $work/*.log" >&2
  fi
}
trap cleanup EXIT

start_server() {
  local directory=$1 log=$2
  (
    cd -- "$publish"
    exec env -u Mahjong__BehindHttpsProxy -u Mahjong__PublicOrigin -u DOTNET_ENVIRONMENT \
      ASPNETCORE_ENVIRONMENT="${ASPNETCORE_ENVIRONMENT:-Production}" \
      Mahjong__DataDirectory="$directory" \
      BASE_URL="$mount" \
      dotnet ./Mahjong.Server.dll --urls http://127.0.0.1:0 \
      --Logging:LogLevel:Microsoft.Hosting.Lifetime=Information
  ) > "$log" 2>&1 &
  server_pid=$!
  for (( attempt=0; attempt<160; attempt++ )); do
    origin=$(sed -nE 's#^.*Now listening on: (http://127\.0\.0\.1:[0-9]+)$#\1#p' "$log")
    if [[ -n $origin ]]; then
      return
    fi
    kill -0 "$server_pid" 2>/dev/null || break
    sleep 0.25
  done
  echo "Published server did not start; see $log" >&2
  return 1
}

start_server "$data" "$work/server.log"
if [[ ${4:-} == --with-browser ]]; then
  specs=()
  if [[ -n ${mount%/} ]]; then specs+=(e2e/mount.spec.ts); fi
  BASE_URL="$origin${mount%/}/" PLAYWRIGHT_HTML_OPEN=never npm --prefix web run test:e2e -- \
    --project=chromium --project=webkit --reporter=line,html --output="${SMOKE_PLAYWRIGHT_OUTPUT_DIR:-test-results}" "${specs[@]}"
fi
node scripts/smoke-runtime.mjs seed "$origin${mount%/}/" "$version" "$revision" "$state"
stop_server

test -s "$data/mahjong.db"
compgen -G "$data/keys/key-*.xml" >/dev/null
tar -cpf "$archive" -C "$data" .
mkdir -- "$restored"
tar -xpf "$archive" -C "$restored"

start_server "$restored" "$work/restore.log"
node scripts/smoke-runtime.mjs resume "$origin${mount%/}/" "$version" "$revision" "$state"
stop_server
