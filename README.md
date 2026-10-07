# DSH Web Testing Plugin

English | [中文](README.zh.md)

## Summary

Develop the Web testing capability as an installable plugin for the original DeepSeek Harness. The active workspace is [dsh-plugin-web-test](dsh-plugin-web-test/package.json); its own dependencies and build tools are separate from the former DSH host source.

## Development

Root `pnpm install` runs Git hook setup and requires write access to the repository's configured hooks directory. The following commands delegate to the independent plugin workspace, which owns its dependencies:

```sh
pnpm run typecheck
pnpm run test
pnpm run build
```

These checks do not establish desktop acceptance. Read the [plugin documentation](dsh-plugin-web-test/packages/web-test/README.md), [Windows checklist](dsh-plugin-web-test/packages/web-test/WINDOWS-ACCEPTANCE.zh.md), and the current delivery record under `.agents/notes/proposed/testing/` before testing a candidate.

## Project material

- [Installable-plugin plan](.agents/notes/proposed/architecture/2026-10-04-web-testing-installable-plugin-plan.md) defines the delivery route.
- [Product requirements](.agents/notes/proposed/feature/2026-09-28-web-testing-requirements.md) retain R01–R58.
- `dsh-plugin-web-test/dist/` retains historical tarballs. Build commands do not replace those packages.
- `docs/` and `.agents/` retain reference material and acceptance evidence; earlier host implementation notes are historical context.

The repository retains the independent plugin, development entry points, and reference material. The former host implementation is recoverable from Git history. Reference documents may describe that earlier host tree; the commands above apply to current plugin development. The existing installed DSH application and its personal data are outside this repository.
