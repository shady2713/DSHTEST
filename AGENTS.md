# DSH Web Testing Plugin

The active implementation is the independent workspace at `dsh-plugin-web-test/`. Keep that path stable so Ubuntu development, Windows acceptance, and delivery scripts address the same files.

## Scope

- Implement capabilities through the original DSH public plugin APIs. Do not modify or recreate the upstream host, Electron application, agent loop, or internal browser implementation.
- The repository contains the independent plugin and its development entry points. The former root `apps/`, `packages/`, `vendor/`, and other host implementation directories remain recoverable from Git history; `docs/` and `.agents/notes/` retain reference and acceptance material.
- Read the installable-plugin plan in `.agents/notes/proposed/architecture/2026-10-04-web-testing-installable-plugin-plan.md` and the relevant R01–R58 requirements before changing behavior. Historical host implementation notes do not change the selected plugin delivery route.
- Preserve existing acceptance records, archived notes, release tarballs, and unrelated user work. Never overwrite a previously handed-off package to repair its hash.

## Development

- The plugin owns its manifest, lockfile, TypeScript configurations, tests, and build tools under `dsh-plugin-web-test/`. Use its published DSH dependencies; do not add workspace links to the retired host source.
- Root `pnpm run typecheck`, `pnpm run test`, and `pnpm run build` delegate to the independent plugin workspace. Root dependencies only support Git hooks.
- Keep Host and Client compiler programs separate. Preserve typed Remote generation and validate actual tool execution results against the definitions registered with the host.
- For lifecycle and authorization work, verify ownership by Agent, run, role, and generation, including failure and cancellation paths. Await owned resource disposal.
- Keep business rules, UI text, and documentation synchronized. Preserve English/Chinese package documentation. The former host-wide documentation and lint commands are not part of this local plugin entry point.

## Verification and handoff

- Report the exact commit, package version, tarball hash, commands executed, and remaining limitations. Unit tests, static checks, and Ubuntu results do not establish Windows desktop acceptance.
- Windows desktop verification uses the user's original installed DSH and its supported plugin management entry points. Do not substitute a private Desktop Host launch for desktop acceptance.
- Do not publish credentials or raw logs containing launch tokens. Restrict permission changes to the plugin's own verified data paths and keep user data recoverable.
- Commits, pushes, PRs, publication, and irreversible operations require explicit authorization; existing authorization remains valid within its scope.
- Keep cleanup and acceptance work separate from Ubuntu business-code changes. A repository cleanup does not replace an existing delivery candidate or establish its acceptance.
