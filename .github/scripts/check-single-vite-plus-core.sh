#!/usr/bin/env bash
# Fails unless the lockfile resolves exactly one @voidzero-dev/vite-plus-core version. vite-plus and the
# `vite` alias in pnpm-workspace.yaml must move together, and a split update still installs and passes the other
# checks while carrying two cores (#116). Takes the lockfile path, pnpm-lock.yaml by default.
set -euo pipefail

lockfile="${1:-pnpm-lock.yaml}"

# Every resolved package is a key indented two spaces: '@voidzero-dev/vite-plus-core@<version>' or
# '@voidzero-dev/vite-plus-core@<version>(<peers>)'.
versions=$(grep -oE "^  '@voidzero-dev/vite-plus-core@[^(':]+" "$lockfile" | sed 's/.*@//' | sort -u || true)
count=$(printf '%s' "$versions" | grep -c . || true)

if [ "$count" -ne 1 ]; then
  echo "Expected one @voidzero-dev/vite-plus-core version in $lockfile, found $count:" >&2
  printf '%s\n' "$versions" >&2
  echo "Move vite-plus and the vite alias in pnpm-workspace.yaml's catalog to the same release." >&2
  exit 1
fi

echo "One @voidzero-dev/vite-plus-core version: $versions"
