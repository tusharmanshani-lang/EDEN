'use strict';
// Standalone Node child: never run the browser inside Electron's main process.
const fs = require('node:fs/promises');
const path = require('node:path');

async function audit({ url, modulePath, reportDirectory, flows = [], executablePath }) {
  const base = new URL(url);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1') throw new Error('Browser checks require an EDEN loopback preview.');
  if (!Array.isArray(flows) || flows.length > 20) throw new Error('Use at most 20 browser flows.');
  const { chromium } = require(modulePath);
  await fs.mkdir(reportDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const results = [], screenshots = [];
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block', acceptDownloads: false });
      const errors = [], blocked = new Set();
      await context.route('**/*', route => {
        const target = new URL(route.request().url());
        if (target.origin === base.origin || ['data:', 'blob:'].includes(target.protocol)) return route.continue();
        blocked.add(target.origin);
        return route.abort();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.status() >= 400 && new URL(response.url()).origin === base.origin) errors.push('HTTP ' + response.status() + ': ' + response.url()); });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(() => document.body?.innerText.trim().length > 0);
      await page.evaluate(async () => { await document.fonts?.ready; });
      const body = await page.locator('body').innerText();
      results.push({ name: 'Visible content at ' + viewport.width + 'px', passed: body.trim().length > 0 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
      results.push({ name: 'No horizontal overflow at ' + viewport.width + 'px', passed: !overflow });
      const screenshot = path.join(reportDirectory, 'preview-' + viewport.width + '.png');
      await page.screenshot({ path: screenshot, fullPage: true });
      screenshots.push(screenshot);
      for (const flow of flows) {
        if (typeof flow?.name !== 'string' || !Array.isArray(flow.steps) || flow.steps.length > 100 || !flow.steps.some(step => /^expect/.test(step.action))) throw new Error('A browser flow needs a name, steps, and at least one assertion.');
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded' });
          await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
          await page.reload({ waitUntil: 'domcontentloaded' });
          for (const step of flow.steps) {
            if (step.action === 'reload') { await page.reload({ waitUntil: 'domcontentloaded' }); continue; }
            if (step.action === 'dialog') { page.once('dialog', dialog => step.value === 'dismiss' ? dialog.dismiss() : dialog.accept(String(step.text || ''))); continue; }
            const locator = step.label ? page.getByLabel(String(step.label), { exact: true }) :
              step.role ? page.getByRole(step.role, { name: String(step.name || ''), exact: true }) :
              page.locator(String(step.selector || 'body'));
            if (step.action === 'fill') await locator.fill(String(step.value ?? ''));
            else if (step.action === 'click') await locator.click();
            else if (step.action === 'select') await locator.selectOption(String(step.value));
            else if (step.action === 'check') await locator.check();
            else if (step.action === 'press') await locator.press(String(step.key));
            else if (step.action === 'hover') await locator.hover();
            else if (step.action === 'expectVisible') await locator.waitFor({ state: 'visible' });
            else if (step.action === 'expectHidden') await locator.waitFor({ state: 'hidden' });
            else if (step.action === 'expectText') {
              const text = String(step.text || '');
              if (!text) throw new Error('expectText requires nonempty text.');
              await locator.filter({ hasText: text }).first().waitFor({ state: 'visible' });
            } else throw new Error('Unsupported flow action: ' + step.action);
          }
          results.push({ name: flow.name + ' at ' + viewport.width + 'px', passed: true });
        } catch (error) { results.push({ name: flow.name + ' at ' + viewport.width + 'px', passed: false, error: error.message }); }
      }
      results.push({ name: 'No browser or resource errors at ' + viewport.width + 'px', passed: errors.length === 0, errors });
      if (blocked.size) results.push({ name: 'External browser requests blocked', warning: [...blocked] });
      await context.close();
    }
  } finally { await browser.close(); }
  const report = { passed: results.every(item => item.passed !== false), results, screenshots,
    flowCount: flows.length,
    coverage: flows.length ? 'Configured user flows plus browser smoke checks' : 'Browser smoke checks only; no feature-specific flows supplied' };
  await fs.writeFile(path.join(reportDirectory, 'browser-report.json'), JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) {
  let input = '';
  process.stdin.on('data', data => { input += data; if (input.length > 1024 * 1024) process.exit(2); });
  process.stdin.on('end', () => {
    void audit(JSON.parse(input)).then(result => process.stdout.write(JSON.stringify(result)))
      .catch(error => { process.stderr.write(error.stack || error.message); process.exitCode = 1; });
  });
}
module.exports = { audit };
