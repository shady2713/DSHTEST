/**
 * Record fixtures for the plugin's tests.
 *
 * Each builder returns a record in the shape the durable schema declares, so a
 * schema change fails these tests at the fixture rather than at an assertion
 * about behaviour.
 *
 * @module dsh-plugin-web-test/tests/support/seed
 */

/** A project under test. */
export function project(key = 'shop'): Record<string, unknown> {
  return {
    schemaVersion: 3,
    kind: 'project',
    key,
    label: key,
    updatedAtMs: 1,
    sourceRoot: 'C:/src/shop',
    baseUrl: 'http://127.0.0.1:5173/',
  }
}

/** An environment revision declaring the roles cases may act as. */
export function environment(key = 'shop-test', roles = ['admin']): Record<string, unknown> {
  return {
    schemaVersion: 3,
    kind: 'environment-revision',
    key,
    label: key,
    updatedAtMs: 1,
    projectKey: 'shop',
    revision: 1,
    name: 'local',
    url: 'http://127.0.0.1:5173/',
    nature: 'test',
    dataOperations: 'business-entry-writes',
    roles: roles.map(name => ({ name, accountRef: `ref:${name}` })),
    scopeNotes: 'local test page',
    modelRef: '',
    viewport: { width: 1280, height: 800 },
    confirmedAtMs: 1,
  }
}

/** A run in a chosen status, owned by a chosen session. */
export function run(
  key = 'run-1',
  owner = 'session-a',
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 3,
    kind: 'run',
    key,
    label: key,
    updatedAtMs: 1,
    projectKey: 'shop',
    environmentRevisionKey: 'shop-test',
    phase: 'execution',
    status: 'running',
    unresolvedOperations: {},
    ownerSessionId: owner,
    ...extra,
  }
}

/** A case as analysis proposed it, before any operator ruling. */
export function casePlan(
  runKey = 'run-1',
  caseKey = 'home-title',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 3,
    kind: 'case-plan',
    key: `${runKey}/${caseKey}`,
    runKey,
    projectKey: 'shop',
    environmentRevisionKey: 'shop-test',
    caseKey,
    title: '首页标题',
    status: 'proposed',
    steps: [
      { index: 1, intent: '打开首页', expectation: '页面加载完成' },
      { index: 2, intent: '读取标题', expectation: '标题非空' },
    ],
    notes: '',
    confirmedAtMs: 0,
    label: '首页标题',
    updatedAtMs: 1,
    ...overrides,
  }
}

/** Collect records into the seed shape the harness accepts. */
export function seedOf(tables: SeedTables): Record<string, Record<string, unknown>> {
  return tables
}

type SeedTables = Record<string, Record<string, unknown>>
