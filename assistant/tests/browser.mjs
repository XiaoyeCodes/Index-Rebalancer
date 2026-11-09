import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright-core');
const root=fileURLToPath(new URL('../../dist/',import.meta.url));
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[], prompts=[];
  page.on('pageerror',e=>errors.push(e.message));
  const site='https://xiaoyecodes.github.io/Index-Rebalancer/';
  const password=process.env.HENG_TEST_PASSWORD;
  assert(password,'Set HENG_TEST_PASSWORD for the running local test service.');
  await page.context().grantPermissions(['local-network-access'],{origin:new URL(site).origin});
  await page.route(site,route=>route.fulfill({path:path.join(root,'index.html'),contentType:'text/html'}));
  await page.route('http://127.0.0.1:5178/api/account/chat',async route=>{
    prompts.push(route.request().postDataJSON().prompt);
    await route.fulfill({json:{text:JSON.stringify({markdown:'## 本月计划\n\n按当前持仓核对这次清单。'})}});
  });
  async function signIn(){
    await page.locator('#password').fill(password);
    await page.getByRole('button',{name:'登录',exact:true}).click();
    await page.locator('#assistantFrame').waitFor();
  }
  await page.goto(site+'#research',{waitUntil:'domcontentloaded'});
  await signIn();
  assert(page.url().endsWith('#assistant'));
  assert.equal(await page.locator('[data-tab=research]').count(),0);
  const f=page.frameLocator('#assistantFrame');
  const starter=f.getByRole('button',{name:'研究我的定投计划与当前持仓',exact:true});
  await starter.waitFor();
  assert.equal(prompts.length,0);
  const snap=await page.evaluate(()=>{
    S.holdingsExample=false;S.weights={SPY:100};S.holdings={};S.monthly=600;S.label='测试';
    const empty=window.assistantPortfolio(true);
    S.holdings={SPY:2,GLD:1};S.contributionMonth=todayStr().slice(0,7);S.lastAppliedOps={context:opsContext()};
    return {empty,holdings:window.assistantPortfolio(false),plan:window.assistantPortfolio(true)};
  });
  assert.equal(snap.empty.持仓类型,'尚未录入持仓');
  assert.equal(snap.holdings.持仓.length,2);
  assert(!('定投计划' in snap.holdings));
  assert(snap.plan.定投计划.本次清单已记账);
  assert.equal(snap.plan.定投计划.本月清单[0].计划买入美元,0);
  await starter.click();
  await f.locator('.research-markdown h2').waitFor();
  assert.equal(prompts.length,1);
  assert(prompts[0].includes('GLD') && prompts[0].includes('本次清单已记账'));
  const pdf=f.getByRole('button',{name:'导出 PDF 报告'});
  const downloading=page.waitForEvent('download');await pdf.click();
  assert((await downloading).suggestedFilename().endsWith('.pdf'));
  await page.reload({waitUntil:'domcontentloaded'});
  await signIn();
  await f.locator('.research-markdown h2').waitFor();
  await f.getByRole('button',{name:'打开研究历史'}).click();
  await f.getByRole('button',{name:'新建研究',exact:true}).first().click();
  const question=f.getByRole('textbox',{name:'深度研究问题'});
  await question.fill('什么是定投？');await question.press('Enter');
  await f.locator('.research-markdown h2').waitFor();
  assert.equal(prompts.length,2);assert(!prompts[1].includes('【Dynamic Rebalancing 持仓快照】'));
  assert.deepEqual(errors,[]);
  console.log('Passed: legacy route, mobile assistant, current/empty/outside/booked holdings, click-only snapshot, Markdown, PDF, history, and independent questions.');
} finally {await browser.close();}
