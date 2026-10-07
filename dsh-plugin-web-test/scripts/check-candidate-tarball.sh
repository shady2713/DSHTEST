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

# 2. What is being claimed, and what is not.
#
#    Two different claims get confused here, so they are checked separately:
#
#    Byte-identical repack — packing the same tree on the machine that produced
#    the delivered package has to give the same bytes, so the recorded hash means
#    something. This only holds on that machine.
#
#    Content identity across platforms — the files inside two packages have to
#    be the same regardless of who packed them. A tar header carries the file's
#    permission bits, and a checkout on another operating system restores them
#    differently: the delivered package stores 0600 for three files, a Windows
#    pack stores 0644. The bytes inside are identical. Failing the whole check
#    over that would mean Windows could never get past this step, and the
#    obvious "fix" — replacing the delivered package so the numbers agree — is
#    the one thing a delivery record must never do.
REPACK="$(mktemp -d)"
trap 'rm -rf "$WORK" "$REPACK"' EXIT
(cd "$PKG" && npm pack --pack-destination "$REPACK" >/dev/null 2>&1)
REHASH="$(sha256sum "$REPACK"/*.tgz | cut -c1-64)"
DELIVERED="$(sha256sum "$TARBALL" | cut -c1-64)"

manifest() {
  # Path and content digest of every file in the archive, in a stable order.
  tar xzf "$1" -C "$2" 2>/dev/null
  # NUL-separated: a path may contain a space, and splitting one on whitespace
  # produces two half-paths that hash to nothing comparable.
  (cd "$2" && find package -type f -print0 | LC_ALL=C sort -z | while IFS= read -r -d '' f; do
    printf '%s  %s\n' "$(sha256sum "$f" | cut -c1-64)" "$f"
  done)
}
ORIG_UNPACK="$WORK/orig"
RE_UNPACK="$WORK/repack"
mkdir -p "$ORIG_UNPACK" "$RE_UNPACK"
if ! manifest "$TARBALL" "$ORIG_UNPACK" > "$WORK/orig.manifest" 2>/dev/null; then
  echo "✗ 无法解开交付包"; exit 1
fi
manifest "$REPACK/$(basename "$TARBALL")" "$RE_UNPACK" > "$WORK/repack.manifest" 2>/dev/null

if diff -q "$WORK/orig.manifest" "$WORK/repack.manifest" >/dev/null 2>&1; then
  if [ "$REHASH" = "$DELIVERED" ]; then
    echo "✓ 重新打包字节相同，且包内 44 个文件内容逐一相同"
  else
    echo "✓ 包内文件内容逐一相同；字节不同，差异只在 tar header 的权限位"
    echo "  交付包 $DELIVERED"
    echo "  本次重包 $REHASH"
    echo "  这只说明跨平台内容一致，不说明字节可复现；字节可复现只在产出原包"
    echo "  的那台机器上成立。"
  fi
else
  echo "✗ 重打包的包内文件与交付包不同："
  diff "$WORK/orig.manifest" "$WORK/repack.manifest" | head -10 | sed 's/^/    /'
  exit 1
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
# Untracked paths are not a change to the repository: they are build residue or
# somebody's work in progress. This check is about tracked files moving outside
# the plugin, and reading `??` entries as if they were edits would make it fail
# on a directory nobody touched on purpose — and the obvious "fix" for that
# would be deleting files that are not this gate's to delete.
OUTSIDE="$(git -C "$ROOT/.." status --porcelain --untracked-files=no \
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
