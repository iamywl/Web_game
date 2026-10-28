# LLM Recipe: Adding a New Hextech Item

Use this template prompt when requesting an LLM to add a new item to the Web MOBA item shop.

## Prompt Template
```markdown
You are adding a new Hextech item to the Web MOBA item shop.

Follow the 4-step pipeline:

1. [server/game/ItemData.js]:
   - Add the item entry to the `ITEMS` map:
     ```javascript
     rabadons_deathcap: {
       id: 'rabadons_deathcap',
       name: '라바돈의 죽음모자 (Rabadon\'s Deathcap)',
       cost: 3600,
       icon: '🧙‍♂️',
       stats: {
         ad: 120, // or ap
         maxMp: 200,
         ampRatio: 0.35 // unique passive
       },
       desc: '공격력/주문력 +120, 최대 마나 +200. 총 공격력을 35% 증폭시킵니다.'
     }
     ```

2. [server/game/GameEngine.js]:
   - In `recalculatePlayerStats(p)`:
     - Check for any unique stat modifiers provided by the item:
     - Example: If item has `ampRatio`, apply it after base and growth stat accumulation.
     - Ensure clamp rules are maintained (e.g., minimum move speed 150, attack speed cap 2.5).

3. [public/js/client.js & public/css/style.css]:
   - Items are automatically fetched via `GET /api/game-data`.
   - Ensure the new item icon and tooltip format cleanly in `#shop-items-list` and the 6 inventory slots (`#hud-item-0` ~ `#hud-item-5`).

4. Verification:
   - Ensure `node server/server.js` is running.
   - Run `node test/qa_suite.js` to ensure 100% pass rate.
   - Verify buy and sell (70% refund) within fountain radius ($\le 350\text{px}$).
```
