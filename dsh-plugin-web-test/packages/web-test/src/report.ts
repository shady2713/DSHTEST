/**
 * Run report generation.
 *
 * A report is derived from recorded results only, so what it states can be
 * traced back to a case the plugin accepted. Anything the run could not settle
 * is carried through as an open question rather than smoothed into a pass.
 *
 * @module dsh-plugin-web-test/report
 */

import type { CaseResultRecord } from './types.ts'

/** One count in a run's outcome tally. */
interface Tally {
  passed: number
  failed: number
  skipped: number
  blocked: number
  incomplete: number
}

/**
 * Render one run's report.
 *
 * @param runKey - Run the report covers.
 * @param results - The case results recorded for that run, in key order.
 * @returns the report in Markdown.
 */
export function buildReport(runKey: string, results: CaseResultRecord[]): string {
  const tally: Tally = { passed: 0, failed: 0, skipped: 0, blocked: 0, incomplete: 0 }
  for (const result of results) tally[result.outcome] += 1
  const questions = results.flatMap(result => result.openQuestions)

  const lines: string[] = [
    `# Web 测试报告`,
    ``,
    `- 运行：\`${runKey}\``,
    `- 用例：${results.length}（通过 ${tally.passed}，失败 ${tally.failed}，`
      + `跳过 ${tally.skipped}，阻塞 ${tally.blocked}，未完成 ${tally.incomplete}）`,
    `- 结论：${conclusion(tally, questions.length)}`,
    ``,
  ]

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
