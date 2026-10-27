async page => {
  page.setDefaultTimeout(8000);
  const root='http://127.0.0.1:4320/output/implementation-preview/';
  const results=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  for(const size of [430,390]){
    await page.setViewportSize({width:size,height:size===430?720:560});
    for(const state of ['win','loss','missing','error']){
      const query='?surface=dock&phase=postgame'+(size===390?'&size=minimum':'')+(state==='loss'?'&result=loss':state==='missing'?'&metrics=missing':state==='error'?'&error=postgame':'');
      await page.goto(root+query);
      await page.locator('.od-postgame').waitFor();
      if(state==='error')await page.locator('.postgame-wait').filter({hasText:'结算数据暂不可用'}).waitFor();
      else await page.locator('.od-victory').waitFor();
      await page.evaluate(()=>document.fonts.ready);
      await page.waitForFunction(()=>[...document.images].filter(e=>{const r=e.getBoundingClientRect();return e.checkVisibility()&&r.top<innerHeight&&r.bottom>0}).every(e=>e.complete),null,{timeout:4000}).catch(()=>{});
      const result=await page.evaluate(({size,state})=>{
        const main=document.querySelector('.content');
        return {size,state,body:document.body.scrollWidth,available:innerWidth,content:main.scrollWidth,contentWidth:main.clientWidth,footer:document.querySelector('.od-dock-footer:not([hidden])').getBoundingClientRect().height,metrics:[...document.querySelectorAll('.od-postgame-stats b')].map(e=>e.textContent),brokenImages:[...document.images].filter(e=>{const r=e.getBoundingClientRect();return e.checkVisibility()&&r.top<innerHeight&&r.bottom>0&&e.complete&&!e.naturalWidth}).map(e=>e.src)};
      },{size,state});
      if(state==='missing'&&result.metrics.some(text=>text!=='—'))throw new Error('Missing metrics fabricated');
      results.push(result);
      await page.screenshot({path:'output/playwright/parity-postgame-'+state+'-'+size+'.png'});
      if(state==='win'&&size===430){
        await page.getByText('查看完整复盘',{exact:true}).click();
        await page.locator('.postgame-extra-stats').waitFor();
        await page.getByText('查看完整复盘',{exact:true}).click();
        await page.getByRole('button',{name:'一键点赞 · 1 位玩家',exact:true}).click();
        await page.waitForFunction(()=>window.__riftCalls.some(call=>call.name==='honorPlayers'));
        await page.getByRole('button',{name:'已处理本次点赞',exact:true}).waitFor();
        if(!await page.getByRole('button',{name:'已处理本次点赞',exact:true}).isDisabled())throw new Error('Honor can repeat');
        await page.locator('.od-dock-footer').getByRole('button',{name:'历史战绩',exact:true}).click();
        await page.locator('.od-match').first().waitFor();
      }
    }
  }
  if(results.some(r=>r.body>r.available||r.content>r.contentWidth||r.footer!==54||r.brokenImages.length)||errors.length)throw new Error(JSON.stringify({errors,results}));
  await page.goto(root+'?surface=dock');
  await page.setViewportSize({width:430,height:720});
  await page.getByRole('navigation',{name:'助手功能'}).getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('navigation',{name:'设置类别'}).getByRole('button',{name:'游戏',exact:true}).click();
  await page.getByRole('navigation',{name:'助手功能'}).getByRole('button',{name:'语音',exact:true}).click();
  await page.getByRole('button',{name:'智能模式',exact:true}).click();
  await page.locator('.voice-shared-link').click();
  await page.locator('#ai-base-url').waitFor();
  await page.goto(root+'?surface=dock');
  return {results,errors,checks:['victory and defeat; missing metrics and loading failure','expanded real debrief; one honor dispatch; recent history','voice link always opens the shared OpenAI tab']};
}
