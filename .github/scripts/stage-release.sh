#!/usr/bin/env bash
# The publish script changesets/action runs on main once no changesets are pending, that is, after the version PR
# is merged. It stages geo-resolve on npm through trusted publishing, then tags the release. Staging doesn't make
# the version live: the maintainer approves it with 2FA (see "Releasing" in the README).
set -euo pipefail

version=$(node -p 'require("./packages/geo-resolve/package.json").version')
tag="geo-resolve@$version"

# Every push to main runs this, so skip a version already staged (tagged) or published.
if git rev-parse --quiet --verify "refs/tags/$tag" >/dev/null; then
  echo "$tag is already tagged, so an earlier run staged it."
elif (cd "$RUNNER_TEMP" && npm view "$tag" version 2>/dev/null | grep -q .); then
  echo "$tag is already published."
else
  vp run geo-resolve#build
  tarball="$RUNNER_TEMP/geo-resolve-$version.tgz"
  # pnpm packs the tarball, because only pnpm applies `publishConfig.exports`, the same way CI packs the one it smoke-tests.
  (cd packages/geo-resolve && vp pm pack --out "$tarball")
  # npm runs from outside the repository, where the root package.json's devEngines (pnpm) would make it refuse.
  (cd "$RUNNER_TEMP" && npm stage publish "$tarball" --provenance)
fi

# Creates the tag unless it exists, and reports it through CHANGESETS_OUTPUT so changesets/action pushes it.
vp exec changeset git-tag
