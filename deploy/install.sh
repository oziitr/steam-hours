#!/bin/bash
set -euo pipefail
: "${PUBLIC_ORIGIN:?Set PUBLIC_ORIGIN to the HTTPS origin before installation}"
APP=/opt/steam-hours
NODE=/opt/plesk/node/24/bin/node
NPM=/opt/plesk/node/24/bin/npm
test ! -e "$APP/.env" || { echo 'Already installed; use a reviewed update procedure.'; exit 1; }
mkdir -p "$APP"
tar -xzf /tmp/steam-hours.tar.gz -C "$APP"
cd "$APP"
export PATH="/opt/plesk/node/24/bin:$PATH"
"$NPM" ci --omit=dev --ignore-scripts
"$NODE" scripts/setup.js
"$NODE" --input-type=module -e 'import fs from "node:fs"; const url = new URL(process.env.PUBLIC_ORIGIN); if(url.protocol !== "https:" || url.origin !== process.env.PUBLIC_ORIGIN) throw new Error("Invalid PUBLIC_ORIGIN"); fs.writeFileSync(".env", fs.readFileSync(".env", "utf8").replace("PUBLIC_ORIGIN=http://localhost:3480", "PUBLIC_ORIGIN=" + url.origin));'
id steam-hours >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin steam-hours
mkdir -p data
chown steam-hours:steam-hours data
chmod 700 data
chown root:steam-hours .env
chmod 640 .env
cp deploy/steam-hours.service /etc/systemd/system/steam-hours.service
systemctl daemon-reload
systemctl enable --now steam-hours
sleep 2
curl --fail --silent http://127.0.0.1:3480/health
