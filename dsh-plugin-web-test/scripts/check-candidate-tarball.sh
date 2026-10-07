#!/usr/bin/env bash
# Verify the 0.8.1 candidate tarball as a consumer receives it: install the tgz
# into a clean project, then read the version and the exports back out of
# node_modules. Loading the workspace sources proves neither the package's
# export map nor that its dependencies resolve on their own.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="$ROOT/packages/web-test"
# Newest by version, not first by name: `ls` sorts 0.1.1 before 0.8.1.
TARBALL="$(ls "$ROOT"/dist/dsh-plugin-web-test-*.tgz | sort -V | tail -1)"
[ -f "$TARBALL" ] || { echo "✗ 找不到候选包"; exit 1; }

echo "候选包 $(basename "$TARBALL")"
echo "     $(sha256sum "$TARBALL" | cut -c1-64)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1. The documentation the verifier follows has to be the one in the tarball.
#    Editing it without repacking is how it silently goes stale.
UNPACK="$WORK/unpack"
mkdir -p "$UNPACK"
tar xzf "$TARBALL" -C "$UNPACK"
for doc in README.md README.zh.md WINDOWS-ACCEPTANCE.zh.md; do
  if diff -q "$PKG/$doc" "$UNPACK/package/$doc" >/dev/null 2>&1; then
    echo "✓ 包内 $doc 与工作区一致"
  else
    echo "✗ 包内 $doc 已过期，需重建"; exit 1
  fi
done

# 2. Packing the same tree twice has to give the same bytes, so the recorded
#    hash means something.
REPACK="$(mktemp -d)"
trap 'rm -rf "$WORK" "$REPACK"' EXIT
(cd "$PKG" && npm pack --pack-destination "$REPACK" >/dev/null 2>&1)
REHASH="$(sha256sum "$REPACK"/*.tgz | cut -c1-64)"
if [ "$REHASH" = "$(sha256sum "$TARBALL" | cut -c1-64)" ]; then
  echo "✓ 重新打包得到同样的字节"
else
  echo "✗ 重新打包得到 $REHASH，与交付包不同"; exit 1
fi

# 3. Install it the way a consumer does, and read the version back.
APP="$WORK/app"
mkdir -p "$APP"
printf '{"name":"candidate-check","private":true,"version":"1.0.0","type":"module"}' \
  > "$APP/package.json"
(cd "$APP" && npm install "$TARBALL" --no-audit --no-fund >/dev/null 2>&1)

VERSION="$(cd "$APP" && node -p "require('dsh-plugin-web-test/package.json').version")"
echo "✓ 全新安装后 manifest 版本 $VERSION"

(cd "$APP" && node -e "
import('dsh-plugin-web-test/store-service').then((m) => {
  if (m.PLUGIN_VERSION !== process.argv[1]) {
    console.error('✗ web_test_status 会报 ' + m.PLUGIN_VERSION + '，与 manifest 不符')
    process.exit(1)
  }
  console.log('✓ web_test_status 会报 ' + m.PLUGIN_VERSION)
})" "$VERSION")

echo "✓ 全新安装通过"

# 4. Nothing may be changed in the monorepo's other web-test packages. The
#    plugin under delivery is dsh-plugin-web-test; packages/*/web-test is a
#    different implementation and editing it to suit this one is the mistake this
#    check exists to catch.
OUTSIDE="$(git -C "$ROOT/.." status --porcelain \
  | awk '{print $2}' \
  | grep -vE '^\.agents/notes/proposed/testing/' \
  | grep -vE '^dsh-plugin-web-test/' \
  || true)"
if [ -z "$OUTSIDE" ]; then
  echo "✓ 改动都在插件仓库内"
else
  echo "✗ 以下改动落在插件仓库之外："; echo "$OUTSIDE" | sed 's/^/    /'; exit 1
fi

# 5. A reverted source file still packs and installs cleanly, so nothing above
#    notices it. A whole-tree diff is not enough either: reverting one file
#    leaves the others dirty. So name the files that carry the fixes and require
#    each of them to still differ from the baseline commit.
REPO="$ROOT/.."
BASELINE="${DSH_BASELINE:-993a2e9bc793c27436b148b5c5a2b4d15821a1dd}"
MISSING=""
for f in \
  dsh-plugin-web-test/packages/web-test/src/agent.ts \
  dsh-plugin-web-test/packages/web-test/src/role-browser.ts \
  dsh-plugin-web-test/packages/web-test/src/store-service.ts \
  dsh-plugin-web-test/packages/web-test/src/domain/store.ts \
  dsh-plugin-web-test/packages/web-test/src/index.ts
do
  if [ -z "$(git -C "$REPO" diff --name-only "$BASELINE" -- "$f")" ]; then
    MISSING="$MISSING $f"
  fi
done
if [ -z "$MISSING" ]; then
  echo "✓ 五处修复所在文件均相对基线有改动"
else
  echo "✗ 以下文件与基线一致，改动可能已被回退："; echo "$MISSING" | tr ' ' '\n' | sed 's/^/    /'
  exit 1
fi
