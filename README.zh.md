# DSH Web 测试插件

[English](README.md) | 中文

## 概述

将 Web 测试能力开发为原版 DeepSeek Harness 可安装的插件。当前开发工作区是 [dsh-plugin-web-test](dsh-plugin-web-test/package.json)，拥有独立的依赖和构建工具，与之前的 DSH 宿主源码分离。

## 开发

根目录运行 `pnpm install` 会执行 Git 钩子安装，需要对仓库配置的钩子目录具有写入权限。以下命令转发到拥有独立依赖的插件工作区：

```sh
pnpm run typecheck
pnpm run test
pnpm run build
```

这些检查不代表桌面验收通过。测试候选包前，阅读[插件说明](dsh-plugin-web-test/packages/web-test/README.zh.md)、[Windows 清单](dsh-plugin-web-test/packages/web-test/WINDOWS-ACCEPTANCE.zh.md)及 `.agents/notes/proposed/testing/` 中对应的交付记录。

## 项目资料

- [可安装插件计划](.agents/notes/proposed/architecture/2026-10-04-web-testing-installable-plugin-plan.zh.md)定义交付路线。
- [产品需求](.agents/notes/proposed/feature/2026-09-28-web-testing-requirements.zh.md)保留 R01–R58。
- `dsh-plugin-web-test/dist/` 保留历史安装包；构建命令不覆盖这些包。
- `docs/` 与 `.agents/` 保留参考资料和验收证据；早期宿主实现记录属于历史背景。

仓库保留独立插件、开发入口和参考资料。旧宿主实现可从 Git 历史恢复；参考文档可能描述早期宿主目录，当前插件开发使用上方命令。已经安装的 DSH 程序及其个人数据位于本仓库之外。
