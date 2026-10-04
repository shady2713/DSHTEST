/**
 * Run report generation.
 *
 * A report is derived from recorded results only, so what it states can be
 * traced back to a case the plugin accepted. Anything the run could not settle
 * is carried through as an open question rather than smoothed into a pass.
 *
 * The Markdown, HTML and JSON exports share this one derivation, so the three
 * cannot disagree about what a run did.
 *
 * @module dsh-plugin-web-test/report
 */

import type { CaseResultRecord, OperationRecord, RunRecord } from './types.ts'

/** One count in a run's outcome tally. */
interface Tally {
  passed: number
  failed: number
  skipped: number
  blocked: number
  incomplete: number
}

/** Everything one run's report is derived from. */
export interface ReportInput {
  /** The run the report covers. */
  runKey: string
  /** Its recorded case results, in key order. */
  results: CaseResultRecord[]
  /** The run record, so the report states the run's own control state. */
  run?: RunRecord
  /** Its business-changing operations, so an unresolved one reaches the report. */
  operations?: OperationRecord[]
}

/**
 * The run-level verdict, as a machine-readable value.
 *
 * `undetermined` is the only honest verdict when a question is open, a case
 * failed, or nothing was recorded; `passed` requires every recorded case to have
 * passed with nothing left to settle.
 */
export type Verdict = 'passed' | 'failed' | 'undetermined' | 'empty'

/** One run's report in every exported form. */
export interface ReportBundle {
  runKey: string
  verdict: Verdict
  /** Rendered Markdown, the form a person reads in a review. */
  markdown: string
  /** Rendered HTML, the form a browser opens. */
  html: string
  /** The same facts as JSON, the form a tool reads. */
  json: ReportJson
}

/** The machine-readable report. */
export interface ReportJson {
  schemaVersion: number
  runKey: string
  verdict: Verdict
  runStatus: RunRecord['status'] | undefined
  tally: Tally
  /** Questions the run could not settle, which is why a verdict may be undetermined. */
  openQuestions: string[]
  cases: CaseResultRecord[]
  /** Operations whose outcome was never established, which the report must not hide. */
  unresolvedOperations: { operationKey: string, intent: string, dispatch: string, reason: string }[]
}

/** Report format version, so a consumer can tell the layout apart. */
export const REPORT_SCHEMA_VERSION = 1

/**
 * Build every exported form of one run's report from the same facts.
 * @param input - The run, its results, and its operations.
 * @returns the report in Markdown, HTML and JSON.
 */
export function buildReportBundle(input: ReportInput): ReportBundle {
  const tally = countOutcomes(input.results)
  const questions = input.results.flatMap(result => result.openQuestions)
  const operations = input.operations ?? []
  const json: ReportJson = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    runKey: input.runKey,
    verdict: verdictOf(tally, questions.length),
    runStatus: input.run?.status,
    tally,
    openQuestions: questions,
    cases: input.results,
    unresolvedOperations: operations
      .filter(operation => operation.dispatch.kind !== 'settled')
      .map(operation => ({
        operationKey: operation.operationKey,
        intent: operation.intent,
        dispatch: operation.dispatch.kind,
        reason: operation.dispatch.kind === 'unknown' ? operation.dispatch.reason : '',
      })),
  }
  return {
    runKey: input.runKey,
    verdict: json.verdict,
    markdown: renderMarkdown(input, tally, questions),
    html: renderHtml(json),
    json,
  }
}

/**
 * Render one run's report as Markdown.
 *
 * @param runKey - Run the report covers.
 * @param results - The case results recorded for that run, in key order.
 * @returns the report in Markdown.
 */
export function buildReport(runKey: string, results: CaseResultRecord[]): string {
  return buildReportBundle({ runKey, results }).markdown
}

/**
 * Render one run's report as a standalone HTML page.
 *
 * Every value that reaches the page is escaped, because a case's own words come
 * from a model reading an arbitrary page under test and must not be able to
 * inject markup into the report.
 * @param json - The machine-readable report the page renders.
 * @returns a complete HTML document.
 */
function renderHtml(json: ReportJson): string {
  const rows = json.cases.map(result =>
    `      <article class="case">\n`
    + `        <h2>${escapeHtml(result.caseKey)} — ${escapeHtml(caseLabel(result))}</h2>\n`
    + htmlSection('步骤', result.steps.map(step =>
      `<li><strong>${escapeHtml(step.intent)}</strong> — ${escapeHtml(outcomeLabel(step.outcome))}`
      + `${step.observed === '' ? '' : `<div>实际：${escapeHtml(step.observed)}</div>`}`
      + `${step.evidencePath === '' ? '' : `<div>证据：<code>${escapeHtml(step.evidencePath)}</code></div>`}</li>`))
    + htmlSection('断言', result.assertions.map(assertion =>
      `<li>${escapeHtml(outcomeLabel(assertion.outcome))}｜期望：${escapeHtml(assertion.expected)}`
      + `<div>实际：${escapeHtml(assertion.actual)}</div>`
      + `${assertion.reason === '' ? '' : `<div>原因：${escapeHtml(assertion.reason)}</div>`}</li>`))
    + htmlSection('证据', result.evidencePaths.map(path => `<li><code>${escapeHtml(path)}</code></li>`))
    + htmlSection('待确认', result.openQuestions.map(question => `<li>${escapeHtml(question)}</li>`))
    + `      </article>`).join('\n')
  const unresolved = json.unresolvedOperations.length === 0 ? '' : htmlSection('结果未确认的操作',
    json.unresolvedOperations.map(operation =>
      `<li><code>${escapeHtml(operation.operationKey)}</code> ${escapeHtml(operation.intent)}`
      + ` — ${escapeHtml(operation.dispatch)}${operation.reason === '' ? '' : `：${escapeHtml(operation.reason)}`}</li>`))
  const questions = json.openQuestions.length === 0 ? '' : htmlSection('本次运行未能确认的问题',
    json.openQuestions.map(question => `<li>${escapeHtml(question)}</li>`))
  return `<!doctype html>
<html lang="zh">
  <head>
    <meta charset="utf-8">
    <title>Web 测试报告 ${escapeHtml(json.runKey)}</title>
    <style>
      body { font: 15px/1.6 system-ui, sans-serif; margin: 2rem auto; max-width: 60rem; padding: 0 1rem; }
      .verdict { font-weight: 600; }
      .case { border-top: 1px solid #ddd; margin-top: 2rem; padding-top: 1rem; }
      code { background: #f4f4f4; padding: 0 0.15em; }
    </style>
  </head>
  <body>
    <h1>Web 测试报告</h1>
    <p>运行：<code>${escapeHtml(json.runKey)}</code></p>
    <p>用例：${json.cases.length}（通过 ${json.tally.passed}，失败 ${json.tally.failed}，`
    + `跳过 ${json.tally.skipped}，阻塞 ${json.tally.blocked}，未完成 ${json.tally.incomplete}）</p>
    <p class="verdict">结论：${escapeHtml(conclusion(json.tally, json.openQuestions.length))}</p>
${json.runStatus === undefined ? '' : `    <p>运行状态：<code>${escapeHtml(json.runStatus)}</code></p>\n`}${unresolved}${questions}${rows}
  </body>
</html>
`
}

/**
 * One report section, or an empty string when it would have no items.
 * @param title - Section heading.
 * @param items - Already-escaped list item markup.
 * @returns the section markup.
 */
function htmlSection(title: string, items: string[]): string {
  if (items.length === 0) return ''
  return `    <h2>${escapeHtml(title)}</h2>\n    <ul>\n      ${items.join('\n      ')}\n    </ul>\n`
}

/**
 * Escape a value for HTML text or a quoted attribute.
 * @param value - The value to place in the page.
 * @returns the escaped value.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

/**
 * Count each recorded case by its outcome.
 * @param results - The case results recorded for a run.
 * @returns the counts, with every outcome present.
 */
function countOutcomes(results: CaseResultRecord[]): Tally {
  const tally: Tally = { passed: 0, failed: 0, skipped: 0, blocked: 0, incomplete: 0 }
  for (const result of results) tally[result.outcome] += 1
  return tally
}

/**
 * The machine-readable verdict behind the report's verdict line.
 * @param tally - Outcome counts across the run.
 * @param questionCount - Open questions recorded across the run.
 * @returns the verdict.
 */
function verdictOf(tally: Tally, questionCount: number): Verdict {
  if (questionCount > 0) return 'undetermined'
  if (tally.passed > 0 && tally.failed === 0 && tally.blocked === 0 && tally.incomplete === 0
    && tally.skipped === 0) {
    return 'passed'
  }
  if (tally.failed > 0) return 'failed'
  if (tally.blocked > 0 || tally.incomplete > 0 || tally.skipped > 0) return 'undetermined'
  return 'empty'
}

/**
 * Render one run's report as Markdown.
 * @param input - The run and its facts.
 * @param tally - Outcome counts across the run.
 * @param questions - Questions the run could not settle.
 * @returns the report in Markdown.
 */
function renderMarkdown(input: ReportInput, tally: Tally, questions: string[]): string {
  const results = input.results
  const unresolved = (input.operations ?? []).filter(operation => operation.dispatch.kind !== 'settled')
  const lines: string[] = [
    `# Web 测试报告`,
    ``,
    `- 运行：\`${input.runKey}\``,
    ...(input.run === undefined ? [] : [`- 运行状态：\`${input.run.status}\``, ``]),
    `- 用例：${results.length}（通过 ${tally.passed}，失败 ${tally.failed}，`
      + `跳过 ${tally.skipped}，阻塞 ${tally.blocked}，未完成 ${tally.incomplete}）`,
    `- 结论：${conclusion(tally, questions.length)}`,
    ``,
  ]

  if (unresolved.length > 0) {
    lines.push(`## 结果未确认的操作`, ``)
    for (const operation of unresolved) {
      const reason = operation.dispatch.kind === 'unknown' ? `：${operation.dispatch.reason}` : ''
      lines.push(`- \`${operation.operationKey}\` ${operation.intent} — ${operation.dispatch.kind}${reason}`)
    }
    lines.push(``)
  }

  if (results.length === 0) {
    lines.push('本次运行没有记录任何用例结果，因此不能判定通过。', ``)
    return lines.join('\n')
  }

  for (const result of results) {
    lines.push(`## ${result.caseKey} — ${caseLabel(result)}`, ``)
    if (result.label) lines.push(`项目：${result.label}`, ``)
    if (result.steps.length > 0) {
      lines.push('### 步骤', ``)
      for (const step of result.steps) {
        lines.push(`${step.index}. **${step.intent}** — ${outcomeLabel(step.outcome)}`)
        if (step.observed) lines.push(`   - 实际：${step.observed}`)
        if (step.evidencePath) lines.push(`   - 证据：\`${step.evidencePath}\``)
      }
      lines.push(``)
    }
    if (result.assertions.length > 0) {
      lines.push('### 断言', ``)
      for (const assertion of result.assertions) {
        lines.push(`- ${outcomeLabel(assertion.outcome)}｜期望：${assertion.expected}`)
        lines.push(`  实际：${assertion.actual}`)
        if (assertion.reason) lines.push(`  原因：${assertion.reason}`)
      }
      lines.push(``)
    }
    if (result.evidencePaths.length > 0) {
      lines.push('### 证据', '')
      for (const path of result.evidencePaths) lines.push(`- \`${path}\``)
      lines.push(``)
    }
    if (result.openQuestions.length > 0) {
      lines.push('### 待确认', ``)
      for (const question of result.openQuestions) lines.push(`- ${question}`)
      lines.push(``)
    }
  }

  if (questions.length > 0) {
    lines.push('## 本次运行未能确认的问题', ``)
    for (const question of questions) lines.push(`- ${question}`)
    lines.push(``)
  }
  return lines.join('\n')
}

/**
 * The run-level verdict.
 *
 * A case the model marked passed while also recording that it could not settle
 * something has not earned a clean pass, so any open question leaves the run
 * undetermined even when every recorded outcome is `passed`. The per-case
 * outcome stays visible so the reader sees both facts.
 * @param tally - Outcome counts across the run.
 * @param questionCount - Open questions recorded across the run.
 * @returns the verdict line.
 */
function conclusion(tally: Tally, questionCount: number): string {
  if (questionCount > 0) return `存在 ${questionCount} 项待确认，结论未定`
  if (tally.passed > 0 && tally.failed === 0 && tally.blocked === 0 && tally.incomplete === 0
    && tally.skipped === 0) {
    return '全部已记录用例通过'
  }
  if (tally.failed > 0) return '存在失败用例'
  if (tally.blocked > 0) return '存在被阻塞的用例，结论未定'
  if (tally.incomplete > 0) return '存在未完成的用例，结论未定'
  if (tally.skipped > 0) return '存在跳过的用例，结论未定'
  return '没有可判定的用例'
}

/**
 * One case's heading, which carries its open questions next to its outcome.
 * @param result - The recorded case result.
 * @returns the heading wording.
 */
function caseLabel(result: CaseResultRecord): string {
  const open = result.openQuestions.length
  if (open === 0) return outcomeLabel(result.outcome)
  return `${outcomeLabel(result.outcome)}（${open} 项待确认）`
}

/**
 * Localized outcome wording used in the report.
 * @param outcome - One case, step, or assertion outcome.
 * @returns the report wording.
 */
function outcomeLabel(outcome: CaseResultRecord['outcome']): string {
  if (outcome === 'passed') return '通过'
  if (outcome === 'failed') return '失败'
  if (outcome === 'skipped') return '跳过'
  if (outcome === 'blocked') return '阻塞'
  if (outcome === 'incomplete') return '未完成'
  return outcome
}
