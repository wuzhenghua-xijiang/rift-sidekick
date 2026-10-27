async page => {
  page.setDefaultTimeout(8000);
  const root='http://127.0.0.1:4320/output/implementation-preview/';
  const errors=[];
  page.on('pageerror', e=>errors.push(e.message));
  await page.setViewportSize({width:430,height:720});
  await page.goto(root+'?surface=dock&phase=postgame');
  await page.locator('.od-victory').waitFor();
  await page.locator('.od-dock-footer').getByRole('button',{name:'历史战绩',exact:true}).click();
  await page.locator('.od-match').first().waitFor();
  await page.getByRole('navigation',{name:'助手功能'}).getByRole('button',{name:'战绩',exact:true}).click();
  await page.locator('.od-victory').waitFor();
  await page.goto(root+'?surface=dock');
  await page.getByRole('button',{name:'大乱斗',exact:true}).click();
  await page.getByRole('navigation',{name:'助手功能'}).getByRole('button',{name:'对位',exact:true}).click();
  await page.locator('.od-dock-footer').getByRole('button',{name:'回到本局',exact:true}).waitFor();
  await page.setViewportSize({width:1280,height:900});
  await page.goto(root+'parity.html');
  const buttons=page.getByRole('navigation',{name:'对照页面'}).getByRole('button');
  const pages=[];
  for(let i=0;i<await buttons.count();i++){
    pages.push(await buttons.nth(i).innerText());
    await buttons.nth(i).click();
    await page.waitForFunction(()=>[...document.images].every(e=>e.complete&&e.naturalWidth>0),null,{timeout:4000});
  }
  if(errors.length)throw new Error(JSON.stringify(errors));
  return {errors,pages,checks:['history navigation restores current debrief','non-ranked matchup offers return action','all comparison images load']};
}
