async page => {
  page.setDefaultTimeout(8000);
  const root='http://127.0.0.1:4320', path=root+'/output/implementation-preview/';
  const errors=[],results=[];
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
  const measure=async(name,size)=>{await settle();results.push(await page.evaluate(({name,size})=>{
    const main=document.querySelector('.content')||document.querySelector('.login-desk');
    const images=[...document.images].filter(e=>{const r=e.getBoundingClientRect();return e.checkVisibility()&&r.top<innerHeight&&r.bottom>0});
    const rect=selector=>{const e=document.querySelector(selector);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
    return {name,size,body:document.body.scrollWidth,viewport:innerWidth,content:main?.scrollWidth,available:main?.clientWidth,brokenImages:images.filter(e=>!e.naturalWidth).map(e=>e.src),footer:rect('.od-dock-footer:not([hidden])'),hero:rect('.od-hero'),plans:[...document.querySelectorAll('.od-plan')].map(e=>e.getBoundingClientRect().height)};
  },{name,size}));};
  for(const size of [430,390]){
    await page.setViewportSize({width:size,height:size===430?720:560});
    await page.goto(path+'?surface=dock'+(size===390?'&size=minimum':''));
    await page.locator('.od-plan').first().waitFor();
    for(const [name,label] of [['ready','备战'],['matchup','对位'],['coach','教练'],['history','战绩'],['tft','云顶'],['champions','图鉴'],['voice','语音'],['settings','设置']]){
      await page.getByRole('navigation',{name:'助手功能'}).getByRole('button',{name:label,exact:true}).click();
      if(name==='coach'){
        await page.getByRole('button',{name:'生成建议',exact:true}).click();
        await page.locator('.od-coach-picks').waitFor();
      }
      if(name==='history')await page.locator('.od-match').first().waitFor();
      if(name==='tft')await page.locator('.od-deployment').waitFor();
      await measure(name,size);
      await page.screenshot({path:'output/playwright/parity-'+name+'-'+size+'.png'});
    }
  }
  for(const [width,height] of [[1100,740],[840,640]]){
    await page.setViewportSize({width,height});
    await page.goto(path+'?surface=login');
    await page.locator('#login-account').waitFor();
    await measure('login',width);
    await page.screenshot({path:'output/playwright/parity-login-'+width+'.png'});
  }
  await page.setViewportSize({width:430,height:720});
  await page.goto(path+'?surface=dock&phase=lobby');
  await page.locator('.od-lobby').waitFor();
  await measure('lobby',430);
  await page.screenshot({path:'output/playwright/parity-lobby-430.png'});
  return {errors,results};
}
