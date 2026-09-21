import {existsSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';

const edgeCandidates = process.platform === 'win32'
  ? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  : ['/usr/bin/microsoft-edge', '/usr/bin/chromium', '/usr/bin/google-chrome'];
const executablePath = process.env.BROWSER_PATH || edgeCandidates.find(existsSync);
if (!executablePath) throw new Error('לא נמצא דפדפן Chromium לבדיקת הממשק');

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:5173';
const outputDir = resolve('tmp', 'ui-smoke');
mkdirSync(outputDir, {recursive: true});
const browser = await chromium.launch({executablePath, headless: true});

try {
  for (const target of [{name: 'mobile', width: 390, height: 844}, {name: 'desktop', width: 1440, height: 1000}]) {
    const page = await browser.newPage({viewport: {width: target.width, height: target.height}, colorScheme: 'light'});
    await page.goto(baseUrl, {waitUntil: 'networkidle'});
    await page.locator('body').waitFor({state: 'visible'});
    await page.waitForTimeout(500);
    const layout = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      const offenders = [...document.querySelectorAll('body *')].map((element) => {
        const rect = element.getBoundingClientRect();
        return {tag: element.tagName, className: element.className, left: rect.left, right: rect.right, width: rect.width};
      }).filter((item) => item.left < -1 || item.right > viewportWidth + 1).slice(0, 12);
      return {viewportWidth, scrollWidth: document.documentElement.scrollWidth, offenders};
    });
    if (layout.scrollWidth > layout.viewportWidth + 1) {
      throw new Error(`${target.name}: horizontal overflow ${JSON.stringify(layout)}`);
    }
    await page.screenshot({path: resolve(outputDir, `${target.name}.png`), fullPage: true});
    await page.close();
  }
} finally {
  await browser.close();
}

console.log('UI smoke passed: mobile and desktop have no horizontal overflow.');
