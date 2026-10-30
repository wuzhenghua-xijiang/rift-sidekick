async page => {
  const url = 'http://127.0.0.1:4327/output/implementation-preview/coach-audit.html';
  const checks = [], screenshots = [], errors = [];
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  const assert = (value, message) => { if (!value) throw new Error(message); checks.push(message); };
  const coach = () => page.getByRole('navigation', { name: '助手功能' }).getByRole('button', { name: '教练', exact: true }).click();
  const generate = () => page.getByRole('button', { name: '生成建议', exact: true }).click();
  const reset = async name => {
    await page.evaluate(name => window.__coachAudit.setCase(name), name);
    await page.waitForFunction(() => !document.querySelector('.coach-analysis'));
    await coach();
  };
  for (const [width, height] of [[430, 720], [390, 560]]) {
    await page.setViewportSize({ width, height });
    await page.goto(url + '?surface=dock' + (width === 390 ? '&size=minimum' : ''));
    await coach();
    for (const scenario of ['formatted-odds', 'chinese-odds', 'english-odds', 'conflicting-summary', 'conflicting-ban']) {
      await reset(scenario);
      await generate();
      await page.getByRole('alert').waitFor();
      assert((await page.getByRole('alert').textContent()).includes('已拦截'), width + ': rejected ' + scenario);
      assert(await page.locator('.coach-analysis').count() === 0, width + ': no misleading content shown for ' + scenario);
    }
    const path = 'output/playwright/coach-recheck-rejected-' + width + '.png';
    await page.screenshot({ path }); screenshots.push(path);
    await reset('complete');
    await generate();
    await page.locator('.coach-analysis').waitFor();
    assert((await page.locator('.od-coach-call').textContent()).includes('我方55%／敌方45%'), width + ': valid complete-draft estimate still renders');
    assert(await page.locator('.coach-composition-copy').isVisible(), width + ': composition still renders');
    await reset('partial');
    await page.evaluate(() => window.__setAcceptanceState({ client: { phase: 'Lobby', championId: null, championLocked: false, position: null } }));
    await coach();
    await generate();
    await page.locator('.coach-analysis').waitFor();
    await page.evaluate(() => window.__setAcceptanceState({ client: { connected: false, phase: 'ClientOffline' } }));
    await page.waitForFunction(() => !document.querySelector('.coach-analysis'));
    assert(await page.locator('.coach-analysis').count() === 0, width + ': disconnect removes a connected lobby preview');
  }
  assert(errors.length === 0, 'no renderer page errors during second audit');
  return { checks, screenshots, errors, mode: 'Synthetic adversarial replies through production service/parser and React; no online model calls, no LCU writes, muted.' };
}
