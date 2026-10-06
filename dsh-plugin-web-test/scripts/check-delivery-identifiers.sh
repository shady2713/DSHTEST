#!/bin/bash
# 交付标识符同步检查：记录里的 source / sha256 / version / 包内文档
export PATH=/home/weetion/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin:$PATH
cd "$(git rev-parse --show-toplevel)"
P=.agents/notes/proposed/testing/2026-10-09-web-test-0.8.0-delivery-candidate.md
D=dsh-plugin-web-test/dist/dsh-plugin-web-test-0.8.0.tgz
fail=0
# The recorded SHA has to be a commit that produced the package, not merely the
# newest commit: a change elsewhere in the repository moves HEAD without touching
# anything npm packs. So compare the packaged paths between the recorded SHA and HEAD
# and only require them to be identical.
REC_SHA=$(grep -oP '^source   \K[0-9a-f]+' $P)
PACKAGED="dsh-plugin-web-test/packages/web-test/ dsh-plugin-web-test/dist/"
if ! git cat-file -e "$REC_SHA^{commit}" 2>/dev/null; then
  echo "✗ 记录里的 SHA $REC_SHA 不是仓库中的提交"; fail=1
elif [ -n "$(git diff --name-only "$REC_SHA"..HEAD -- $PACKAGED)" ]; then
  echo "✗ 记录里的 SHA 之后被打包的文件变过，SHA 与哈希需一起重取："
  git diff --name-only "$REC_SHA"..HEAD -- $PACKAGED | sed 's/^/    /'
  fail=1
else echo "✓ 记录里的 SHA 之后被打包的文件未变"; fi
REC_HASH=$(grep -oP '^sha256   \K[0-9a-f]+' $P)
ACT_HASH=$(sha256sum $D | cut -d' ' -f1)
[ "$REC_HASH" = "$ACT_HASH" ] && echo "✓ 哈希与包一致" || { echo "✗ 哈希不符：记录 $REC_HASH 实际 $ACT_HASH"; fail=1; }
V=$(tar -xzOf $D package/package.json | grep -m1 '"version"' | grep -oP '0\.\d+\.\d+')
[ "$V" = "0.8.0" ] && echo "✓ 包内版本 0.8.0" || { echo "✗ 包内版本 $V"; fail=1; }
for f in README.md README.zh.md WINDOWS-ACCEPTANCE.zh.md; do
  cmp -s <(tar -xzOf $D package/$f) dsh-plugin-web-test/packages/web-test/$f \
    && echo "✓ 包内 $f 与工作区一致" || { echo "✗ 包内 $f 已过期，需重建"; fail=1; }
done
exit $fail
