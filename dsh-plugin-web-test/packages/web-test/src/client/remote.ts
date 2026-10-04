/**
 * Generated Remote contribution for the Web testing namespace.
 *
 * Written by dsh-plugin-web-test/scripts/generate-typert.mjs — do not edit.
 *
 * @module dsh-plugin-web-test/client/remote
 */

import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'

const projectRecord = z.object({
  schemaVersion: z.literal(3),
  kind: z.literal('project'),
  key: z.string().min(1),
  label: z.string(),
  updatedAtMs: z.number().int().nonnegative(),
  sourceRoot: z.string().min(1),
  baseUrl: z.string().min(1),
})

const pluginStatus = z.object({
  version: z.string(),
  state: z.union([z.literal('active'), z.literal('draining')]),
  dataRoot: z.string(),
  schemaVersion: z.number().int(),
  recordCounts: z.object({
    project: z.number().int().nonnegative(),
    'environment-revision': z.number().int().nonnegative(),
    run: z.number().int().nonnegative(),
    policy: z.number().int().nonnegative(),
    'case-result': z.number().int().nonnegative(),
  }),
  dshVersion: z.string(),
})

const environmentRevisionRecord = z.object({
  schemaVersion: z.literal(3),
  kind: z.literal('environment-revision'),
  key: z.string().min(1),
  projectKey: z.string().min(1),
  revision: z.number().int().nonnegative(),
  name: z.string().min(1),
  url: z.string().min(1),
  nature: z.enum(['test', 'production', 'unknown']),
  dataOperations: z.enum(['read-only', 'business-entry-writes']),
  roles: z.array(z.object({ name: z.string().min(1), accountRef: z.string() })),
  scopeNotes: z.string(),
  modelRef: z.string(),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  confirmedAtMs: z.number().int().nonnegative(),
  label: z.string(),
  updatedAtMs: z.number().int().nonnegative(),
})

const caseResultRecord = z.object({
  schemaVersion: z.literal(3),
  kind: z.literal('case-result'),
  key: z.string().min(1),
  runKey: z.string().min(1),
  projectKey: z.string().min(1),
  environmentRevisionKey: z.string().min(1),
  caseKey: z.string().min(1),
  outcome: z.enum(['passed', 'failed', 'skipped', 'blocked', 'incomplete']),
  steps: z.array(z.object({
    index: z.number().int().positive(),
    intent: z.string().min(1),
    observed: z.string(),
    outcome: z.enum(['passed', 'failed', 'skipped', 'blocked']),
    evidencePath: z.string(),
  })),
  assertions: z.array(z.object({
    expected: z.string().min(1),
    actual: z.string(),
    outcome: z.enum(['passed', 'failed', 'skipped', 'blocked']),
    reason: z.string(),
  })),
  evidencePaths: z.array(z.string()),
  openQuestions: z.array(z.string()),
  label: z.string(),
  updatedAtMs: z.number().int().nonnegative(),
})

const casePlanRecord = z.object({
  schemaVersion: z.literal(3),
  kind: z.literal('case-plan'),
  key: z.string().min(1),
  runKey: z.string().min(1),
  projectKey: z.string().min(1),
  environmentRevisionKey: z.string().min(1),
  caseKey: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(['proposed', 'confirmed', 'rejected']),
  steps: z.array(z.object({
    index: z.number().int().positive(),
    intent: z.string().min(1),
    expectation: z.string(),
  })),
  notes: z.string(),
  confirmedAtMs: z.number().int().nonnegative(),
  label: z.string(),
  updatedAtMs: z.number().int().nonnegative(),
})

const runRecord = z.object({
  schemaVersion: z.literal(3),
  kind: z.literal('run'),
  key: z.string().min(1),
  projectKey: z.string().min(1),
  environmentRevisionKey: z.string().min(1),
  phase: z.enum(['analysis', 'planning', 'execution', 'reporting', 'cleanup']),
  status: z.enum(['queued', 'running', 'awaiting-user', 'awaiting-business-time', 'paused', 'resuming', 'completed', 'cancelled', 'blocked']),
  unresolvedOperations: z.record(z.string(), z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('not-dispatched') }),
    z.object({ kind: z.literal('dispatching') }),
    z.object({ kind: z.literal('dispatched') }),
    z.object({ kind: z.literal('settled'), outcome: z.enum(['observed-success', 'observed-absent']) }),
    z.object({ kind: z.literal('unknown'), reason: z.string().min(1) }),
  ])),
  label: z.string(),
  updatedAtMs: z.number().int().nonnegative(),
})

const policyRecord = z.object({
  schemaVersion: z.literal(3),
  kind: z.literal('policy'),
  key: z.string().min(1),
  projectKey: z.string().min(1),
  externalActions: z.enum(['skip', 'confirm']),
  defaultViewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  failureSimulation: z.enum(['excluded', 'included']),
  label: z.string(),
  updatedAtMs: z.number().int().nonnegative(),
})
/** Result and parameter types, inferred from the same schemas the wire uses. */
type RemotePluginStatus = z.infer<typeof pluginStatus>
type RemoteProject = z.infer<typeof projectRecord>
type RemoteEnvironmentRevision = z.infer<typeof environmentRevisionRecord>
type RemotePolicy = z.infer<typeof policyRecord>
type RemoteCaseResult = z.infer<typeof caseResultRecord>
type RemoteRun = z.infer<typeof runRecord>
type RemoteCasePlan = z.infer<typeof casePlanRecord>

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace77656254657374 {
    status: () => Promise<{ ok: true, value: RemotePluginStatus } | { ok: false, error: { code: string, message: string } }>
    putProject: (project: RemoteProject) => Promise<{ ok: true, value: RemoteProject } | { ok: false, error: { code: string, message: string } }>
    listProjects: () => Promise<{ ok: true, value: RemoteProject[] } | { ok: false, error: { code: string, message: string } }>
    putEnvironment: (environment: RemoteEnvironmentRevision) => Promise<{ ok: true, value: RemoteEnvironmentRevision } | { ok: false, error: { code: string, message: string } }>
    listEnvironments: (projectKey: string) => Promise<{ ok: true, value: RemoteEnvironmentRevision[] } | { ok: false, error: { code: string, message: string } }>
    putPolicy: (policy: RemotePolicy) => Promise<{ ok: true, value: RemotePolicy } | { ok: false, error: { code: string, message: string } }>
    listCaseResults: (runKey: string) => Promise<{ ok: true, value: RemoteCaseResult[] } | { ok: false, error: { code: string, message: string } }>
    buildReport: (runKey: string) => Promise<{ ok: true, value: { markdown: string } } | { ok: false, error: { code: string, message: string } }>
    listRuns: () => Promise<{ ok: true, value: RemoteRun[] } | { ok: false, error: { code: string, message: string } }>
    listCases: (runKey: string) => Promise<{ ok: true, value: RemoteCasePlan[] } | { ok: false, error: { code: string, message: string } }>
    ruleOnCase: (runKey: string, caseKey: string, decision: 'confirm' | 'reject', note: string) => Promise<{ ok: true, value: RemoteCasePlan } | { ok: false, error: { code: string, message: string } }>
    controlRun: (runKey: string, action: 'pause' | 'resume' | 'cancel') => Promise<{ ok: true, value: RemoteRun } | { ok: false, error: { code: string, message: string } }>
    getRun: (runKey: string) => Promise<{ ok: true, value: RemoteRun } | { ok: false, error: { code: string, message: string } }>
  }
  interface TypertRemoteNamespaceMap {
    "webTest": TypertRemoteNamespace77656254657374
  }
}

export const TYPERT_REMOTE: TypertRemoteContribution = {
  package: "dsh-plugin-web-test",
  descriptors: [
    {
      id: "dsh-plugin-web-test#webTest/status",
      service: "webTest",
      namespace: "webTest",
      method: "status",
      invocation: { kind: 'direct' },
      parameters: [

      ],
      result: {
        mode: 'strict',
        typeSymbol: "dsh-plugin-web-test/types#PluginStatus",
        create: () => pluginStatus,
      },
    },
    {
      id: "dsh-plugin-web-test#webTest/putProject",
      service: "webTest",
      namespace: "webTest",
      method: "putProject",
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: "project",
          wire: "project",
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: "dsh-plugin-web-test/types#ProjectRecord",
            create: () => projectRecord,
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: "dsh-plugin-web-test/types#ProjectRecord",
        create: () => projectRecord,
      },
    },
    {
      id: "dsh-plugin-web-test#webTest/listProjects",
      service: "webTest",
      namespace: "webTest",
      method: "listProjects",
      invocation: { kind: 'direct' },
      parameters: [

      ],
      result: {
        mode: 'strict',
        typeSymbol: "dsh-plugin-web-test/types#ProjectRecord[]",
        create: () => z.array(projectRecord),
      },
    },
    {
      id: "dsh-plugin-web-test#webTest/putEnvironment",
      service: "webTest",
      namespace: "webTest",
      method: "putEnvironment",
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: "environment",
          wire: "environment",
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: "dsh-plugin-web-test/types#EnvironmentRevisionRecord",
            create: () => environmentRevisionRecord,
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: "dsh-plugin-web-test/types#EnvironmentRevisionRecord",
        create: () => environmentRevisionRecord,
      },
    },
    {
      id: "dsh-plugin-web-test#webTest/listEnvironments",
      service: "webTest",
      namespace: "webTest",
      method: "listEnvironments",
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: "projectKey",
          wire: "projectKey",
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: "dsh-plugin-web-test/types#string",
            create: () => z.string().min(1),
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: "dsh-plugin-web-test/types#EnvironmentRevisionRecord[]",
        create: () => z.array(environmentRevisionRecord),
      },
    },
    {
      id: "dsh-plugin-web-test#webTest/listCases",
      service: "webTest",
      namespace: "webTest",
      method: "listCases",
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: "runKey",
          wire: "runKey",
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: "dsh-plugin-web-test/types#string",
            create: () => z.string().min(1),
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: "dsh-plugin-web-test/types#CasePlanRecord[]",
        create: () => z.array(casePlanRecord),
      },
    },
    {
      id: "dsh-plugin-web-test#webTest/ruleOnCase",
      service: "webTest",
      namespace: "webTest",
      method: "ruleOnCase",
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: "runKey",
          wire: "runKey",
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: "dsh-plugin-web-test/types#string",
            create: () => z.string().min(1),
          },
        },
        {
          name: "caseKey",
          wire: "caseKey",
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: "dsh-plugin-web-test/types#string",
            create: () => z.string().min(1),
          },
        },
        {
          name: "decision",
          wire: "decision",
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: "dsh-plugin-web-test/types#'confirm' | 'reject'",
            create: () => z.union([z.literal('confirm'), z.literal('reject')]),
          },
        },
        {
          name: "note",
          wire: "note",
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: "dsh-plugin-web-test/types#string",
            create: () => z.string(),
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: "dsh-plugin-web-test/types#CasePlanRecord",
        create: () => casePlanRecord,
      },
    },
    {
      id: "dsh-plugin-web-test#webTest/controlRun",
      service: "webTest",
      namespace: "webTest",
      method: "controlRun",
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: "runKey",
          wire: "runKey",
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: "dsh-plugin-web-test/types#string",
            create: () => z.string().min(1),
          },
        },
        {
          name: "action",
          wire: "action",
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: "dsh-plugin-web-test/types#'pause' | 'resume' | 'cancel'",
            create: () => z.union([z.literal('pause'), z.literal('resume'), z.literal('cancel')]),
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: "dsh-plugin-web-test/types#RunRecord",
        create: () => runRecord,
      },
    },
    {
      id: "dsh-plugin-web-test#webTest/listRuns",
      service: "webTest",
      namespace: "webTest",
      method: "listRuns",
      invocation: { kind: 'direct' },
      parameters: [

      ],
      result: {
        mode: 'strict',
        typeSymbol: "dsh-plugin-web-test/types#RunRecord[]",
        create: () => z.array(runRecord),
      },
    },
    {
      id: "dsh-plugin-web-test#webTest/getRun",
      service: "webTest",
      namespace: "webTest",
      method: "getRun",
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: "runKey",
          wire: "runKey",
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: "dsh-plugin-web-test/types#string",
            create: () => z.string().min(1),
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: "dsh-plugin-web-test/types#RunRecord",
        create: () => runRecord,
      },
    },
    {
      id: "dsh-plugin-web-test#webTest/buildReport",
      service: "webTest",
      namespace: "webTest",
      method: "buildReport",
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: "runKey",
          wire: "runKey",
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: "dsh-plugin-web-test/types#string",
            create: () => z.string().min(1),
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: "dsh-plugin-web-test/types#Report",
        create: () => z.object({ markdown: z.string() }),
      },
    },
    {
      id: "dsh-plugin-web-test#webTest/listCaseResults",
      service: "webTest",
      namespace: "webTest",
      method: "listCaseResults",
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: "runKey",
          wire: "runKey",
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: "dsh-plugin-web-test/types#string",
            create: () => z.string().min(1),
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: "dsh-plugin-web-test/types#CaseResultRecord[]",
        create: () => z.array(caseResultRecord),
      },
    },
    {
      id: "dsh-plugin-web-test#webTest/putPolicy",
      service: "webTest",
      namespace: "webTest",
      method: "putPolicy",
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: "policy",
          wire: "policy",
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: "dsh-plugin-web-test/types#PolicyRecord",
            create: () => policyRecord,
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: "dsh-plugin-web-test/types#PolicyRecord",
        create: () => policyRecord,
      },
    },
  ],
}

export default TYPERT_REMOTE
