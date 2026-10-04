/**
 * Report how the shell's Settings control is marked up.
 *
 * Verification only: it locates the element whose text is 设置 and prints the
 * ancestor chain, so the next check can click the real control.
 *
 * Usage: node probe-settings-control.mjs <baseUrl>
 */
import { createRequire } from 'node:module'

const require = createRequire('/home/weetion/.dsh/profiles/webtest/node_modules/')
const { chromium } = require('playwright')

const baseUrl = process.argv[2]
if (baseUrl === undefined) {
  throw new Error('usage: node probe-settings-control.mjs <baseUrl>')
}

const browser = await chromium.launch({
  headless: true,
  executablePath: '/home/weetion/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',
})
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)

const probe = await page.evaluate(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const hits = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.textContent?.trim() !== '设置') continue
    const chain = []
    let element = node.parentElement
    for (let depth = 0; element !== null && depth < 5; depth += 1) {
      chain.push(`${element.tagName}.${element.className || '(no class)'}[role=${element.getAttribute('role') ?? '-'}]`)
      element = element.parentElement
    }
    hits.push(chain)
  }
  return hits
})
console.log('SETTINGS_MARKUP', JSON.stringify(probe, null, 1))

await browser.close()
