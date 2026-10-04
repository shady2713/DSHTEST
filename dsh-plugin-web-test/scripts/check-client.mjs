/**
 * Load the host's Web UI in a real browser and report every console message.
 * Verification only: it surfaces why a client entry fails to activate.
 *
 * Usage: node check-client.mjs <baseUrl>
 */
import { createRequire } from 'node:module'

const require = createRequire('/home/weetion/.dsh/profiles/webtest/node_modules/')
const { chromium } = require('playwright')

const baseUrl = process.argv[2]
if (baseUrl === undefined) {
  throw new Error('usage: node check-client.mjs <baseUrl>')
}

const browser = await chromium.launch({
  headless: true,
  executablePath: '/home/weetion/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',
})
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const messages = []
page.on('console', message => messages.push(`${message.type()}: ${message.text()}`))
page.on('pageerror', error => messages.push(`pageerror: ${error.stack ?? error.message}`))

await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)
await page.screenshot({ path: '/tmp/s0-client.png' })

console.log('BODY', JSON.stringify((await page.locator('body').innerText()).split('\n').filter(line => line.trim() !== '').slice(0, 20)))
for (const message of messages.slice(0, 25)) {
  console.log('MSG', message.slice(0, 700))
}

await browser.close()
