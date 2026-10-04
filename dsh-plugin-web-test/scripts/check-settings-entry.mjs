/**
 * Open the host's Settings and look for the Web testing section.
 *
 * Verification only: it clicks the shell's Settings control, then reports the
 * settings navigation labels and whether the plugin's section is registered.
 *
 * Usage: node check-settings-entry.mjs <baseUrl>
 */
import { createRequire } from 'node:module'

const require = createRequire('/home/weetion/.dsh/profiles/webtest/node_modules/')
const { chromium } = require('playwright')

const baseUrl = process.argv[2]
if (baseUrl === undefined) {
  throw new Error('usage: node check-settings-entry.mjs <baseUrl>')
}

const browser = await chromium.launch({
  headless: true,
  executablePath: '/home/weetion/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',
})
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const errors = []
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text())
})
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))

await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)

// The first launch shows a preview notice that covers the shell; dismiss it.
const notice = page.locator('button', { hasText: '继续' }).first()
if (await notice.count() > 0) {
  await notice.click({ force: true })
  await page.waitForTimeout(1500)
}

const settings = page.locator('button', { hasText: '设置' }).first()
await settings.click({ force: true })
await page.waitForTimeout(4000)
await page.screenshot({ path: '/tmp/s0-settings.png' })

// Open the plugin's own section so its Remote-backed content renders.
const section = page.locator('button', { hasText: 'Web 测试' }).first()
if (await section.count() > 0) {
  await section.click({ force: true })
  await page.waitForTimeout(3000)
}
await page.screenshot({ path: '/tmp/s0-webtest-section.png' })

const text = await page.locator('body').innerText()
console.log('HAS_ENTRY', /Web 测试/.test(text))
const marker = text.indexOf('Web 测试')
const after = text.slice(marker, marker + 900)
console.log('SECTION_TEXT', JSON.stringify(after.split('\n').filter(line => line.trim() !== '')))
console.log('SETTINGS_TEXT', JSON.stringify(text.split('\n').filter(line => line.trim() !== '').slice(0, 40)))
console.log('ERRORS', JSON.stringify(errors.slice(0, 5)))

await browser.close()
