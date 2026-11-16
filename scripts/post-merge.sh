#!/bin/bash
set -e

npm install --legacy-peer-deps
node scripts/ensure-vector.js pre
npm run db:push --force
node scripts/ensure-vector.js post
bash scripts/install-last30days.sh || echo "[post-merge] last30days vendor install failed (non-fatal)"
