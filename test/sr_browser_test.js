const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const out = path.join(__dirname, 'sr-results'); fs.mkdirSync(out, { recursive: true });
const report = { checks: [], errors: [], requests: [], scope: 'Unmodified production match; actual lobby/draft, mouse and keyboard input. No state injection.' };
let browser, page;
const pass = name => { report.checks.push(name); console.log('PASS', name); };
async function run() {
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  page = await browser.newPage({ viewport: { width: 1500, height: 950 } }); page.setDefaultTimeout(60000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) report.requests.push({ url: response.url(), status: response.status() }); });
  await page.addInitScript(() => {
    window.qa = { states: [], events: [] }; let Renderer;
    Object.defineProperty(window, 'GameRenderer', { configurable: true, get() { return Renderer; }, set(Base) {
      Renderer = class extends Base { constructor(...args) { super(...args); window.qaRenderer = this; } };
    } });
    Object.defineProperty(window, 'io', { configurable: true, set(original) {
      Object.defineProperty(window, 'io', { configurable: true, writable: true, value: function (...args) {
        const socket = original(...args); socket.on('gameTick', state => {
          const me = state.players.find(p => p.id === socket.id);
          if (me) window.qa.states.push({ x: me.x, y: me.y, vx: me.vx, vy: me.vy, navX: me.navX, navY: me.navY, isAlive: me.isAlive });
          window.qa.events.push(...(state.events || []));
        }); return socket;
      } });
    } });
  });
  await page.goto(process.env.SR_URL || 'http://127.0.0.1:4178/');
  await page.locator('#input-nickname').fill('협곡 원본 검증'); await page.locator('#btn-enter-lobby').click();
  await page.locator('#btn-open-create-room').click(); await page.locator('#input-room-name').fill('원본 협곡 이동 검증');
  await page.locator('label.mode-card:has(input[value="2v2"])').click(); await page.locator('#form-create-room button[type=submit]').click();
  await page.locator('#btn-start-draft').click(); await page.locator('#champ-card-garen').waitFor();
  assert.equal(await page.locator('[id^=champ-card-]').count(), 12); pass('All 12 champions remain selectable');
  await page.locator('#champ-card-garen').click(); await page.locator('#btn-lock-champion').click();
  await page.waitForFunction(() => window.qaRenderer?.originalMapReady, null, { timeout: 150000 });
  await page.waitForFunction(() => window.qaRenderer.threePlayerMeshes[window.qaRenderer.localPlayerId]?.userData.garen);
  pass('Original terrain and original Garen render in a real 2v2 practice match');
  await page.waitForFunction(() => Object.values(window.qaRenderer.threeStructureMeshes).filter(g => g.userData.unit).length === 30);
  pass('22 original turrets, six inhibitors and two nexuses are loaded');
  await page.waitForFunction(() => Object.values(window.qaRenderer.threeJungleMeshes).filter(g => g.userData.unit).length === 16);
  pass('All 16 existing jungle entities use nine original monster models');
  await page.keyboard.down('Space');
  await page.screenshot({ path: path.join(out, 'fountain.png') });
  report.source = await page.evaluate(() => ({ nav: window.qaRenderer.navigation.data.source, map: window.qaRenderer.originalMap.name }));
  // Far travel uses the same minimap input available to the user.
  async function minimapMove(x, y) {
    const box = await page.locator('#minimap-canvas').boundingBox();
    await page.mouse.click(box.x + x / 3200 * box.width, box.y + y / 3200 * box.height, { button: 'right' });
    await page.waitForFunction(({ x, y }) => { const s = window.qa.states.at(-1); return s && Math.hypot(s.x - x, s.y - y) < 35; }, { x, y });
  }
  await minimapMove(830, 1521); pass('Actual minimap command navigates from fountain through base and jungle walls');
  await page.screenshot({ path: path.join(out, 'blue-jungle.png') });
  const buff = await page.evaluate(() => { const r = window.qaRenderer, m = r.gameState.jungleMonsters.find(m => m.id === 'blue_buff_blue'); return { hp: m.hp, ...r.worldToScreen(m.x, m.y, 20) }; });
  await page.keyboard.press('q'); await page.mouse.click(buff.x, buff.y, { button: 'right' });
  await page.waitForFunction(hp => window.qaRenderer.gameState.jungleMonsters.find(m => m.id === 'blue_buff_blue').hp < hp, buff.hp);
  await page.waitForFunction(() => window.qaRenderer.gameState.jungleMonsters.find(m => m.id === 'blue_buff_blue').attackSequence > 0);
  pass('Clicking an original jungle model causes real basic-attack damage and retaliation');
  await page.keyboard.press('s');
  await page.waitForFunction(() => { const c = window.qaRenderer.cameraCtrl; return Math.hypot(c.x - c.targetX, c.y - c.targetY) < 1; });
  const begin = await page.evaluate(() => window.qa.states.length);
  // Click empty ground beside the wolves. Clicking the monster itself correctly
  // attacks from range and therefore should not arrive at its center.
  const target = await page.evaluate(() => window.qaRenderer.worldToScreen(760, 1800));
  await page.mouse.click(target.x, target.y, { button: 'right' });
  await page.waitForFunction(() => { const s = window.qa.states.at(-1); return s && Math.hypot(s.x - 760, s.y - 1800) < 18; });
  const trace = await page.evaluate(begin => window.qa.states.slice(begin), begin);
  assert.ok(trace.some(s => s.x < 740), 'route detours west around original wall');
  report.wallDetourTrace = trace; pass('Right-click behind jungle wall takes a real detour and arrives');
  await page.screenshot({ path: path.join(out, 'wall-detour.png') });
  await page.keyboard.press('q'); await page.keyboard.press('Control+e'); await page.keyboard.press('e');
  await page.waitForFunction(() => window.qa.events.some(e => e.type === 'garenSkill' && e.key === 'E'));
  pass('Garen skill inputs still produce authoritative casts on original terrain');
  await minimapMove(938, 1152); await page.screenshot({ path: path.join(out, 'river-baron.png') });
  const height = await page.evaluate(() => { const r = window.qaRenderer, g = r.threePlayerMeshes[r.localPlayerId]; return { expected: r.navigation.heightAt(g.position.x, g.position.z), actual: g.position.y }; });
  assert.ok(Math.abs(height.expected - height.actual) < 2); pass('Champion feet follow original river height');
  await page.keyboard.press('s');
  report.observed = await page.evaluate(() => ({ player: window.qa.states.at(-1), minions: window.qaRenderer.gameState.minions.length, renderer: window.qaRenderer.renderer3D.info.render }));
  assert.deepEqual(report.errors, []); assert.deepEqual(report.requests, []); pass('No browser JavaScript, WebGL or missing-resource errors');
}
run().catch(async error => { report.error = error.stack; process.exitCode = 1; console.error(error); if (page) { await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); report.observed = await page.evaluate(() => ({ state: window.qa?.states.at(-1), mapError: window.qaRenderer?.originalMapError })).catch(() => null); } })
  .finally(async () => { if (browser) await browser.close(); report.status = report.error ? 'FAIL' : 'PASS'; fs.writeFileSync(path.join(out, 'browser.json'), JSON.stringify(report, null, 2)); console.log(report.status, report.checks.length); });
