async page => {
  const checks = [], screenshots = [], errors = [];
  const assert = (value, message) => { if (!value) throw new Error(message); checks.push(message); };
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  const coach = () => page.getByRole('navigation', { name: '助手功能' }).getByRole('button', { name: '教练', exact: true }).click();
  const generate = async () => {
    await page.getByRole('button', { name: '生成建议', exact: true }).click();
    await page.locator('.coach-analysis').waitFor();
  };
  const setCase = async name => {
    await page.evaluate(name => window.__coachAudit.setCase(name), name);
    await page.waitForFunction(() => !document.querySelector('.coach-analysis'));
    await coach(); await generate();
  };
  const capture = async name => {
    await page.evaluate(() => document.fonts.ready);
    const dimensions = await page.evaluate(() => {
      const content = document.querySelector('.content');
      return { viewport: innerWidth, body: document.body.scrollWidth, content: content?.scrollWidth, available: content?.clientWidth };
    });
    assert(dimensions.body <= dimensions.viewport && dimensions.content <= dimensions.available, name + ': no horizontal overflow');
    const path = 'output/playwright/coach-concise-' + name + '.png';
    await page.screenshot({ path }); screenshots.push(path);
  };
  for (const [width, height] of [[430, 720], [390, 560]]) {
    await page.setViewportSize({ width, height });
    await page.goto('http://127.0.0.1:4327/output/implementation-preview/coach-audit.html?surface=dock' + (width === 390 ? '&size=minimum' : ''));
    await coach(); await generate();
    assert(await page.locator('.od-coach-call .coach-copy-toggle').count() === 0, width + ': short conclusion has no extra control');
    assert((await page.locator('.od-coach-call').textContent()).includes('保留金克丝'), width + ': primary decision is retained');
    assert(await page.locator('.od-coach-picks button').count() === 2, width + ': primary and alternate picks remain usable');
    const warnings = page.locator('.coach-visible-warnings');
    assert(!await warnings.evaluate(el => el.open), width + ': warning paragraphs are collapsed by default');
    assert((await warnings.locator('summary').textContent()).includes('已剔除冲突候选'), width + ': filtering remains visible as a short notice');
    await page.locator('.coach-panel').evaluate(el => el.closest('.content').scrollTop = 0);
    await capture('overview-' + width);

    await setCase('long-copy');
    const call = page.locator('.od-coach-call p > span');
    assert(Array.from(await call.textContent()).length === 33 && (await call.textContent()).endsWith('…'), width + ': long conclusion uses a marked 32-character preview');
    const expand = page.getByRole('button', { name: '展开完整教练结论', exact: true });
    await expand.focus(); await expand.press('Enter');
    assert((await call.textContent()).endsWith('失去后排支撑。'), width + ': full conclusion and its condition remain keyboard-accessible');
    assert(await page.getByRole('button', { name: '收起完整教练结论', exact: true }).getAttribute('aria-expanded') === 'true', width + ': expanded state is exposed');
    await page.getByRole('button', { name: '收起完整教练结论', exact: true }).click();
    assert((await call.textContent()).endsWith('…'), width + ': conclusion collapses again');
    await page.getByRole('tab', { name: '阵容搭配', exact: true }).click();
    const composition = page.locator('.coach-composition-copy > span');
    assert(Array.from(await composition.textContent()).length === 57, width + ': composition preview is bounded');
    await page.getByRole('button', { name: '展开完整阵容分析', exact: true }).click();
    assert((await composition.textContent()).endsWith('承担持续压力的英雄。'), width + ': full composition remains available');
    await page.getByRole('button', { name: '收起完整阵容分析', exact: true }).click();
    const summaryText = await warnings.locator('summary').textContent();
    assert(summaryText.includes('部分资料缺失或未采用') && summaryText.length < 60, width + ': overlapping evidence warnings form one compact notice');
    assert(!await warnings.locator('li').first().isVisible(), width + ': full warning text is initially hidden');
    await warnings.locator('summary').focus(); await warnings.locator('summary').press('Enter');
    assert(await warnings.locator('li').first().isVisible() && (await warnings.locator('ul').textContent()).includes('公告与本局版本不符'), width + ': every original warning can be opened with the keyboard');
    await warnings.locator('summary').click();
    await page.locator('.od-coach-call').scrollIntoViewIfNeeded();
    await capture('long-' + width);

    await setCase('partial');
    assert(await page.getByRole('button', { name: '收起完整教练结论', exact: true }).count() === 0, width + ': expanded state does not leak into a new analysis');
    await setCase('mayhem');
    assert((await warnings.locator('summary').textContent()).includes('缺少已选强化'), width + ': critical Mayhem limitation remains visible');
    assert(await page.getByRole('tab', { name: 'Ban 推荐', exact: true }).count() === 0, width + ': Mayhem drafting restrictions remain intact');
    await setCase('complete');
    assert((await page.locator('.od-coach-call').textContent()).includes('仅按阵容估计：我方55%／敌方45%'), width + ': estimate label and both sides remain visible');
    assert(await page.locator('.od-coach-call .coach-copy-toggle').count() === 0, width + ': ordinary final estimate does not need expansion');
    assert(await page.locator('#coach-tab-panel .od-coach-picks').count() === 0, width + ': completed roster has no replacement suggestions');
  }
  assert(errors.length === 0, 'no renderer page errors');
  return { mode: 'Production React/service/parser with synthetic replies, muted, no online model calls or LCU writes.', checks, screenshots, errors };
}
