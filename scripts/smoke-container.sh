#!/usr/bin/env bash
set -euo pipefail

if (( $# != 3 )); then
  echo "Usage: bash scripts/smoke-container.sh IMAGE VERSION COMMIT" >&2
  exit 2
fi

image=$1
version=$2
revision=$3
umask 077
mkdir -p artifacts
name="mahjong-smoke-$$-$RANDOM"
work="$PWD/artifacts/$name"
mkdir -- "$work"
volume="$name-data"
restored="$name-restored"
archive="$work/data.tar"
state="$work/guest.json"
container=
volumes=()

cleanup() {
  local status=$?
  if [[ -n $container ]]; then
    if (( status != 0 )); then
      docker logs --tail 100 "$container" >&2 || true
    fi
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
  if (( ${#volumes[@]} > 0 )); then
    docker volume rm "${volumes[@]}" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$work"
}
trap cleanup EXIT

actual_version=$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$image")
actual_revision=$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")
if [[ $actual_version != "$version" || $actual_revision != "$revision" ]]; then
  echo "Expected image labels version=$version revision=$revision, got version=$actual_version revision=$actual_revision" >&2
  exit 1
fi
printf 'Runtime image %s version=%s revision=%s\n' "$(docker image inspect --format '{{.Id}}' "$image")" "$actual_version" "$actual_revision"

start_container() {
  container=$(docker run -d --name "$name" --cap-drop ALL --security-opt no-new-privileges:true \
    --env Mahjong__AllowHttpLoopbackOrigin=true \
    --publish 127.0.0.1::8080 --mount "type=volume,source=$1,target=/data" "$image")
  origin="http://$(docker port "$container" 8080/tcp)"
}

stop_container() {
  docker stop --time 30 "$container" >/dev/null
  if [[ $(docker inspect --format '{{.State.ExitCode}}' "$container") != 0 ]]; then
    echo "Container failed to stop gracefully; will not archive its SQLite files" >&2
    return 1
  fi
  docker rm "$container" >/dev/null
  container=
}

wait_healthy() {
  local status
  for (( attempt=0; attempt<30; attempt++ )); do
    status=$(docker inspect --format '{{.State.Health.Status}}' "$container")
    case "$status" in
      healthy) return ;;
      unhealthy) break ;;
    esac
    sleep 1
  done
  echo "Docker readiness healthcheck did not become healthy" >&2
  docker inspect --format '{{json .State.Health}}' "$container" >&2
  return 1
}

docker volume create "$volume" >/dev/null
volumes+=("$volume")
start_container "$volume"
docker exec "$container" bash -ec '
  test "$(id -u)" -ne 0
  test -z "$(dotnet --list-sdks)"
  test -z "$(command -v node)"
  test -w /data
  test -w /data/keys
  for notice in LICENSE licenses/{THIRD-PARTY,Microsoft.NET-MIT,Apache-2.0,SQLitePCLRaw-NOTICE,Microsoft.Extensions.DependencyModel-NOTICES}.txt; do
    test -s "/app/$notice"
  done
'
wait_healthy
node scripts/smoke-runtime.mjs seed "$origin" "$version" "$revision" "$state"
docker exec "$container" bash -ec 'test -s /data/mahjong.db; compgen -G "/data/keys/key-*.xml" >/dev/null'
stop_container

start_container "$volume"
node scripts/smoke-runtime.mjs resume "$origin" "$version" "$revision" "$state"
stop_container

docker run --rm --entrypoint tar --mount "type=volume,source=$volume,target=/data,readonly" "$image" \
  -C /data -cpf - . > "$archive"
docker volume create "$restored" >/dev/null
volumes+=("$restored")
docker run --rm -i --entrypoint tar --mount "type=volume,source=$restored,target=/data" "$image" \
  -C /data -xpf - < "$archive"

start_container "$restored"
node scripts/smoke-runtime.mjs resume "$origin" "$version" "$revision" "$state"
stop_container
