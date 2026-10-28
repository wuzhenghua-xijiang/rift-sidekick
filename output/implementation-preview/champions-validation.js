async page => {
  page.setDefaultTimeout(8000);
  const root = 'http://127.0.0.1:4320/output/implementation-preview/';
  const errors = [], results = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const size of [430, 390]) {
    await page.setViewportSize({ width: size, height: size === 430 ? 720 : 560 });
    for (const [queue, label] of [[420, '经典召唤师峡谷'], [480, '召唤师峡谷'], [450, '极地大乱斗']]) {
      await page.goto(root + '?surface=dock&phase=postgame&hero=Irelia&queue=' + queue + (size === 390 ? '&size=minimum' : ''));
      await page.locator('.champions-cover-top').getByText(label, { exact: true }).waitFor();
      await page.getByRole('heading', { name: '艾瑞莉娅', exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => { const image = document.querySelector('.champions-art'); return image?.complete && image.naturalWidth > 0 });
      const result = await page.evaluate(() => {
        const content = document.querySelector('.content');
        return { mode: document.querySelector('.champions-cover-top > span').textContent, hero: document.querySelector('.champions-cover-title > strong').textContent, width: innerWidth, overflow: content.scrollWidth > content.clientWidth || document.body.scrollWidth > innerWidth, accent: getComputedStyle(document.querySelector('.od-victory')).backgroundColor };
      });
      if (result.overflow || result.hero !== 'IRELIA.' || result.accent !== 'rgb(249, 90, 44)') throw new Error(JSON.stringify(result));
      results.push(result);
      if (queue === 480) await page.screenshot({ path: 'output/playwright/champions-irelia-' + size + '.png' });
    }
  }
  await page.goto(root + '?surface=dock&phase=postgame&queue=420');
  await page.locator('.champions-cover-top').getByText('经典召唤师峡谷', { exact: true }).waitFor();
  await page.evaluate(() => window.__setAcceptanceState({ client: { phase: 'Lobby', sessionId: '', championId: null, queueId: 480, modeLabel: '召唤师峡谷' } }));
  await page.locator('.champions-cover-top').getByText('经典召唤师峡谷', { exact: true }).waitFor();
  const honor = page.getByRole('button', { name: /^一键点赞/ });
  if (await honor.count() && await honor.isEnabled()) throw new Error('Retained lobby report can submit honors');
  await page.evaluate(() => { document.querySelector('.champions-art').src = '/missing-acceptance-image.jpg' });
  await page.waitForFunction(() => document.querySelector('.champions-art')?.hidden === true);
  await page.getByRole('heading', { name: '金克丝', exact: true }).waitFor();
  await page.evaluate(() => window.__setAcceptanceState({ client: { phase: 'ChampSelect', sessionId: 'new-game', championId: 222 } }));
  await page.locator('.champions-edition').waitFor({ state: 'detached' });
  if (errors.length) throw new Error(JSON.stringify(errors));
  return { results, errors, checks: ['official labels across both window sizes', 'real selected champion artwork and name', 'existing orange theme', 'retained report keeps its original mode and disables honors in lobby', 'unavailable artwork hides safely', 'new draft clears the previous match'] };
}
