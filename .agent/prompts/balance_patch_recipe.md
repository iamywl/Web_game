# LLM Recipe: Balance Patch & Tuning

Use this template when requesting an LLM to balance champions or minion stats.

## Prompt Template
```markdown
You are tuning combat balance for Web MOBA.

Files to modify:
1. [server/game/ChampionData.js]: Adjust cooldowns, base damages, ratios, mana costs, move speeds, or ranges.
2. [docs/CHAMPIONS.md]: Synchronize the markdown table and stat blocks with the updated values.

Rules:
- Keep armor formula: Effective Damage = Raw Damage * (100 / (100 + Armor)).
- Verify by running `node test/qa_suite.js`. Suite 2 audits all 10 champions and 40 skills.
```
