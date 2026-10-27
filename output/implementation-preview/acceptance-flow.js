async page => {
  page.setDefaultTimeout(8000);
  page.setDefaultNavigationTimeout(15000);
  const root='http://127.0.0.1:4320', path=root+'/output/implementation-preview/';
  const errors=[],results=[],checks=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://ddragon.leagueoflegends.com/**',async route=>{
    const url=route.request().url();
    const file=url.includes('/img/item/')?'item-'+url.split('/').pop():url.includes('/img/spell/')?url.split('/').pop():url.includes('/perk-images/')?'lethal-tempo.png':'';
    if(!file)return route.continue();
    const response=await page.request.get(root+'/output/design-arena/assets/'+file);
    return response.ok()?route.fulfill({response}):route.continue();
  });
  const settle=async()=>{
    await page.evaluate(()=>document.fonts.ready);
    await page.waitForFunction(()=>[...document.images].filter(e=>{const r=e.getBoundingClientRect();return e.checkVisibility()&&r.top<innerHeight&&r.bottom>0}).every(e=>e.complete),null,{timeout:4000}).catch(()=>{});
  };
  const measure=async()=>page.evaluate(()=>{
    const main=document.querySelector('.content')||document.querySelector('.login-desk');
    const images=[...document.images].filter(e=>{const r=e.getBoundingClientRect();return e.checkVisibility()&&r.top<innerHeight&&r.bottom>0});
    return {viewport:innerWidth,body:document.body.scrollWidth,content:main?.scrollWidth,available:main?.clientWidth,brokenImages:images.filter(e=>!e.naturalWidth).map(e=>e.src)};
  });
  for(const [width,height] of [[1100,740],[840,640]]){
    await page.setViewportSize({width,height});
    await page.goto(path+'?surface=login');
    await settle();
    await page.screenshot({path:'output/playwright/implementation-login-'+width+'.png'});
    results.push({page:'login',...await measure()});
  }
  await page.getByRole('button',{name:'设置',exact:true}).click();
  if(await page.locator('#ai-api-key').count()!==1||await page.locator('#login-account').isVisible())throw new Error('Login utilities must isolate shared settings');
  await page.getByRole('button',{name:'返回登录'}).click();
  await page.getByRole('button',{name:'优化并启动',exact:true}).click();
  await page.locator('.login-feedback.error').waitFor();
  await page.locator('#login-account').fill('12345678');
  await page.locator('#login-password').fill('sample-password');
  await page.getByRole('button',{name:'显示密码'}).click();
  if(await page.locator('#login-password').getAttribute('type')!=='text')throw new Error('Reveal failed');
  await page.getByRole('button',{name:'隐藏密码'}).click();
  await page.getByRole('button',{name:'优化并启动',exact:true}).click();
  await page.locator('.rail').waitFor();
  const loginCalls=await page.evaluate(()=>window.__riftCalls);
  if(!loginCalls.some(c=>c.name==='launchGameClient'&&c.input.manualLogin===false))throw new Error('Login submit not dispatched');
  checks.push('account validation, password reveal and launch dispatch');
  const pages=[['备战','ready'],['对位','matchup'],['教练','coach'],['战绩','history'],['云顶','tft'],['英雄','champions'],['语音','voice'],['设置','settings']];
  for(const [width,height] of [[430,720],[390,560]]){
    await page.setViewportSize({width,height});
    await page.goto(path+'?surface=dock'+(width===390?'&size=minimum':''));
    for(const [name,id] of pages){
      await page.getByRole('navigation',{name:'助手功能'}).getByRole('button',{name,exact:true}).click();
      if(id==='ready')await page.locator('.build-card').first().waitFor();
      if(id==='coach'){await page.getByRole('button',{name:'开始分析',exact:true}).click();await page.locator('.coach-analysis').waitFor();}
      if(id==='history')await page.locator('.history-match').first().waitFor();
      if(id==='tft')await page.locator('.tft-board').waitFor();
      await settle();
      await page.screenshot({path:'output/playwright/implementation-'+id+'-'+width+'.png'});
      results.push({page:id,...await measure()});
    }
  }
  await page.setViewportSize({width:430,height:720});
  await page.goto(path+'?surface=dock');
  await page.locator('.build-card').first().waitFor();
  await page.locator('.build-card').nth(1).click();
  await page.waitForFunction(()=>window.__riftCalls.some(c=>c.name==='applyConfig'&&c.input.planId.endsWith('-1')));
  await page.getByRole('button',{name:'撤回配置',exact:true}).click();
  await page.waitForFunction(()=>window.__acceptanceState().canRestore===false);
  checks.push('select and apply alternative loadout; restore original');
  await page.getByRole('button',{name:'搜索英雄',exact:true}).click();
  await page.locator('.search-field input').fill('jinx');
  if(await page.locator('.search-grid>button').count()!==1)throw new Error('Hero alias filter failed');
  await page.keyboard.press('Escape');
  await page.locator('.champion-modal').waitFor({state:'detached'});
  await page.getByRole('navigation',{name:'助手功能'}).getByRole('button',{name:'英雄',exact:true}).click();
  await page.getByRole('button',{name:'法师',exact:true}).click();
  await page.locator('.catalog-search input').fill('ahri');
  if(await page.locator('.catalog-grid>button').count()!==1)throw new Error('Catalog filter failed');
  checks.push('hero search, role filter and Escape');
  await page.getByRole('navigation',{name:'助手功能'}).getByRole('button',{name:'语音',exact:true}).click();
  if(!(await page.getByRole('button',{name:'试听夸夸',exact:true}).isDisabled()))throw new Error('Acceptance must remain muted');
  await page.locator('#combat-mode').selectOption('openai');
  await page.locator('.voice-shared-link').click();
  if(await page.locator('input[type=password]').count()!==1)throw new Error('Shared connection duplicated');
  await page.locator('#ai-model').fill('shared-acceptance-model');
  await page.locator('#ai-api-key').fill('sample-acceptance-key');
  await page.locator('.connection-auto input').check();
  await page.locator('.connection-prompts>summary').click();
  await page.locator('#ai-prompt').fill('保留熟练英雄，简短说明代价。');
  await page.getByRole('tab',{name:'战斗语音',exact:true}).click();
  await page.locator('#ai-prompt').fill('开黑搭子，简短一句。');
  await page.getByRole('tab',{name:'AI 教练',exact:true}).click();
  if(await page.locator('#ai-prompt').inputValue()!=='保留熟练英雄，简短说明代价。')throw new Error('Prompts overwrote each other');
  await page.getByRole('button',{name:'保存连接',exact:true}).click();
  await page.locator('.connection-feedback.success').waitFor();
  const shared=await page.evaluate(()=>window.__acceptanceState());
  if(shared.coach.model!==shared.combat.ai.model||shared.coach.combatPrompt!==shared.combat.ai.prompt||shared.coach.coachPrompt!=='保留熟练英雄，简短说明代价。')throw new Error('Shared save failed');
  if(await page.locator('#ai-api-key').inputValue()!=='')throw new Error('Key remains in input');
  await page.getByRole('button',{name:'移除密钥',exact:true}).click();
  await page.waitForFunction(()=>!window.__acceptanceState().coach.hasApiKey&&!window.__acceptanceState().combat.ai.configured);
  checks.push('single shared connection; independent prompts; key removal; muted voice');
  await page.goto(path+'?surface=dock&error=builds');
  await page.getByRole('alert').filter({hasText:'当前网络不可用'}).waitFor();
  await page.getByRole('button',{name:'再找一次'}).click();
  await page.getByRole('alert').filter({hasText:'当前网络不可用'}).waitFor();
  await page.screenshot({path:'output/playwright/implementation-error-430.png'});
  checks.push('load failure and retry');
  await page.goto(path+'?surface=dock');
  await page.evaluate(()=>window.__setAcceptanceState({client:{championId:null,championLocked:false}}));
  await page.locator('.selection-wait').waitFor();
  if(await page.locator('.build-card').count())throw new Error('Old loadouts stayed visible while waiting');
  checks.push('waiting for champion clears stale loadouts');
  await page.goto(path+'?surface=login');
  await page.getByRole('button',{name:'使用官方登录',exact:true}).click();
  await page.locator('.rail').waitFor();
  const manual=await page.evaluate(()=>window.__riftCalls.filter(c=>['saveTclsLogin','launchGameClient'].includes(c.name)));
  if(manual.some(c=>c.name==='saveTclsLogin')||!manual.some(c=>c.input?.manualLogin===true))throw new Error('Official login changed credentials');
  checks.push('official login skips credential save');
  if(results.some(r=>r.body>r.viewport||r.content>r.available||r.brokenImages.length))throw new Error('Layout or visible image failure: '+JSON.stringify(results));
  return {errors,checks,results};
}
