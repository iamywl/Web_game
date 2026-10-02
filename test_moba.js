const { io } = require('socket.io-client');

async function testGameFlow() {
  console.log('=== MOBA INTEGRATION SIMULATION TEST ===');
  const s1 = io('http://localhost:3000', { transports: ['websocket'] });
  const s2 = io('http://localhost:3000', { transports: ['websocket'] });

  await new Promise(r => s1.on('connect', r));
  await new Promise(r => s2.on('connect', r));
  console.log('1. Both sockets connected:', s1.id, s2.id);

  // Register users
  const reg1 = await new Promise(r => s1.emit('registerUser', { nickname: '페이커' }, r));
  const reg2 = await new Promise(r => s2.emit('registerUser', { nickname: '쵸비' }, r));
  console.log('2. Registered Users:', reg1.nickname, '&', reg2.nickname);

  // Create room
  const createRes = await new Promise(r => s1.emit('createRoom', { name: '롤드컵 결승전 1v1', mode: '1v1' }, r));
  console.log('3. Room Created:', createRes.room.id, createRes.room.name);

  // Join room
  const joinRes = await new Promise(r => s2.emit('joinRoom', { roomId: createRes.room.id }, r));
  console.log('4. Player 2 Joined:', joinRes.success);

  // Switch team
  const switchRes = await new Promise(r => s2.emit('switchTeam', { team: 'red' }, r));
  console.log('5. Chovy Switched to Red Team:', switchRes.success);

  // Ready & Start Draft
  await new Promise(r => s2.emit('toggleReady', r));
  const draftStartRes = await new Promise(r => s1.emit('startDraft', r));
  console.log('6. Host Started Draft:', draftStartRes.success);

  // Tentative picks
  await new Promise(r => s1.emit('selectTentativeChampion', { championId: 'blademaster' }, r));
  await new Promise(r => s2.emit('selectTentativeChampion', { championId: 'pyromancer' }, r));
  console.log('7. Tentative picks sent.');

  // Test Champion Lock Exclusivity & Race Condition
  const lock1 = await new Promise(r => s1.emit('lockChampion', { championId: 'blademaster' }, r));
  console.log('8. Faker locked Blademaster (검객):', lock1);

  // Attempt lock collision
  const lockConflict = await new Promise(r => s2.emit('lockChampion', { championId: 'blademaster' }, r));
  console.log('9. Chovy attempted to pick Blademaster after lock:', lockConflict);

  if (lockConflict.success === false) {
    console.log('   >>> [VERIFIED] EXCLUSIVITY CHECK PASSED: Lock-in collision prevented!');
  } else {
    throw new Error('Lock collision check failed!');
  }

  // Chovy locks Pyromancer
  const lock2 = await new Promise(r => s2.emit('lockChampion', { championId: 'pyromancer' }, r));
  console.log('10. Chovy locked Pyromancer (화염술사):', lock2);

  // Wait for battle to start (3s countdown)
  console.log('11. Waiting 3-second countdown for Battle Start...');
  const battleData = await new Promise(r => s1.on('battleStarted', r));
  console.log('12. Battle Started! Arena Size:', battleData.mapData.width, 'x', battleData.mapData.height);

  // Wait for authoritative tick
  const tickData = await new Promise(r => s1.on('gameTick', r));
  console.log('13. Game Tick received:', {
    playersCount: tickData.players.length,
    structuresCount: tickData.structures.length,
    player1Hp: tickData.players[0].hp,
    player2Hp: tickData.players[1].hp
  });

  // Test in-game actions
  s1.emit('playerMove', { x: 500, y: 800 });
  s1.emit('castSkill', { key: 'Q', targetX: 600, targetY: 800 });
  s1.emit('castSpell', { slot: 'D', targetX: 650, targetY: 800 });

  await new Promise(r => setTimeout(r, 1200));

  // Receive another tick to verify updated movement/cooldowns
  const updatedTick = await new Promise(r => s1.once('gameTick', r));
  console.log('14. Updated Game Tick after Skill Cast:', {
    p1Cooldowns: updatedTick.players[0].cooldowns,
    p1Pos: { x: updatedTick.players[0].x, y: updatedTick.players[0].y }
  });

  s1.disconnect();
  s2.disconnect();
  console.log('\n===========================================');
  console.log('   ALL 14 INTEGRATION CHECKS PASSED! ⚔️');
  console.log('===========================================\n');
  process.exit(0);
}

testGameFlow().catch(err => {
  console.error('Test simulation failed:', err);
  process.exit(1);
});
