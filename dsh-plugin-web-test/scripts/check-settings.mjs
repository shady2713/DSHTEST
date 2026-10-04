/**
 * Drive the host's Web UI in a real browser and check the plugin's settings
 * section. Verification only: it loads the host, opens Settings, and reports
 * whether the plugin's localized entry is present.
 *
 * Usage: node check-settings.mjs <baseUrl>
 */
import { createRequire } from 'node:module'

const require = createRequire('/home/weetion/.dsh/profiles/webtest/node_modules/')
const { chromium } = require('playwright')

const baseUrl = process.argv[2]
if (baseUrl === undefined) {
  throw new Error('usage: node check-settings.mjs <baseUrl>')
}

const browser = await chromium.launch({
  headless: true,
  executablePath: '/home/weetion/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',
})
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const consoleErrors = []
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`))

await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
await page.screenshot({ path: '/tmp/s0-01-initial.png' })

// Report what the shell rendered so the next step can target the real control.
const buttons = await page.locator('button, [role="button"], a').allTextContents()
console.log('VISIBLE_CONTROLS', JSON.stringify(buttons.filter(text => text.trim() !== '').slice(0, 40)))

// DSH opens its settings through the shell's settings route; try the URL first.
await page.goto(`${baseUrl.replace(/\/$/, '')}/?settings=plugins`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
await page.screenshot({ path: '/tmp/s0-02-settings-plugins.png' })
const pluginsText = await page.locator('body').innerText()
console.log('HAS_WEB_TEST_ENTRY', /Web 测试|Web testing/.test(pluginsText))
console.log('SETTINGS_SNIPPET', JSON.stringify(pluginsText.split('\n').filter(line => line.trim() !== '').slice(0, 30)))
console.log('CONSOLE_ERRORS', JSON.stringify(consoleErrors.slice(0, 10)))

await browser.close()
