#!/usr/bin/env bash
# Run inside a disposable Debian Node 24 container, with this repo at /source
# read-only. Never installs Linux dependencies into the macOS workspace.
set -euo pipefail
mkdir -p /audit
tar -C /source --exclude='./node_modules' --exclude='./.git' --exclude='./.venv' --exclude='./release' --exclude='./test-results' --exclude='./dist' --exclude='./dist-electron' -cf - . | tar -C /audit -xf -
cd /audit
if ! cmp -s package-lock.json node_modules/.imago-audit-lock; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq xvfb xauth libnspr4 libnss3 libgtk-3-0t64 libgbm1 libasound2t64 libxss1 libxtst6 libatspi2.0-0 libx11-xcb1 libxdamage1 libxrandr2 rpm > /tmp/imago-apt.log
  npm ci
  cp package-lock.json node_modules/.imago-audit-lock
fi
npm run verify
xvfb-run -a env IMAGO_E2E_NO_SANDBOX=1 npm run test:e2e
xvfb-run -a env IMAGO_E2E_NO_SANDBOX=1 npm run test:audit
npx electron-builder --linux AppImage deb rpm --arm64 --config build/electron-builder.cjs --publish never
xvfb-run -a env IMAGO_E2E_NO_SANDBOX=1 IMAGO_E2E_EXECUTABLE='/audit/release/linux-arm64-unpacked/nodus-imago' npm run test:e2e
xvfb-run -a env IMAGO_E2E_NO_SANDBOX=1 IMAGO_E2E_EXECUTABLE='/audit/release/linux-arm64-unpacked/nodus-imago' npm run test:audit
