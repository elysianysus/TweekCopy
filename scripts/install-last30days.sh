#!/bin/bash
# Vendors the upstream mvanhorn/last30days-skill engine at a pinned tag.
# Idempotent: if vendor/last30days/.git already exists at the right SHA, skip.
set -e

PINNED_TAG="v3.1.0"
PINNED_SHA="1f7e85a03f262345e992ddebd7b0c121c2f2862e"
REPO_URL="https://github.com/mvanhorn/last30days-skill.git"
DEST="vendor/last30days"

mkdir -p "$(dirname "$DEST")"

if [ -d "$DEST/.git" ]; then
  CURRENT=$(git -C "$DEST" rev-parse HEAD 2>/dev/null || echo "")
  if [ "$CURRENT" = "$PINNED_SHA" ]; then
    echo "[install-last30days] already at $PINNED_TAG ($PINNED_SHA)"
    exit 0
  fi
  echo "[install-last30days] updating vendored copy to $PINNED_TAG"
  git -C "$DEST" fetch --depth 1 origin "refs/tags/$PINNED_TAG:refs/tags/$PINNED_TAG"
  git -C "$DEST" checkout --quiet "$PINNED_TAG"
else
  echo "[install-last30days] cloning $REPO_URL @ $PINNED_TAG"
  rm -rf "$DEST"
  git clone --depth 1 --branch "$PINNED_TAG" "$REPO_URL" "$DEST"
fi

NEW_SHA=$(git -C "$DEST" rev-parse HEAD)
if [ "$NEW_SHA" != "$PINNED_SHA" ]; then
  echo "[install-last30days] WARNING: expected SHA $PINNED_SHA, got $NEW_SHA"
fi

echo "[install-last30days] vendored at $NEW_SHA"
