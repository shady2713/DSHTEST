/**
 * Entry declarations for the Web testing application; these do not register Client controls.
 */

import { WebTestEntryPointId, type WebTestEntryPoint } from './types.ts'

const entryPoint = (id: string, titleKey: WebTestEntryPoint['titleKey']): WebTestEntryPoint => ({
  id: id as WebTestEntryPointId,
  titleKey,
  profileName: '',
})

/**
 * Create declarations for the application's entry points.
 * @returns fresh entries without a selected profile or backing capability.
 */
export function webTestEntryPoints(): WebTestEntryPoint[] {
  return [
    entryPoint('web-test.projects', 'webTest.entryPoints.projects.title'),
    entryPoint('web-test.cases', 'webTest.entryPoints.cases.title'),
    entryPoint('web-test.reports', 'webTest.entryPoints.reports.title'),
    entryPoint('web-test.browser-automation', 'webTest.entryPoints.browserAutomation.title'),
  ]
}
