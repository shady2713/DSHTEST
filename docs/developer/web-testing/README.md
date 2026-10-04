---
description: Requirements, design, acceptance, and development-task navigation for the Web testing desktop application.
---

# Web testing application: development handoff

English | [中文](README.zh.md)

<a id="summary"></a>

## Summary

Use this reference to locate Web testing requirements, design, acceptance criteria, and development tasks. The [installable plugin plan](../../../.agents/notes/proposed/architecture/2026-10-04-web-testing-installable-plugin-plan.md) owns the selected delivery route and S0–S6 sequence: an external bundle in original DSH, with external Chrome/Edge first. Earlier specifications retain business requirements and historical evidence. The [collaboration guide](../../../.agents/notes/proposed/process/2026-09-28-web-testing-agent-guide.md) records earlier delivery status and work assignment. User instructions determine authorized work; documentation checks do not establish product acceptance.

<a id="contents"></a>

## Table of Contents

- [Reading order](#reading-order)
- [Specification owners](#specification-owners)
- [Development tasks](#development-tasks)
- [Repository locations](#repository-locations)
- [Dev Note](#dev-note)

<a id="reading-order"></a>

## Reading order

The user's current instruction determines the authorized task. Possession of these documents does not authorize development, commits, pushes, releases, deployments, or external messages.

1. Read the [root rules](../../../AGENTS.md), [collaboration guide](../../../.agents/notes/proposed/process/2026-09-28-web-testing-agent-guide.md), and [fixed baseline](../../../.agents/notes/proposed/process/2026-09-28-web-testing-upstream-baseline.md), including the [rc.2 incremental-upgrade impact and evidence limits](../../../.agents/notes/proposed/process/2026-09-28-web-testing-upstream-baseline.md#rc2-incremental-upgrade).
2. Read the [requirements](../../../.agents/notes/proposed/feature/2026-09-28-web-testing-requirements.md), [architecture](../../../.agents/notes/proposed/architecture/2026-09-28-web-testing-architecture.md), task-relevant detailed designs, and [acceptance criteria](../../../.agents/notes/proposed/testing/2026-09-28-web-testing-acceptance.md).
3. Read the [milestones](../../../.agents/notes/proposed/process/2026-09-28-web-testing-milestones.md), current task card, prerequisite evidence, applicable directory rules, and actual code. The guide provides [copyable assignment instructions](../../../.agents/notes/proposed/process/2026-09-28-web-testing-agent-guide.md#dispatch-instructions).

<a id="specification-owners"></a>

## Specification owners

Each document owns the subject below; update that owner instead of creating another specification copy.

| Document | Content it owns |
|---|---|
| [Product requirements](../../../.agents/notes/proposed/feature/2026-09-28-web-testing-requirements.md) | R01–R58, first-release scope, user interaction, and product restrictions |
| [Test case and report specification](../../../.agents/notes/proposed/feature/2026-09-28-web-testing-test-case-report-spec.md) | Expected-result authority, case confirmation, coverage denominators, result categories, defect packages, and reproduction evidence |
| [Technical architecture](../../../.agents/notes/proposed/architecture/2026-09-28-web-testing-architecture.md) | TD01–TD12, module responsibilities, data and call relationships, and I01–I05 |
| [Detailed design: interfaces and execution](../../../.agents/notes/proposed/architecture/2026-09-28-web-testing-design-execution.md) | DD01–DD05, browser/native targets, policy, Remote, and the capability matrix |
| [Detailed design: data and recovery](../../../.agents/notes/proposed/architecture/2026-09-28-web-testing-design-recovery.md) | DD06–DD09, durable authority, actions, recovery, versions, and attachment references |
| [Detailed design: models and release](../../../.agents/notes/proposed/architecture/2026-09-28-web-testing-design-models-release.md) | DD10–DD13, routing and measured benefit, installation and updates, and V01–V18 |
| [Upstream baseline and upgrades](../../../.agents/notes/proposed/process/2026-09-28-web-testing-upstream-baseline.md) | Baseline policy and pin verification, inherited rules, upstream reuse, required patches, and upgrade procedure |
| [Acceptance criteria and traceability](../../../.agents/notes/proposed/testing/2026-09-28-web-testing-acceptance.md) | AC01–AC58, G01–G16, scenarios, and final pass criteria |
| [Milestones and validation](../../../.agents/notes/proposed/process/2026-09-28-web-testing-milestones.md) | M0–M5, P01–P08, fixtures, resource budgets, and stage admission |
| [Agent development and collaboration guide](../../../.agents/notes/proposed/process/2026-09-28-web-testing-agent-guide.md) | Main agent/subagents, file write ownership, parallel work waves, review, and handoff |
| [Development coverage and handoff](../../../.agents/notes/proposed/testing/2026-09-28-web-testing-development-coverage.md) | The task accountable for each AC/G/V and evidence-index requirements |

<a id="development-tasks"></a>

## Development tasks

The six stage files contain 50 task cards. Their prerequisites and milestone admission criteria determine execution order. Waiting for an upstream embedded carrier is no longer required. Follow the [collaboration guide](../../../.agents/notes/proposed/process/2026-09-28-web-testing-agent-guide.md) to resume M0-T03's controlled browser integration and eligible [M1 foundation sub-items](../../../.agents/notes/proposed/process/2026-09-28-web-testing-tasks-m1.md#development-admission) in parallel. Limited development permission does not establish complete-card or stage acceptance.

| Stage | Task count | File and stage outcome |
|---|---|---|
| M0 | 11 | [Baseline validation](../../../.agents/notes/proposed/process/2026-09-28-web-testing-tasks-m0.md): fix rules and fixtures; verify key assumptions and product effectiveness |
| M1 | 7 | [Foundation assembly](../../../.agents/notes/proposed/process/2026-09-28-web-testing-tasks-m1.md): official desktop, contracts, minimal state, configuration/policy/project integration, and page observation |
| M2 | 9 | [Testing workflow](../../../.agents/notes/proposed/process/2026-09-28-web-testing-tasks-m2.md): analysis, cases, actual execution, evidence, and reports |
| M3 | 7 | [Durable tasks](../../../.agents/notes/proposed/process/2026-09-28-web-testing-tasks-m3.md): recovery, retries, takeover, stalled-progress detection, storage space, and resources |
| M4 | 10 | [Complete capabilities](../../../.agents/notes/proposed/process/2026-09-28-web-testing-tasks-m4.md): native/external browsers, complex business flows, regression, Skills, lightweight models, and specialized tests |
| M5 | 6 | [Acceptance and release](../../../.agents/notes/proposed/testing/2026-09-28-web-testing-tasks-m5.md): native installation/updates, all acceptance checks, a real 24-hour run, and delivery |

<a id="repository-locations"></a>

## Repository locations

The Git root contains the source, official rules, and application specifications. The root README links here; English and Chinese documents have equal authority under the [official pairing rules](../../i18n/README.md).

| Location relative to the Git root | Purpose |
|---|---|
| `AGENTS.md`, `docs/AGENTS.md`, applicable directory rules | Upstream development requirements |
| `README.md`, `README.zh.md`, `README.i18n.yaml` | Upstream introduction with application navigation |
| `docs/developer/web-testing/` | This handoff entry and its bilingual record |
| `.agents/notes/proposed/` | Application specifications classified by feature, architecture, process, and testing |
| `.artifacts/web-testing/` | Ignored local verification manifests and logs; regenerated when absent |

Read the [baseline policy](../../../.agents/notes/proposed/process/2026-09-28-web-testing-upstream-baseline.md#document-languages-and-entry-points) for upgrades and document ownership. Handoff must include the application documents as well as the DSH source. When those documents are uncommitted, a clone or worktree created only from Git history omits them; use the current directory or transfer and verify the uncommitted files. Local verification results do not establish acceptance in another environment.

<a id="dev-note"></a>

## Dev Note

None.
