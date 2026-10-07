#!/bin/bash
# 交付标识符同步检查：记录里的 source / sha256 / version / 包内文档
export PATH=/home/weetion/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin:$PATH
cd "$(git rev-parse --show-toplevel)"
# Which candidate to check. 0.8.0 is the already-accepted package and stays the
# default; a newer delivery passes its own version so this gate keeps guarding
# provenance instead of being skipped once work moves on.
V_CANDIDATE="${1:-0.8.0}"
P=.agents/notes/proposed/testing/2026-10-09-web-test-0.8.0-delivery-candidate.md
[ "$V_CANDIDATE" = "0.8.0" ] || P=$(ls .agents/notes/proposed/testing/*web-test-${V_CANDIDATE}-delivery-candidate.md 2>/dev/null | head -1)
[ -n "$P" ] || P=.agents/notes/proposed/testing/2026-10-09-web-test-${V_CANDIDATE}-delivery-candidate.md
D=dsh-plugin-web-test/dist/dsh-plugin-web-test-${V_CANDIDATE}.tgz
[ -f "$P" ] || { echo "✗ 交付记录 $P 不存在"; exit 1; }
echo "候选版本 $V_CANDIDATE  记录 $P"
fail=0
# The recorded SHA has to be a commit that produced the package, not merely the
# newest commit: a change elsewhere in the repository moves HEAD without touching
# anything npm packs. So compare the packaged paths between the recorded SHA and HEAD
# and only require them to be identical.
REC_SHA=$(grep -oP '^source   \K[0-9a-f]+' $P)
PACKAGED="dsh-plugin-web-test/packages/web-test/ dsh-plugin-web-test/dist/"
NEWEST="$(ls dsh-plugin-web-test/dist/dsh-plugin-web-test-*.tgz | sed -E 's/.*-(.*)\.tgz/\1/' | sort -V | tail -1)"
if ! git cat-file -e "$REC_SHA^{commit}" 2>/dev/null; then
  echo "✗ 记录里的 SHA $REC_SHA 不是仓库中的提交"; fail=1
elif [ "$V_CANDIDATE" != "$NEWEST" ]; then
  echo "— 已交付的旧候选 $V_CANDIDATE，不再要求其记录提交之后打包文件未变"
elif [ -n "$(git diff --name-only "$REC_SHA"..HEAD -- $PACKAGED)" ]; then
  echo "✗ 记录里的 SHA 之后被打包的文件变过，SHA 与哈希需一起重取："
  git diff --name-only "$REC_SHA"..HEAD -- $PACKAGED | sed 's/^/    /'
  fail=1
else echo "✓ 记录里的 SHA 之后被打包的文件未变"; fi
REC_HASH=$(grep -oP '^sha256   \K[0-9a-f]+' $P)
ACT_HASH=$(sha256sum $D | cut -d' ' -f1)
[ "$REC_HASH" = "$ACT_HASH" ] && echo "✓ 哈希与包一致" || { echo "✗ 哈希不符：记录 $REC_HASH 实际 $ACT_HASH"; fail=1; }
V=$(tar -xzOf $D package/package.json | grep -m1 '"version"' | grep -oP '0\.\d+\.\d+')
[ "$V" = "$V_CANDIDATE" ] && echo "✓ 包内版本 $V_CANDIDATE" || { echo "✗ 包内版本 $V，记录要求 $V_CANDIDATE"; fail=1; }
# Compare against the documents as they stood at the recorded source commit.
# Comparing a delivered package with today's workspace reports every later
# documentation edit as a stale package, which says nothing about that package.
for f in README.md README.zh.md WINDOWS-ACCEPTANCE.zh.md; do
  REF=dsh-plugin-web-test/packages/web-test/$f
  git show "$REC_SHA:$REF" > /tmp/delivery-doc.$$ 2>/dev/null || continue
  cmp -s <(tar -xzOf $D package/$f) /tmp/delivery-doc.$$ \
    && echo "✓ 包内 $f 与记录提交一致" || { echo "✗ 包内 $f 与记录提交不符"; rm -f /tmp/delivery-doc.$$; fail=1; }
done
exit $fail
rm -f /tmp/delivery-doc.$$
