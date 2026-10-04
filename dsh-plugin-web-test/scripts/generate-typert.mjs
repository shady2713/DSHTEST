/**
 * Emit the plugin's Typert artifacts.
 *
 * The shipped `@deepseek-ai/dsh-typert-generator` discovers packages from a
 * DSH-monorepo aggregate tsconfig and does not resolve a service contribution
 * in this out-of-tree workspace: it emits a manifest with no services and no
 * invocations for this package. That is recorded as an S0 finding rather than
 * worked around silently.
 *
 * This script emits the same descriptor format the generator emits — verified
 * against `dsh-plugin-manager`'s generated `typert.remote-client.js` — so the
 * Host registers strict descriptors and the Client mounts its typed namespace.
 * It does not introduce a second RPC protocol: the endpoint grammar, the
 * result envelope, and the contribution shape are the Host's.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE = 'dsh-plugin-web-test'
const NAMESPACE = 'webTest'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'packages/web-test/lib')

/** Record schemas shared by both artifact faces. */
const recordSchemas = `
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
`

/** One Remote invocation, described once and shared by both faces. */
const invocations = [
  {
    method: 'status',
    parameters: [],
    result: { symbol: 'PluginStatus', create: '() => pluginStatus' },
  },
  {
    method: 'putProject',
    parameters: [
      { name: 'project', wire: 'project', symbol: 'ProjectRecord', create: '() => projectRecord' },
    ],
    result: { symbol: 'ProjectRecord', create: '() => projectRecord' },
  },
  {
    method: 'listProjects',
    parameters: [],
    result: { symbol: 'ProjectRecord[]', create: '() => z.array(projectRecord)' },
  },
  {
    method: 'putEnvironment',
    parameters: [
      { name: 'environment', wire: 'environment', symbol: 'EnvironmentRevisionRecord', create: '() => environmentRevisionRecord' },
    ],
    result: { symbol: 'EnvironmentRevisionRecord', create: '() => environmentRevisionRecord' },
  },
  {
    method: 'listEnvironments',
    parameters: [
      { name: 'projectKey', wire: 'projectKey', symbol: 'string', create: '() => z.string().min(1)' },
    ],
    result: { symbol: 'EnvironmentRevisionRecord[]', create: '() => z.array(environmentRevisionRecord)' },
  },
  {
    method: 'controlRun',
    parameters: [
      { name: 'runKey', wire: 'runKey', symbol: 'string', create: '() => z.string().min(1)' },
      { name: 'action', wire: 'action', symbol: "'pause' | 'resume' | 'cancel'", create: "() => z.union([z.literal('pause'), z.literal('resume'), z.literal('cancel')])" },
    ],
    result: { symbol: 'RunRecord', create: '() => runRecord' },
  },
  {
    method: 'listRuns',
    parameters: [],
    result: { symbol: 'RunRecord[]', create: '() => z.array(runRecord)' },
  },
  {
    method: 'getRun',
    parameters: [
      { name: 'runKey', wire: 'runKey', symbol: 'string', create: '() => z.string().min(1)' },
    ],
    result: { symbol: 'RunRecord', create: '() => runRecord' },
  },
  {
    method: 'buildReport',
    parameters: [
      { name: 'runKey', wire: 'runKey', symbol: 'string', create: '() => z.string().min(1)' },
    ],
    result: { symbol: 'Report', create: '() => z.object({ markdown: z.string() })' },
  },
  {
    method: 'listCaseResults',
    parameters: [
      { name: 'runKey', wire: 'runKey', symbol: 'string', create: '() => z.string().min(1)' },
    ],
    result: { symbol: 'CaseResultRecord[]', create: '() => z.array(caseResultRecord)' },
  },
  {
    method: 'putPolicy',
    parameters: [
      { name: 'policy', wire: 'policy', symbol: 'PolicyRecord', create: '() => policyRecord' },
    ],
    result: { symbol: 'PolicyRecord', create: '() => policyRecord' },
  },
]

const NAMESPACE_TYPED = Buffer.from(NAMESPACE).toString('hex').toUpperCase()
const id = method => `${PACKAGE}#${NAMESPACE}/${method}`

const hostJs = `/* Generated by dsh-plugin-web-test/scripts/generate-typert.mjs — do not edit. */
import { z } from 'zod'
${recordSchemas}
export const TYPERT = {
  package: ${JSON.stringify(PACKAGE)},
  face: 'host',
  schemas: [],
  model: {
    services: [{
      key: ${JSON.stringify(NAMESPACE)},
      exportName: 'WebTestService',
      tags: ['service'],
      description: 'Web testing service, its Storage Domain owner, and its typed Remote surface.',
      members: [],
      types: [],
    }],
    events: [],
    objects: [],
  },
  invocations: [
${invocations.map(invocation => `    {
      id: ${JSON.stringify(id(invocation.method))},
      service: ${JSON.stringify(NAMESPACE)},
      namespace: ${JSON.stringify(NAMESPACE)},
      method: ${JSON.stringify(invocation.method)},
      invocation: { kind: 'direct' },
      parameters: [
${invocation.parameters.map(parameter => `        {
          name: ${JSON.stringify(parameter.name)},
          wire: ${JSON.stringify(parameter.wire)},
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: ${JSON.stringify(`${PACKAGE}/types#${parameter.symbol}`)},
            create: ${parameter.create},
          },
        },`).join('\n')}
      ],
      result: {
        mode: 'strict',
        typeSymbol: ${JSON.stringify(`${PACKAGE}/types#${invocation.result.symbol}`)},
        create: ${invocation.result.create},
      },
    },`).join('\n')}
  ],
}
export default TYPERT
`

const remoteClientBody = `{
  package: ${JSON.stringify(PACKAGE)},
  descriptors: [
${invocations.map(invocation => `    {
      id: ${JSON.stringify(id(invocation.method))},
      service: ${JSON.stringify(NAMESPACE)},
      namespace: ${JSON.stringify(NAMESPACE)},
      method: ${JSON.stringify(invocation.method)},
      invocation: { kind: 'direct' },
      parameters: [
${invocation.parameters.map(parameter => `        {
          name: ${JSON.stringify(parameter.name)},
          wire: ${JSON.stringify(parameter.wire)},
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: ${JSON.stringify(`${PACKAGE}/types#${parameter.symbol}`)},
            create: ${parameter.create},
          },
        },`).join('\n')}
      ],
      result: {
        mode: 'strict',
        typeSymbol: ${JSON.stringify(`${PACKAGE}/types#${invocation.result.symbol}`)},
        create: ${invocation.result.create},
      },
    },`).join('\n')}
  ],
}
`

const remoteClientDts = `import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { PluginStatus, ProjectRecord } from './types/index.js'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace${Buffer.from(NAMESPACE).toString('hex').toUpperCase()} {
    status: () => Promise<{ ok: true, value: RemotePluginStatus } | { ok: false, error: { code: string, message: string } }>
    putProject: (project: RemoteProject) => Promise<{ ok: true, value: RemoteProject } | { ok: false, error: { code: string, message: string } }>
    listProjects: () => Promise<{ ok: true, value: RemoteProject[] } | { ok: false, error: { code: string, message: string } }>
  }
  interface TypertRemoteNamespaceMap {
    ${JSON.stringify(NAMESPACE)}: TypertRemoteNamespace${Buffer.from(NAMESPACE).toString('hex').toUpperCase()}
  }
}

export declare const TYPERT_REMOTE: TypertRemoteContribution
export default TYPERT_REMOTE
`

const hostDts = `export declare const TYPERT: unknown
export default TYPERT
`

// The browser half imports the contribution from the source tree, so the
// bundler can inline it with its zod factories; the package's `./remote`
// export is emitted from the same descriptor table for Host-side consumers.
const clientModule = `/**
 * Generated Remote contribution for the Web testing namespace.
 *
 * Written by dsh-plugin-web-test/scripts/generate-typert.mjs — do not edit.
 *
 * @module dsh-plugin-web-test/client/remote
 */

import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
${recordSchemas}/** Result and parameter types, inferred from the same schemas the wire uses. */
type RemotePluginStatus = z.infer<typeof pluginStatus>
type RemoteProject = z.infer<typeof projectRecord>
type RemoteEnvironmentRevision = z.infer<typeof environmentRevisionRecord>
type RemotePolicy = z.infer<typeof policyRecord>
type RemoteCaseResult = z.infer<typeof caseResultRecord>
type RemoteRun = z.infer<typeof runRecord>

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace${NAMESPACE_TYPED} {
    status: () => Promise<{ ok: true, value: RemotePluginStatus } | { ok: false, error: { code: string, message: string } }>
    putProject: (project: RemoteProject) => Promise<{ ok: true, value: RemoteProject } | { ok: false, error: { code: string, message: string } }>
    listProjects: () => Promise<{ ok: true, value: RemoteProject[] } | { ok: false, error: { code: string, message: string } }>
    putEnvironment: (environment: RemoteEnvironmentRevision) => Promise<{ ok: true, value: RemoteEnvironmentRevision } | { ok: false, error: { code: string, message: string } }>
    listEnvironments: (projectKey: string) => Promise<{ ok: true, value: RemoteEnvironmentRevision[] } | { ok: false, error: { code: string, message: string } }>
    putPolicy: (policy: RemotePolicy) => Promise<{ ok: true, value: RemotePolicy } | { ok: false, error: { code: string, message: string } }>
    listCaseResults: (runKey: string) => Promise<{ ok: true, value: RemoteCaseResult[] } | { ok: false, error: { code: string, message: string } }>
    buildReport: (runKey: string) => Promise<{ ok: true, value: { markdown: string } } | { ok: false, error: { code: string, message: string } }>
    listRuns: () => Promise<{ ok: true, value: RemoteRun[] } | { ok: false, error: { code: string, message: string } }>
    controlRun: (runKey: string, action: 'pause' | 'resume' | 'cancel') => Promise<{ ok: true, value: RemoteRun } | { ok: false, error: { code: string, message: string } }>
    getRun: (runKey: string) => Promise<{ ok: true, value: RemoteRun } | { ok: false, error: { code: string, message: string } }>
  }
  interface TypertRemoteNamespaceMap {
    ${JSON.stringify(NAMESPACE)}: TypertRemoteNamespace${NAMESPACE_TYPED}
  }
}

export const TYPERT_REMOTE: TypertRemoteContribution = ${remoteClientBody}
export default TYPERT_REMOTE
`

const remoteClientJs = `/* Generated by dsh-plugin-web-test/scripts/generate-typert.mjs — do not edit. */
import { z } from 'zod'
${recordSchemas}export const TYPERT_REMOTE = ${remoteClientBody}
export default TYPERT_REMOTE
`

await mkdir(join(root, 'packages/web-test/src/client'), { recursive: true })
await writeFile(join(root, 'packages/web-test/src/client/remote.ts'), clientModule, 'utf8')
console.log('typert: wrote src/client/remote.ts')

await mkdir(outDir, { recursive: true })
for (const [name, contents] of [
  ['typert.host.js', hostJs],
  ['typert.host.d.ts', hostDts],
  ['typert.remote-client.js', remoteClientJs],
  ['typert.remote-client.d.ts', remoteClientDts],
]) {
  await writeFile(join(outDir, name), contents, 'utf8')
  console.log(`typert: wrote lib/${name}`)
}
