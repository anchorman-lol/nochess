#!/bin/sh
# Deploys the rater and the reviewer as systemd services to a Debian host with Node 24 or newer,
# from a clean checkout. Their keys are copied from $KEYS/<service>.hex only where the host has
# none, so redeploying never changes who they are.
#   DEPLOY_HOST=magikarp KEYS=path/to/keys deploy/services.sh
set -eu
host=${DEPLOY_HOST:-magikarp}
services="rater reviewer"
app=/opt/nochess-services
cd "$(dirname "$0")/.."
git diff --quiet HEAD || {
  echo "commit or stash local changes first" >&2
  exit 1
}

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
chmod 755 "$stage"
git archive HEAD package.json pnpm-lock.yaml pnpm-workspace.yaml packages/core tools deploy |
  tar -x -C "$stage"
(cd "$stage" && pnpm install --prod --frozen-lockfile --ignore-scripts --filter nochess... >/dev/null)

ssh "$host" sudo sh -s <<'REMOTE'
set -eu
[ -x /usr/games/stockfish ] || DEBIAN_FRONTEND=noninteractive apt-get install -y -q stockfish
id nochess-services >/dev/null 2>&1 ||
  useradd --system --home-dir /var/lib/nochess-services --shell /usr/sbin/nologin nochess-services
install -d -o root -g root -m 755 /opt/nochess-services /etc/nochess-services
for service in rater reviewer; do
  install -d -o nochess-services -g nochess-services -m 700 /var/lib/nochess-services \
    /var/lib/nochess-services/$service /var/lib/nochess-services/$service/.keys
done
REMOTE

rsync -a --delete -e 'ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=8' \
  --rsync-path="sudo rsync" "$stage/" "$host:$app/"
for service in $services; do
  key=/var/lib/nochess-services/$service/.keys/$service.hex
  ssh "$host" "sudo test -s $key" ||
    ssh "$host" "sudo install -o nochess-services -g nochess-services -m 600 /dev/stdin $key" \
      <"${KEYS:?KEYS must name the directory with rater.hex and reviewer.hex}/$service.hex"
done

ssh "$host" sudo sh -s <<REMOTE
set -eu
chown -R root:root $app
install -m 644 $app/deploy/rater.env $app/deploy/reviewer.env /etc/nochess-services/
install -m 644 $app/deploy/nochess@.service /etc/systemd/system/
systemctl daemon-reload
for service in $services; do
  systemctl enable --quiet nochess@\$service
  systemctl restart nochess@\$service
done
REMOTE
