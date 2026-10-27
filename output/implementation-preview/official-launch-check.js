async page => {
  page.setDefaultTimeout(8000);
  const root = 'http://127.0.0.1:4320/output/implementation-preview/';
  const errors = [], results = [], checks = [];
  page.on('pageerror', error => errors.push(error.message));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const measure = async (name, width) => {
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(() => {
      const content = document.querySelector('.login-utilities main') || document.querySelector('.content') || document.querySelector('.login-desk');
      const images = [...document.images].filter(image => image.checkVisibility());
      return { viewport: innerWidth, body: document.body.scrollWidth, content: content?.scrollWidth, available: content?.clientWidth, brokenImages: images.filter(image => !image.complete || !image.naturalWidth).map(image => image.src) };
    });
    assert(result.body <= width && result.content <= result.available, 'Horizontal overflow: ' + JSON.stringify(result));
    assert(!result.brokenImages.length, 'Broken image');
    results.push({ name, ...result });
  };
  for (const [width, height] of [[1100, 740], [840, 640]]) {
    await page.setViewportSize({ width, height });
    await page.goto(root + '?surface=login&launch=waiting');
    await page.locator('.login-submit').waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert(await page.locator('#login-account, #login-password, .tcls-login-panel').count() === 0, 'Retired account UI');
    assert(await page.locator('.login-desk input:not([type=checkbox])').count() === 0, 'Unexpected account input');
    assert((await page.locator('.login-game-path small').innerText()).endsWith('Launcher\\Client.exe'), 'Actual official path missing');
    await measure('launcher', width);
    await page.screenshot({ path: 'output/playwright/official-launch-login-' + width + '.png' });
    await page.getByRole('button', { name: '优化并启动', exact: true }).click();
    assert(await page.locator('.login-submit').isDisabled(), 'Launch not disabled while busy');
    await page.waitForFunction(() => window.__acceptanceState().launcher.status === 'waiting-login');
    assert(await page.locator('.login-screen').isVisible(), 'Switched to dock before official login');
    assert(await page.evaluate(() => window.__riftCalls.filter(call => call.name === 'launchGameClient').length === 1), 'Duplicate launch');
    assert(await page.evaluate(() => window.rift.saveTclsLogin === undefined && window.__riftCalls.every(call => call.name !== 'saveTclsLogin')), 'Credential API remains');
    await measure('waiting for official login', width);
    await page.screenshot({ path: 'output/playwright/official-launch-waiting-' + width + '.png' });
    await page.getByRole('button', { name: '更改', exact: true }).click();
    await page.getByRole('region', { name: '游戏启动与性能优化' }).waitFor();
    assert(await page.getByText('国服 QQ 登录', { exact: true }).count() === 0, 'Account UI in launch settings');
    await measure('launch settings', width);
    await page.screenshot({ path: 'output/playwright/official-launch-settings-' + width + '.png' });
    await page.getByRole('button', { name: '返回启动', exact: true }).click();
  }
  checks.push('No account UI or credential API; one launch; busy state; no connection claim before LCU; settings and actual path');
  await page.goto(root + '?surface=login&launch=error');
  await page.getByRole('button', { name: '优化并启动', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '已取消 Windows 管理员授权' }).waitFor();
  assert((await page.locator('.login-feedback.error').innerText()).includes('Launcher\\Client.exe'), 'Failure omitted actual path');
  await measure('launch failure', 840);
  await page.screenshot({ path: 'output/playwright/official-launch-error-840.png' });
  checks.push('Concrete failure and actual executable path remain visible');
  for (const [width, height] of [[430, 720], [390, 560]]) {
    await page.setViewportSize({ width, height });
    await page.goto(root + '?surface=dock' + (width === 390 ? '&size=minimum' : ''));
    await page.getByRole('navigation', { name: '助手功能' }).getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('navigation', { name: '设置类别' }).getByRole('button', { name: '游戏', exact: true }).click();
    await page.locator('.settings-row').filter({ hasText: '游戏启动与优化' }).getByRole('button', { name: '打开', exact: true }).click();
    await page.getByRole('region', { name: '游戏启动与性能优化' }).waitFor();
    assert(await page.locator('.tcls-login-panel, #tcls-account, #tcls-password').count() === 0, 'Account fields in dock');
    await measure('dock launch settings', width);
    await page.screenshot({ path: 'output/playwright/official-launch-dock-' + width + '.png' });
  }
  checks.push('430 and 390 dock launch settings have no account form or horizontal overflow');
  assert(!errors.length, 'Page errors: ' + JSON.stringify(errors));
  return { errors, checks, results };
}
