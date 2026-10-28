async page => {
  page.setDefaultTimeout(10000);
  const root = 'http://127.0.0.1:4320/output/implementation-preview/';
  const errors = [], results = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.request.get(root + 'recommendations-fizz.json');
  const data = await response.json();
  if (data.plans.length !== 10) throw new Error('Preview must use ten actual provider loadouts');
  for (const width of [430, 390]) {
    const height = width === 430 ? 720 : 560;
    await page.setViewportSize({ width, height });
    await page.goto(root + '?surface=dock&queue=450&hero=Fizz&builds=fizz' + (width === 390 ? '&size=minimum' : ''));
    await page.waitForFunction(() => document.querySelectorAll('.od-plan').length === 10);
    await page.evaluate(() => document.fonts.ready);
    const first = page.locator('.od-plan').first();
    if (!(await first.innerText()).includes('坦克')) throw new Error('The actual highest-rated Fizz loadout is not the tank route');
    if (await first.getAttribute('aria-pressed') !== 'true') throw new Error('The initial recommendation is not selected');
    await page.waitForFunction(() => [...document.images].filter(image => { const rect = image.getBoundingClientRect(); return image.checkVisibility() && rect.top < innerHeight && rect.bottom > 0; }).every(image => image.complete), null, { timeout: 20000 });
    const measure = await page.evaluate(() => {
      const content = document.querySelector('.content'), footer = document.querySelector('.od-dock-footer:not([hidden])').getBoundingClientRect();
      const visible = [...document.images].filter(image => { const rect = image.getBoundingClientRect(); return image.checkVisibility() && rect.top < innerHeight && rect.bottom > 0; });
      return { width: innerWidth, height: innerHeight, count: document.querySelectorAll('.od-plan').length,
        overflow: document.body.scrollWidth > innerWidth || content.scrollWidth > content.clientWidth,
        footerHeight: footer.height, footerBottom: footer.bottom, brokenImages: visible.filter(image => !image.naturalWidth).map(image => image.src),
        topEquipment: [...document.querySelector('.od-plan').querySelectorAll('.od-equipment img')].map(image => image.alt) };
    });
    if (measure.overflow || measure.footerHeight !== 54 || measure.footerBottom !== height || measure.brokenImages.length) throw new Error(JSON.stringify(measure));
    await page.screenshot({ path: 'output/playwright/recommendations-fizz-' + width + '.png' });
    const last = page.locator('.od-plan').last();
    await last.scrollIntoViewIfNeeded();
    await last.click();
    await page.waitForFunction(() => document.querySelectorAll('.od-plan')[9].classList.contains('applied'));
    const calls = await page.evaluate(() => window.__riftCalls.filter(call => call.name === 'applyConfig'));
    if (calls.length !== 1 || calls[0].input.planId !== data.plans[9].id) throw new Error(JSON.stringify(calls));
    if (await last.getAttribute('aria-pressed') !== 'true') throw new Error('The tenth loadout is not selected');
    await page.screenshot({ path: 'output/playwright/recommendations-fizz-last-' + width + '.png' });
    results.push({ ...measure, tenthPlanApplied: calls[0].input.planId });
  }
  await page.goto(root + '?surface=dock&queue=450&hero=Fizz&builds=fizz&size=minimum');
  await page.waitForFunction(() => document.querySelectorAll('.od-plan').length === 10);
  if (errors.length) throw new Error(JSON.stringify(errors));
  return { results, errors, source: data.source, patch: data.patch, checks: ['ten real deduplicated combinations', 'actual tank core with Grasp, defensive boots and follow-up items', 'both established window sizes', 'fixed 54px footer', 'tenth card scrolls, selects and applies exactly once', 'muted preview bridge only, no real LCU writes'] };
}
