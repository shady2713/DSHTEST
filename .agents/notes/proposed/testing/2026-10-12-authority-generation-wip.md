# 授权绑定代次：实现已写好，用例未调绿

合并清理分支之后处理 Windows 报告的授权缺陷时留下的现场。**这里记的是
未完成的改动，不是结论。**

## Windows 报告的两个放行组合

Windows 从目标提交原样提取 `guardReason`、`mayPrepareIdentity`、
`serverNameOf` 及相关常量组合执行，**没有把 `mayPrepareIdentity` 固定 mock 成
false**（仓库里原有的用例正是固定 mock 成 false，所以它们一直是绿的）。

1. 运行核验了 buyer 后切到 seller，旧 buyer 挂载与认领仍为第 1 代 →
   buyer 无 authority 的 `browser_click` **被错误放行**
2. 运行已在第 2 代、`activeRole` 为空，旧挂载与认领都仍为第 1 代 →
   旧 buyer 无 authority 的 `browser_click` **被错误放行**

原因：

- `mayPrepareIdentity` 只在「当前 activeRole 的准备窗口」上关闭。角色切换后
  旧角色重新获得窗口，因为此刻 activeRole 已经是别人了。
- 准备路径只比较 `claim.generation` 与 `owner.generation`。两份旧记录相等时
  仍放行，**从来没有和运行当前的代次比过**。
- 这两条都提前返回，根本到不了 `requireAuthority`。

## 已实现的修改（在补丁里）

未提交的实现改动仍在本地 git stash（`git stash list` 里的 web-test-plugin 条目，293 行）

- `roleIdentityRecordSchema` 增加 `generation`，`putIdentity` 写入运行当前代次。
  没有它就答不出「本代次是否已核验」。
- `mayPrepareIdentity` 增加 `generation` 参数：要求 `run.generation` 与调用方
  带来的代次一致；并且「本代次已核验」就永久关闭该角色的窗口，不再因为
  activeRole 变成别人而重新打开。
- 新增 `generationOf(runKey)`，让守卫能问「运行现在在哪一代」。
- `guardReason` 的准备分支要求 `claim.generation`、`owner.generation` 与
  **运行的当前代次**三者一致。

## 没有做完的

三条真实 store 的组合用例已经写进 `tests/browser-dispatch.spec.ts`：

- 已核验角色被拒 / 未核验角色仍可准备
- 切换到 seller 后旧 buyer 被拒
- owner=1、claim=1、liveRun=2 被拒，且 liveRun=2 的挂载仍可用

但**它们没跑绿**，并且**打坏了两个既有用例**
（`browser-dispatch.spec.ts` 的「withholds the browser while a run is paused」
与「restores it on resume」）。既有用例报的是
`expected 'web-test: this action needs the authority' to be undefined`。

已知可疑点：

- `ownedBy()` 测试助手默认代次是 1，`run()` 种子运行也是 1，而新写的
  `identity()` 助手没有 `generation` 字段，被 schema 默认成 0。两者一旦被
  任何一处比较就会不一致。
- `requireAuthority` 的最后一项要求
  `activeRole === authority.role && verifiedAccount(...) !== ''`。
  `assumeRole` 是否在改动后仍会写入 activeRole 与身份，尚未确认。

**在查清之前不要把这套改动合入。** 当前仓库停在
`1c0939616e`（ACL 部分），180 个测试通过。
