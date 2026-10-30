async page => {
  const checks = [], screenshots = [];
  const url = 'http://127.0.0.1:4327/output/implementation-preview/coach-audit.html';
  const assert = (value, message) => { if (!value) throw new Error(message); checks.push(message); };
  const coach = () => page.getByRole('navigation', { name: '助手功能' }).getByRole('button', { name: '教练', exact: true }).click();
  const generate = () => page.getByRole('button', { name: '生成建议', exact: true }).click();
  for (const [width, height] of [[430, 720], [390, 560]]) {
    await page.setViewportSize({ width, height });
    await page.goto(url + '?surface=dock' + (width === 390 ? '&size=minimum' : ''));
    await coach();
    await generate();
    await page.getByRole('tab', { name: '阵容搭配', exact: true }).click();
    await page.locator('.od-coach-poster').scrollIntoViewIfNeeded();
    await page.evaluate(() => document.querySelector('.content').scrollTo({ top: 0 }));
    const path = 'output/playwright/coach-audit-overview-' + width + '.png';
    await page.screenshot({ path });
    screenshots.push(path);
    assert(await page.getByRole('heading', { name: 'AI 教练 /' }).isVisible(), width + ': initial coach view retains the approved page heading and poster');
    await page.evaluate(() => window.__coachAudit.setReplyWithoutDraft('unverified-odds'));
    await generate();
    await page.getByRole('alert').waitFor();
    assert(await page.locator('.coach-analysis').count() === 0, width + ': retry failure on an unchanged draft clears old content');
    assert((await page.getByRole('alert').textContent()).includes('已拦截'), width + ': unchanged-draft retry still applies estimate validation');
  }
  for (const [width, height] of [[1100, 740], [840, 640]]) {
    await page.setViewportSize({ width, height });
    await page.goto('http://127.0.0.1:4327/output/implementation-preview/enhancements.html?surface=login');
    await page.locator('.login-submit').waitFor();
    const path = 'output/playwright/coach-audit-login-' + width + '.png';
    await page.screenshot({ path });
    screenshots.push(path);
    assert(await page.locator('.login-submit').isVisible(), width + ': login retains its official-client launch action');
  }
  return { checks, screenshots };
}
