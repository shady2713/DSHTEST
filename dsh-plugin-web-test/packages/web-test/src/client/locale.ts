/**
 * Localized copy for the Web testing settings section.
 *
 * Every product-visible string the Client half shows lives here. `zh` and `en`
 * are both required: the locale runtime rejects a namespace that registers only
 * one of them.
 */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

export const NS = 'settings.webTest'

/** Simplified Chinese dictionary. */
export const zh = {
  title: 'Web 测试',
  heading: 'Web 测试',
  description: '在本机用真实 Chrome 或 Edge 执行已确认的 Web 测试用例，保存截图证据与报告。',
  state: '状态',
  stateActive: '运行中',
  stateDraining: '正在停止',
  version: '版本',
  dataRoot: '数据目录',
  schemaVersion: '数据版本',
  projects: '项目',
  runs: '运行',
  dshVersion: '宿主版本',
  loading: '正在读取插件状态…',
  projectsHeading: '项目',
  environmentsHeading: '入口与环境声明',
  noProjects: '尚未登记项目。对话中指定项目与网址后会出现在这里。',
  noEnvironments: '该项目尚未确认入口环境。',
  nature: '环境性质',
  natureTest: '测试',
  natureProduction: '生产',
  natureUnknown: '未知（未确认）',
  dataOperations: '数据操作',
  dataReadOnly: '只读',
  dataBusinessWrites: '允许经业务入口写入',
  viewport: '视口',
  roles: '角色',
  noRoles: '未登记',
  readOnlyNotice: '此分区只读展示。登记与修改项目、环境声明请在对话中提出。',
  unavailable: '无法连接 Web 测试插件：{reason}',
}

/** English dictionary. */
export const en = {
  title: 'Web testing',
  heading: 'Web testing',
  description: 'Run confirmed Web test cases in a real Chrome or Edge on this machine, with screenshots and reports.',
  state: 'State',
  stateActive: 'Active',
  stateDraining: 'Stopping',
  version: 'Version',
  dataRoot: 'Data root',
  schemaVersion: 'Schema version',
  projects: 'Projects',
  runs: 'Runs',
  dshVersion: 'Host version',
  loading: 'Reading plugin status…',
  projectsHeading: 'Projects',
  environmentsHeading: 'Entry points and environment declarations',
  noProjects: 'No project recorded yet. Name a project and its URL in conversation and it appears here.',
  noEnvironments: 'No entry point confirmed for this project yet.',
  nature: 'Nature',
  natureTest: 'Test',
  natureProduction: 'Production',
  natureUnknown: 'Unknown (not confirmed)',
  dataOperations: 'Data operations',
  dataReadOnly: 'Read-only',
  dataBusinessWrites: 'Business-entry writes allowed',
  viewport: 'Viewport',
  roles: 'Roles',
  noRoles: 'None recorded',
  readOnlyNotice: 'This section is read-only. Ask in conversation to record or change projects and environment declarations.',
  unavailable: 'Cannot reach the Web testing plugin: {reason}',
}

/** One environment declaration as the Client renders it. */
export interface WebTestEnvironmentSummary {
  readonly name: string
  readonly url: string
  readonly nature: 'test' | 'production' | 'unknown'
  readonly dataOperations: 'read-only' | 'business-entry-writes'
  readonly roles: readonly string[]
  readonly viewport: { readonly width: number, readonly height: number }
}

/** One project with its declared entry points. */
export interface WebTestProjectSummary {
  readonly key: string
  readonly label: string
  readonly baseUrl: string
  readonly environments: readonly WebTestEnvironmentSummary[]
}

/** Values injected into the settings section. */
export interface WebTestSettingsData {
  /** Status read from the Host when the section mounted. */
  readonly status: PluginStatus | undefined
  /** Why the status could not be read, when the Remote call failed. */
  readonly failure: string | undefined
  /** Recorded projects with their declared entry points. */
  readonly projects: readonly WebTestProjectSummary[]
}

/** Status the section renders, mirroring the Host service's own projection. */
export interface PluginStatus {
  readonly version: string
  readonly state: 'active' | 'draining'
  readonly dataRoot: string
  readonly schemaVersion: number
  readonly recordCounts: {
    readonly project: number
    readonly 'environment-revision': number
    readonly run: number
  }
  readonly dshVersion: string
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.webTest': keyof typeof zh
  }
}
