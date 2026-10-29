const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
(async()=>{const out=path.join(__dirname,'unit-results');fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});try{
const page=await browser.newPage({viewport:{width:1500,height:950}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
await page.goto('http://127.0.0.1:4175/test/unit_models.html');await page.waitForFunction(()=>document.body.dataset.status,{timeout:30000});const report=JSON.parse(await page.locator('#result').textContent());report.browserErrors=errors;
fs.writeFileSync(path.join(out,'visual.json'),JSON.stringify(report,null,2));await page.screenshot({path:path.join(out,'original-units.png')});console.log(JSON.stringify({status:report.status,passed:report.passed,total:report.total,failed:report.checks.filter(c=>!c.pass),errors:report.errors,browserErrors:errors},null,2));
await page.locator('#destroy').click();await page.waitForTimeout(600);await page.screenshot({path:path.join(out,'unit-destruction.png')});assert.equal(report.status,'PASS');assert.deepEqual(errors,[]);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
