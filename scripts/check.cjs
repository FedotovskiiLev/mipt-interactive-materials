// Run against scripts/serve.cjs; needs the Playwright package and Chrome.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.BASE_URL || 'http://127.0.0.1:4173/mipt-interactive-materials/';
const root = path.resolve(__dirname,'..');
async function run() {
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  const browser = await chromium.launch({channel:'chrome',headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1050},deviceScaleFactor:1});
  const errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:1050});
    for(const route of ['', 'analytic-geometry/', 'analytic-geometry/week-1/', 'physics/', 'physics/labs/', 'physics/labs/1.1.4/', 'bookshelf/', 'about/']) {
      await page.goto(base+route);
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('h1').count(),1,`${route}: exactly one heading`);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
      assert.equal(overflow,false,`${route}: overflow at ${width}px`);
      const broken=await page.evaluate(()=>[...document.querySelectorAll('a[href^="#"]')].filter(a=>!document.getElementById(a.hash.slice(1))).map(a=>a.hash));
      assert.deepEqual(broken,[],`${route}: broken anchors`);
      if(width===1440) {
        const links=await page.evaluate(()=>[...new Set([...document.querySelectorAll('a[href],link[href],script[src]')].map(el=>el.href||el.src).filter(url=>url.startsWith(location.origin)))]);
        for(const link of links) {
          const response=await page.request.get(link.split('#')[0]);
          assert(response.ok(), `${route}: local resource ${link} returned ${response.status()}`);
        }
      }
      if(['','analytic-geometry/week-1/','physics/labs/1.1.4/','bookshelf/'].includes(route)) await page.screenshot({path:path.join(root,'test-results',`${route.replaceAll('/','-')||'home'}-${width}.png`)});
    }
  }
  await page.goto(base);
  await page.locator('[data-filter="physics"]').click();
  assert.equal(await page.locator('[data-material]:visible').count(),1);
  await page.locator('#material-search').fill('несуществующая тема');
  assert.equal(await page.locator('#catalog-empty').isVisible(),true);
  await page.locator('#reset-search').click();
  assert.equal(await page.locator('[data-material]:visible').count(),2);
  await page.locator('#material-search').fill('Крамер');
  assert.equal(await page.locator('[data-material]:visible').count(),1);
  await page.locator('[data-material]:visible').click();
  assert.match(await page.locator('#detValue').innerText(),/-2/);
  await page.locator('[data-det-size="3"]').click();
  assert.equal(await page.locator('#detValue').innerText(),'det A = 1');
  await page.locator('#solveCramer').click();
  assert.match(await page.locator('#cramerOutput').innerText(),/x₁ = -1.*x₂ = 1/);
  await page.locator('#cramerSystem input').first().fill('3');
  assert.match(await page.locator('#cramerOutput').innerText(),/Пересчитайте/);
  await page.locator('#cramerSystem input').evaluateAll(inputs=>inputs.forEach(input=>input.value='0'));
  await page.locator('#solveCramer').click();
  assert.match(await page.locator('#cramerOutput').innerText(),/Δ = 0/);
  await page.goto(base+'physics/labs/1.1.4/');
  await page.locator('#dataText').fill('1\n2\n3\n4');
  await page.locator('#tau').fill('1');
  await page.locator('#analyzeBtn').click();
  assert.match(await page.locator('#dataStatus').innerText(),/Прочитано 4 исходных значений/);
  const stats = await page.locator('.analysis-stat').allTextContents();
  assert(stats.some(text=>text.includes('σₙ²') && text.includes('1,25')), 'variance uses N as divisor');
  await page.locator('#tau').fill('1.5');
  await page.locator('#analyzeBtn').click();
  assert.match(await page.locator('#dataStatus').innerText(),/кратн/);
  await page.locator('#tau').fill('1');
  await page.locator('#sampleBtn').click();
  await page.waitForFunction(()=>document.querySelector('#dataText').value.length>50);
  assert.doesNotMatch(await page.locator('#dataStatus').innerText(),/Не удалось/);
  await page.goto(base+'lab-1.1.4/');
  await page.waitForURL('**/physics/labs/1.1.4/');
  assert.deepEqual(errors,[], 'browser runtime errors');
  const noJS = await browser.newContext({javaScriptEnabled:false});
  const fallback = await noJS.newPage();
  await fallback.goto(base);
  assert.equal(await fallback.locator('[data-material]:visible').count(),2);
  assert.equal(await fallback.locator('.catalog-tools-home').isVisible(),false);
  await browser.close();
  console.log('PASS: 16 desktop/mobile routes; local links and assets; catalog; determinants; Cramer and stale results; variance and invalid grouping; lab sample; legacy URL; no-JS catalog.');
}
run().catch(error=>{console.error(error);process.exit(1)});
