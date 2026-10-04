/**
 * Web testing Client copy. The Simplified Chinese dictionary is the key source of
 * truth, so a new entry point cannot ship a title the Client has no text for.
 * @module @deepseek-ai/dsh-web-test/locales
 */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  'webTest.entryPoints.projects.title': '项目',
  'webTest.entryPoints.cases.title': '用例',
  'webTest.entryPoints.reports.title': '报告',
  'webTest.entryPoints.browserAutomation.title': '浏览器自动化',
} satisfies Record<string, string>

/** Key union every Web testing title is drawn from. */
export type WebTestLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  'webTest.entryPoints.projects.title': 'Projects',
  'webTest.entryPoints.cases.title': 'Test cases',
  'webTest.entryPoints.reports.title': 'Reports',
  'webTest.entryPoints.browserAutomation.title': 'Browser automation',
} satisfies Record<WebTestLocaleKey, string>
