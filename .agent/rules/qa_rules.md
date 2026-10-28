# QA & Testing Rules for AI Agents

## 1. Mandatory QA Verification
Before declaring any task complete or submitting code changes, run the automated integration test suite:
```bash
# 1. Ensure server is active in background or separate shell
node server/server.js

# 2. Run the 19-test headless verification suite
node test/qa_suite.js
```

## 2. Pre-flight Server Requirement
`test/qa_suite.js` executes headless socket connections and HTTP API queries against `http://localhost:3000`. If the server is offline, the test runner will abort immediately with an actionable warning. Always ensure the server daemon is running before starting the tests.

## 3. The 4 Test Suites (19 Test Cases)
1. **Suite 1: Concurrency & Pick Exclusivity Race Condition (6 tests)**
   - 1.1 4 headless socket clients connect simultaneously.
   - 1.2 Concurrent registration with valid nicknames.
   - 1.3 4-Player 2v2 Room creation and automatic team-balance (2 Blue vs 2 Red).
   - 1.4 Host transitions room to DRAFT state.
   - 1.5 Pick Exclusivity Race Condition (`Promise.all` lock on same champion): Exactly 1 success, 3 rejections.
   - 1.6 Remaining distinct champion locks and 3s countdown trigger.

2. **Suite 2: 10 Champions Integrity & Server Info (4 tests)**
   - 2.1 GET `/api/server-info` health check and LAN IP detection.
   - 2.2 GET `/api/game-data` schema check (Champions, Spells, Items).
   - 2.3 Full audit of 10 champions, 40 skills (Q, W, E, R), 10 passives.
   - 2.4 Summoner spells configuration (flash, ignite, heal).

3. **Suite 3: In-Game Battle Simulation & Combat Mechanics (5 tests)**
   - 3.1 1v1 Arena terrain setup ($2400 \times 1600$).
   - 3.2 Authoritative movement (`playerMove`) displacement.
   - 3.3 Projectile skillshot spawning and flight telemetry in `gameTick`.
   - 3.4 Cast Q, W, E, R, D, F and tick-by-tick cooldown decrements.
   - 3.5 Collision detection & damage application (victim HP reduction).

4. **Suite 4: Disconnect & Edge Case Handling (4 tests)**
   - 4.1 Disconnect during DRAFT phase (graceful fallback to LOBBY).
   - 4.2 Disconnect during ACTIVE IN-GAME battle (forfeit & win state).
   - 4.3 7 input validation edge cases (duplicate names, invalid roles, double locks).
   - 4.4 Post-stress server health & HTTP API liveness check.

## 4. Passing Criterion
- **19/19 tests passed (100.0% pass rate)**.
- Any failure or regression must be diagnosed and resolved immediately before completing a task.
- Results are automatically archived to `test/qa_report.json`.
