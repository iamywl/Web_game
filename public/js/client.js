/**
 * client.js
 * MOBA LAN Client
 * Manages socket connection, screen flows (Login -> Lobby -> Draft -> Arena),
 * user inputs, skill casts, and real-time state synchronization.
 */

import { GameRenderer } from './renderer.js';

(function () {
  'use strict';

  // Global Socket & State
  const socket = io();
  const skillSnapshotFields = ['garen', 'yasuo', 'airborneRemaining', 'isSilenced', 'level', 'exp', 'maxExp', 'skillRanks', 'skillPoints',
    'ad', 'armor', 'ap', 'gold', 'items', 'recalling', 'recallProgress', 'isStunned', 'isRooted'];

  let localUser = {
    socketId: null,
    nickname: '',
    roomId: null,
    team: 'blue',
    isHost: false,
    selectedChampId: 'blademaster',
    lockedChampId: null,
    spellD: 'flash',
    spellF: 'ignite'
  };

  let currentRoom = null;
  let championsData = {};
  let spellsData = {};
  let itemsData = {};
  let gameRenderer = null;
  let latestGameState = null;
  let isGameActive = false;
  let mouseScreenPos = { x: 0, y: 0 };
  let mouseWorldPos = { x: 0, y: 0 };
  let isAttackMoveActive = false;

  // Aiming state (for manual targeting if needed)
  let activeAimKey = null;

  // DOM Elements
  const screens = {
    login: document.getElementById('screen-login'),
    lobby: document.getElementById('screen-lobby'),
    draft: document.getElementById('screen-draft'),
    game: document.getElementById('screen-game')
  };

  function switchScreen(screenName) {
    Object.values(screens).forEach(sc => {
      sc.classList.remove('active');
      sc.classList.add('hidden');
    });
    if (screens[screenName]) {
      screens[screenName].classList.remove('hidden');
      screens[screenName].classList.add('active');
    }
  }

  // ==========================================================
  // 1. INITIALIZATION & SERVER INFO
  // ==========================================================

  fetch('/api/server-info')
    .then(res => res.json())
    .then(info => {
      const lanUrlEl = document.getElementById('login-lan-url');
      const lobbyLanEl = document.getElementById('lobby-lan-ip');
      if (lanUrlEl) lanUrlEl.textContent = info.lanUrl || `http://${info.lanIp}:${info.port}`;
      if (lobbyLanEl) lobbyLanEl.textContent = `${info.lanIp}:${info.port}`;
    })
    .catch(err => console.log('Server info fetch fallback:', err));

  fetch('/api/game-data')
    .then(res => res.json())
    .then(data => {
      championsData = data.champions || {};
      spellsData = data.spells || {};
      itemsData = data.items || {};
    })
    .catch(err => console.log('Game data fetch error:', err));

  socket.on('connect', () => {
    localUser.socketId = socket.id;
  });

  // Copy LAN URL button
  const btnCopyLan = document.getElementById('btn-copy-lan');
  if (btnCopyLan) {
    btnCopyLan.addEventListener('click', () => {
      const urlText = document.getElementById('login-lan-url').textContent;
      navigator.clipboard.writeText(urlText).then(() => {
        btnCopyLan.textContent = '복사 완료!';
        setTimeout(() => { btnCopyLan.textContent = '주소 복사'; }, 2000);
      });
    });
  }

  // ==========================================================
  // 2. SCREEN 1: LOGIN FLOW
  // ==========================================================

  const formLogin = document.getElementById('form-login');
  const inputNickname = document.getElementById('input-nickname');

  formLogin.addEventListener('submit', (e) => {
    e.preventDefault();
    const nick = (inputNickname.value || '').trim();
    if (!nick) return;

    socket.emit('registerUser', { nickname: nick }, (res) => {
      if (res && res.success) {
        localUser.nickname = res.nickname;
        document.getElementById('lobby-user-name').textContent = res.nickname;
        switchScreen('lobby');
        socket.emit('getLobbyState', updateLobbyUI);
      }
    });
  });

  // ==========================================================
  // 3. SCREEN 2: LOBBY & WAITING ROOM FLOW
  // ==========================================================

  const lobbyBrowser = document.getElementById('lobby-browser');
  const lobbyRoomView = document.getElementById('lobby-room-view');
  const roomsListTbody = document.getElementById('rooms-list-tbody');
  const roomCountBadge = document.getElementById('room-count-badge');
  const onlineUsersCount = document.getElementById('online-users-count');
  const onlineUsersList = document.getElementById('online-users-list');

  socket.on('lobbyUpdate', (lobbyData) => {
    updateLobbyUI(lobbyData);
  });

  function updateLobbyUI(data) {
    if (!data) return;

    // Online users chips
    if (data.onlineUsers) {
      onlineUsersCount.textContent = data.onlineUsers.length;
      onlineUsersList.innerHTML = '';
      data.onlineUsers.forEach(u => {
        const chip = document.createElement('div');
        chip.className = `user-chip ${u.isInRoom ? 'in-room' : ''}`;
        chip.textContent = `${u.nickname} ${u.isInRoom ? '(전투 중)' : ''}`;
        onlineUsersList.appendChild(chip);
      });
    }

    // Rooms Table
    if (data.rooms) {
      roomCountBadge.textContent = `${data.rooms.length}개 방 운영 중`;
      roomsListTbody.innerHTML = '';

      if (data.rooms.length === 0) {
        roomsListTbody.innerHTML = `<tr><td colspan="6" class="empty-notice">개설된 방이 없습니다. 새로 만들어보세요!</td></tr>`;
      } else {
        data.rooms.forEach(r => {
          const tr = document.createElement('tr');
          const isFull = r.playerCount >= r.maxPlayers;
          const statusText = r.state === 'LOBBY' ? '대기 중' : (r.state === 'DRAFT' ? '밴픽 중' : '전투 중');

          tr.innerHTML = `
            <td>#${r.id.replace('room_', '')}</td>
            <td><b>${escapeHtml(r.name)}</b></td>
            <td><span class="badge-mode">${r.mode.toUpperCase()}</span></td>
            <td>${r.playerCount} / ${r.maxPlayers}</td>
            <td><span class="status-tag ${r.state.toLowerCase()}">${statusText}</span></td>
            <td>
              <button class="btn-sm btn-gold btn-join-room" data-room-id="${r.id}" ${isFull || r.state !== 'LOBBY' ? 'disabled' : ''}>
                ${isFull ? '만원' : '참가'}
              </button>
            </td>
          `;
          roomsListTbody.appendChild(tr);
        });

        // Attach join handlers
        document.querySelectorAll('.btn-join-room').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const roomId = e.target.getAttribute('data-room-id');
            joinRoom(roomId);
          });
        });
      }
    }
  }

  // Refresh rooms button
  document.getElementById('btn-refresh-rooms').addEventListener('click', () => {
    socket.emit('getLobbyState', updateLobbyUI);
  });

  // Modal: Create Room
  const modalCreateRoom = document.getElementById('modal-create-room');
  const btnOpenCreate = document.getElementById('btn-open-create-room');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnCancelCreate = document.getElementById('btn-cancel-create');
  const formCreateRoom = document.getElementById('form-create-room');
  const inputRoomName = document.getElementById('input-room-name');

  btnOpenCreate.addEventListener('click', () => {
    modalCreateRoom.classList.remove('hidden');
    inputRoomName.focus();
  });

  btnCloseModal.addEventListener('click', () => modalCreateRoom.classList.add('hidden'));
  btnCancelCreate.addEventListener('click', () => modalCreateRoom.classList.add('hidden'));

  // Mode radio toggle styling
  document.querySelectorAll('.mode-card input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('active'));
      e.target.closest('.mode-card').classList.add('active');
    });
  });

  formCreateRoom.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = inputRoomName.value.trim();
    const mode = document.querySelector('input[name="roomMode"]:checked').value;

    socket.emit('createRoom', { name, mode }, (res) => {
      if (res.success) {
        modalCreateRoom.classList.add('hidden');
        enterRoomView(res.room);
      } else {
        alert(res.error || '방 생성에 실패했습니다.');
      }
    });
  });

  function joinRoom(roomId) {
    socket.emit('joinRoom', { roomId }, (res) => {
      if (res.success) {
        enterRoomView(res.room);
      } else {
        alert(res.error || '방 입장에 실패했습니다.');
      }
    });
  }

  function enterRoomView(room) {
    currentRoom = room;
    localUser.roomId = room.id;
    localUser.isHost = room.hostId === localUser.socketId;

    lobbyBrowser.classList.add('hidden');
    lobbyRoomView.classList.remove('hidden');

    renderWaitingRoom(room);
  }

  function exitRoomView() {
    currentRoom = null;
    localUser.roomId = null;
    localUser.isHost = false;

    lobbyRoomView.classList.add('hidden');
    lobbyBrowser.classList.remove('hidden');
    socket.emit('getLobbyState', updateLobbyUI);
  }

  document.getElementById('btn-leave-room').addEventListener('click', () => {
    socket.emit('leaveRoom', () => {
      exitRoomView();
    });
  });

  // Switch Team Blue / Red
  document.getElementById('btn-switch-blue').addEventListener('click', () => {
    socket.emit('switchTeam', { team: 'blue' });
  });
  document.getElementById('btn-switch-red').addEventListener('click', () => {
    socket.emit('switchTeam', { team: 'red' });
  });

  // Ready & Start Draft
  const btnToggleReady = document.getElementById('btn-toggle-ready');
  const btnStartDraft = document.getElementById('btn-start-draft');

  btnToggleReady.addEventListener('click', () => {
    socket.emit('toggleReady');
  });

  btnStartDraft.addEventListener('click', () => {
    socket.emit('startDraft', (res) => {
      if (!res.success) {
        alert(res.error || '게임을 시작할 수 없습니다.');
      }
    });
  });

  // Room State Changed Listener
  socket.on('roomStateChanged', (room) => {
    currentRoom = room;
    if (room.state === 'LOBBY') {
      if (screens.draft.classList.contains('active') || screens.game.classList.contains('active')) {
        switchScreen('lobby');
        enterRoomView(room);
      } else {
        renderWaitingRoom(room);
      }
    }
  });

  function renderWaitingRoom(room) {
    document.getElementById('room-view-name').textContent = room.name;
    document.getElementById('room-view-mode').textContent = room.mode.toUpperCase();

    const blueSlots = document.getElementById('team-blue-slots');
    const redSlots = document.getElementById('team-red-slots');
    blueSlots.innerHTML = '';
    redSlots.innerHTML = '';

    const myPlayer = room.players.find(p => p.socketId === localUser.socketId);
    if (myPlayer) {
      localUser.team = myPlayer.team;
      localUser.isHost = myPlayer.isHost;
    }

    // Render players in teams
    room.players.forEach(p => {
      const slot = document.createElement('div');
      slot.className = 'player-slot';
      slot.innerHTML = `
        <div class="slot-nickname">
          ${p.isHost ? '<span class="host-crown">👑</span>' : ''}
          ${escapeHtml(p.nickname)} ${p.socketId === localUser.socketId ? '(나)' : ''}
        </div>
        <div class="slot-status ${p.isReady ? 'ready' : 'waiting'}">
          ${p.isHost ? '방장' : (p.isReady ? '준비 완료' : '대기 중')}
        </div>
      `;
      if (p.team === 'blue') blueSlots.appendChild(slot);
      else redSlots.appendChild(slot);
    });

    // Toggle Ready / Start Draft visibility
    if (localUser.isHost) {
      btnToggleReady.classList.add('hidden');
      btnStartDraft.classList.remove('hidden');
    } else {
      btnToggleReady.classList.remove('hidden');
      btnStartDraft.classList.add('hidden');
      if (myPlayer) {
        btnToggleReady.textContent = myPlayer.isReady ? '준비 취소' : '준비 완료';
      }
    }
  }

  // Room Chat
  const formRoomChat = document.getElementById('form-room-chat');
  const inputRoomChat = document.getElementById('input-room-chat');
  const roomChatMessages = document.getElementById('room-chat-messages');

  formRoomChat.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = inputRoomChat.value.trim();
    if (!msg) return;
    socket.emit('sendChat', { message: msg });
    inputRoomChat.value = '';
  });

  socket.on('chatMessage', (data) => {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="chat-sender">[${data.sender}]</span> ${escapeHtml(data.text)}`;
    roomChatMessages.appendChild(div);
    roomChatMessages.scrollTop = roomChatMessages.scrollHeight;
  });

  // ==========================================================
  // 4. SCREEN 3: DRAFT PICK (CHAMPION SELECT) FLOW
  // ==========================================================

  const championsGrid = document.getElementById('champions-grid');
  const btnLockChamp = document.getElementById('btn-lock-champion');
  const draftBlueRoster = document.getElementById('draft-blue-roster');
  const draftRedRoster = document.getElementById('draft-red-roster');
  const selectSpellD = document.getElementById('select-spell-d');
  const selectSpellF = document.getElementById('select-spell-f');

  socket.on('draftStarted', (data) => {
    if (data.champions) championsData = data.champions;
    if (data.spells) spellsData = data.spells;

    localUser.lockedChampId = null;
    localUser.selectedChampId = 'blademaster';

    switchScreen('draft');
    initDraftPickUI();
  });

  socket.on('draftCancelled', (data) => {
    alert(data.reason || '밴픽이 취소되었습니다.');
    switchScreen('lobby');
  });

  function initDraftPickUI() {
    championsGrid.innerHTML = '';
    const champKeys = Object.keys(championsData);

    champKeys.forEach(key => {
      const champ = championsData[key];
      const card = document.createElement('div');
      card.className = `champ-pick-card ${key === localUser.selectedChampId ? 'selected' : ''}`;
      card.id = `champ-card-${key}`;
      card.style.setProperty('--champ-accent', champ.color || '#c89b3c');
      card.innerHTML = `
        <div class="champ-card-glow-bg" style="background: radial-gradient(circle at 50% 20%, ${champ.color}44 0%, rgba(6, 11, 20, 0.95) 75%);"></div>
        <div class="champ-card-avatar-crest" style="border-color: ${champ.color || '#c89b3c'}; box-shadow: 0 0 14px ${champ.color}55;">
          <span class="champ-avatar-emoji">${champ.avatar}</span>
        </div>
        <div class="champ-card-meta">
          <div class="champ-card-name">${champ.name}</div>
          <div class="champ-card-title">${champ.title}</div>
          <div class="champ-card-role-badge" style="background: ${champ.color}22; border-color: ${champ.color}66; color: ${champ.color};">
            ${champ.role.split(' ')[0]}
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        if (localUser.lockedChampId) return; // already locked
        if (card.classList.contains('disabled')) return; // already locked by someone else
        selectChampion(key);
      });

      championsGrid.appendChild(card);
    });

    // Select default champ
    selectChampion(localUser.selectedChampId);

    // Spells change listeners
    selectSpellD.addEventListener('change', () => {
      localUser.spellD = selectSpellD.value;
      socket.emit('setSpells', { spellD: localUser.spellD, spellF: localUser.spellF });
    });
    selectSpellF.addEventListener('change', () => {
      localUser.spellF = selectSpellF.value;
      socket.emit('setSpells', { spellD: localUser.spellD, spellF: localUser.spellF });
    });

    btnLockChamp.disabled = false;
    btnLockChamp.textContent = '선택 완료 (LOCK IN)';
  }

  function selectChampion(champId) {
    localUser.selectedChampId = champId;

    // Update active highlight
    document.querySelectorAll('.champ-pick-card').forEach(c => c.classList.remove('selected'));
    const targetCard = document.getElementById(`champ-card-${champId}`);
    if (targetCard) targetCard.classList.add('selected');

    // Update Detail Panel
    const champ = championsData[champId];
    if (champ) {
      document.getElementById('detail-champ-avatar').textContent = champ.avatar;
      document.getElementById('detail-champ-name').textContent = champ.name;
      document.getElementById('detail-champ-title').textContent = champ.title;
      document.getElementById('detail-champ-role').textContent = champ.role;

      document.getElementById('detail-champ-stats').innerHTML = `
        <span>체력: <b>${champ.stats.maxHp}</b></span>
        <span>사거리: <b>${champ.stats.attackRange}</b></span>
        <span>공격력: <b>${champ.stats.attackDamage}</b></span>
        <span>이동속도: <b>${champ.stats.moveSpeed}</b></span>
      `;

      // Passive
      document.querySelector('#skill-passive .skill-name').textContent = champ.passive.name;
      document.querySelector('#skill-passive .skill-desc').textContent = champ.passive.desc;

      // Q, W, E, R
      ['Q', 'W', 'E', 'R'].forEach(key => {
        const sk = champ.skills[key];
        const el = document.getElementById(`skill-${key.toLowerCase()}`);
        if (sk && el) {
          el.querySelector('.skill-name').textContent = sk.name;
          el.querySelector('.skill-desc').textContent = sk.desc;
        }
      });
    }

    // Emit tentative selection
    socket.emit('selectTentativeChampion', { championId: champId });
  }

  // Lock In Button Click
  btnLockChamp.addEventListener('click', () => {
    if (localUser.lockedChampId) return;

    btnLockChamp.disabled = true;
    socket.emit('lockChampion', { championId: localUser.selectedChampId }, (res) => {
      if (res && res.success) {
        localUser.lockedChampId = localUser.selectedChampId;
        btnLockChamp.textContent = '선택 완료됨 (LOCKED)';
      } else {
        btnLockChamp.disabled = false;
        alert(res.error || '선택에 실패했습니다. 다른 챔피언을 골라주세요.');
      }
    });
  });

  // Draft Updates (Locked champions, picks)
  socket.on('draftUpdate', (data) => {
    // 1. Update disabled cards for locked champions
    const lockedMap = data.lockedChampions || {};
    document.querySelectorAll('.champ-pick-card').forEach(card => {
      const champKey = card.id.replace('champ-card-', '');
      if (lockedMap[champKey]) {
        card.classList.add('disabled');
      } else {
        card.classList.remove('disabled');
      }
    });

    // 2. Update Rosters
    draftBlueRoster.innerHTML = '';
    draftRedRoster.innerHTML = '';

    if (data.playerPicks) {
      Object.values(data.playerPicks).forEach(p => {
        const champ = championsData[p.championId || p.tentativeChampId];
        const card = document.createElement('div');
        card.className = `draft-summoner-card ${p.isLocked ? 'locked' : ''}`;
        card.innerHTML = `
          <div class="draft-card-avatar">${champ ? champ.avatar : '❓'}</div>
          <div class="draft-card-meta">
            <div class="draft-card-nick">${escapeHtml(p.nickname)}</div>
            <div class="draft-card-champ">${champ ? champ.name : '선택 중...'}</div>
          </div>
          ${p.isLocked ? '<span class="draft-lock-badge">✓ 확정</span>' : ''}
        `;

        if (p.team === 'blue') draftBlueRoster.appendChild(card);
        else draftRedRoster.appendChild(card);
      });
    }
  });

  // Countdown Overlay
  const draftCountdownOverlay = document.getElementById('draft-countdown-overlay');
  const countdownNumber = document.getElementById('countdown-number');

  socket.on('draftCountdown', (data) => {
    draftCountdownOverlay.classList.remove('hidden');
    countdownNumber.textContent = data.seconds;
  });

  // ==========================================================
  // 5. SCREEN 4: IN-GAME ARENA & HUD
  // ==========================================================

  // 60 FPS High-Performance Game Loop with real-time Telemetry
  let animationFrameId = null;
  let fpsFrames = 0;
  let fpsLastCalc = performance.now();
  let currentFps = 60;
  let pingIntervalHandle = null;

  let lastHudUpdate = 0;

  function start60FpsGameLoop() {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);

    // Periodic Ping Check (every 1.0s)
    if (pingIntervalHandle) clearInterval(pingIntervalHandle);
    pingIntervalHandle = setInterval(() => {
      if (!isGameActive) return;
      const start = performance.now();
      socket.emit('pingCheck', start, () => {
        const pingMs = Math.max(1, Math.round(performance.now() - start));
        const pingEl = document.getElementById('ping-display');
        if (pingEl) pingEl.textContent = `${pingMs}ms`;
      });
    }, 1000);

    let lastFrameTime = performance.now();
    let lastHoverCheckTime = 0;
    let prevHoverState = false;

    function frame(now) {
      if (isGameActive && gameRenderer && latestGameState) {
        const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
        lastFrameTime = now;

        // Calculate real FPS
        fpsFrames++;
        if (now - fpsLastCalc >= 500) {
          currentFps = Math.round((fpsFrames * 1000) / (now - fpsLastCalc));
          fpsFrames = 0;
          fpsLastCalc = now;
          const fpsEl = document.getElementById('fps-display');
          if (fpsEl) fpsEl.textContent = `${currentFps} FPS`;
        }

        // Screen to world mouse position (1 raycast per frame)
        mouseWorldPos = gameRenderer.screenToWorld(mouseScreenPos.x, mouseScreenPos.y);

        // Client-side movement prediction for local player (0ms immediate responsiveness)
        const myPlayer = latestGameState.players ? latestGameState.players.find(p => p.id === localUser.socketId) : null;
        if (myPlayer && myPlayer.isAlive) {
          if (gameRenderer && gameRenderer.gameFeelController) {
            // Synchronize with GameFeelController prediction
            myPlayer.x = Math.round(gameRenderer.gameFeelController.predictedPosition.x);
            myPlayer.y = Math.round(gameRenderer.gameFeelController.predictedPosition.z);
            myPlayer.isMoving = gameRenderer.gameFeelController.isMoving;
          } else if (myPlayer.isMoving && myPlayer.targetX !== undefined) {
            const dx = myPlayer.targetX - myPlayer.x;
            const dy = myPlayer.targetY - myPlayer.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 4) {
              const speed = myPlayer.moveSpeed || 340;
              const step = Math.min(dist, speed * dt);
              myPlayer.x += (dx / dist) * step;
              myPlayer.y += (dy / dist) * step;
              myPlayer.angle = Math.atan2(dy, dx);
            } else {
              myPlayer.x = myPlayer.targetX;
              myPlayer.y = myPlayer.targetY;
              myPlayer.isMoving = false;
            }
          }
        }

        // Throttled enemy hover attack cursor check (20Hz)
        if (now - lastHoverCheckTime >= 50 && myPlayer) {
          lastHoverCheckTime = now;
          let isEnemyHovered = false;
          // Check enemy champions (32px hitbox)
          for (const ep of latestGameState.players) {
            if (ep.isAlive && ep.team !== myPlayer.team) {
              if (Math.hypot(ep.x - mouseWorldPos.x, ep.y - mouseWorldPos.y) <= 32) {
                isEnemyHovered = true;
                break;
              }
            }
          }
          // Check enemy minions (24px hitbox)
          if (!isEnemyHovered && latestGameState.minions) {
            for (const m of latestGameState.minions) {
              if (m.hp > 0 && m.team !== myPlayer.team) {
                if (Math.hypot(m.x - mouseWorldPos.x, m.y - mouseWorldPos.y) <= 24) {
                  isEnemyHovered = true;
                  break;
                }
              }
            }
          }
          // Check enemy structures (52px hitbox)
          if (!isEnemyHovered && latestGameState.structures) {
            for (const s of latestGameState.structures) {
              if (s.isAlive && s.team !== myPlayer.team) {
                if (Math.hypot(s.x - mouseWorldPos.x, s.y - mouseWorldPos.y) <= 52) {
                  isEnemyHovered = true;
                  break;
                }
              }
            }
          }
          const shouldAttackCursor = isEnemyHovered || isAttackMoveActive;
          if (shouldAttackCursor !== prevHoverState) {
            prevHoverState = shouldAttackCursor;
            const gameScreenEl = document.getElementById('screen-game');
            if (gameScreenEl) {
              if (shouldAttackCursor) gameScreenEl.classList.add('cursor-attack');
              else gameScreenEl.classList.remove('cursor-attack');
            }
          }
        }

        // Render at 60~144+ FPS with camera update
        gameRenderer.render(latestGameState, mouseScreenPos, dt);
      } else {
        lastFrameTime = now;
      }
      animationFrameId = requestAnimationFrame(frame);
    }
    animationFrameId = requestAnimationFrame(frame);
  }

  socket.on('battleStarted', (data) => {
    isGameActive = true;
    latestGameState = null;
    draftCountdownOverlay.classList.add('hidden');
    switchScreen('game');

    // Initialize Renderer with LoL CameraController
    if (!gameRenderer) {
      const cameraController = new CameraController({
        mapWidth: data.mapData ? data.mapData.width : 2400,
        mapHeight: data.mapData ? data.mapData.height : 1600
      });
      const RendererClass = window.GameRenderer || globalThis.GameRenderer || (typeof GameRenderer !== 'undefined' ? GameRenderer : null);
      if (!RendererClass) {
        console.error('Fatal: GameRenderer class not found on window or global scope!');
        return;
      }
      gameRenderer = new RendererClass('game-canvas-container', cameraController);
    }
    // A socket can pick a different champion in its next match.
    gameRenderer.update3DChampions([], 0);
    gameRenderer.garenEffects.update([], gameRenderer.threePlayerMeshes, 0);
    gameRenderer.garenAudio.update([]);
    gameRenderer.yasuoEffects.update([], gameRenderer.threePlayerMeshes, 0, [], []);
    gameRenderer.yasuoAudio.update([], []);
    if (data.mapData) {
      gameRenderer.setMapData(data.mapData);
    }
    gameRenderer.setLocalPlayerId(localUser.socketId);

    // Initial snap camera to player base
    const myPlayer = (data.gameState && data.gameState.players) ? data.gameState.players.find(p => p.id === localUser.socketId) : null;
    if (myPlayer) {
      gameRenderer.camera.snapTo(myPlayer.x, myPlayer.y);
    }

    setupInGameInputListeners();
    setupInGameHud(localUser.selectedChampId);

    // Start 60 FPS Render Loop
    start60FpsGameLoop();
  });

  socket.on('gameTick', (state) => {
    if (!latestGameState) {
      latestGameState = state;
      const initialMe = state.players ? state.players.find(p => p.id === localUser.socketId) : null;
      if (initialMe && gameRenderer && gameRenderer.gameFeelController) {
        gameRenderer.gameFeelController.initPosition(initialMe.x, initialMe.y);
      }
    } else {
      // Smooth Client-Side Prediction Reconciliation
      const serverMe = state.players ? state.players.find(p => p.id === localUser.socketId) : null;
      const clientMe = latestGameState.players ? latestGameState.players.find(p => p.id === localUser.socketId) : null;
      if (serverMe && clientMe) {
        const errDist = Math.hypot(serverMe.x - clientMe.x, serverMe.y - clientMe.y);
        if (errDist > 120 || !serverMe.isAlive) {
          clientMe.x = serverMe.x;
          clientMe.y = serverMe.y;
          clientMe.targetX = serverMe.x;
          clientMe.targetY = serverMe.y;
          clientMe.isMoving = false;
        } else if (errDist > 4) {
          clientMe.x = clientMe.x * 0.72 + serverMe.x * 0.28;
          clientMe.y = clientMe.y * 0.72 + serverMe.y * 0.28;
        }
        clientMe.hp = serverMe.hp;
        clientMe.maxHp = serverMe.maxHp;
        clientMe.mp = serverMe.mp;
        clientMe.maxMp = serverMe.maxMp;
        clientMe.shield = serverMe.shield;
        clientMe.cooldowns = serverMe.cooldowns;
        clientMe.kills = serverMe.kills;
        clientMe.deaths = serverMe.deaths;
        clientMe.assists = serverMe.assists;
        clientMe.cs = serverMe.cs;
        clientMe.isAlive = serverMe.isAlive;
        clientMe.respawnTimer = serverMe.respawnTimer;
        clientMe.stealth = serverMe.stealth;
        clientMe.vx = serverMe.vx;
        clientMe.vy = serverMe.vy;
        clientMe.angle = serverMe.angle;
        clientMe.as = serverMe.as;
        clientMe.moveSpeed = serverMe.moveSpeed;
        clientMe.inBush = serverMe.inBush;
        clientMe.bushId = serverMe.bushId;
        clientMe.revealed = serverMe.revealed;
        // Keep authoritative skill progression and Garen's timed states in sync.
        for (const field of skillSnapshotFields) {
          clientMe[field] = serverMe[field];
        }

        // Reconcile GameFeelController prediction with authoritative server position
        if (gameRenderer && gameRenderer.gameFeelController) {
          gameRenderer.gameFeelController.onServerSnapshot(serverMe.x, serverMe.y);
          gameRenderer.gameFeelController.onNavigationSnapshot(serverMe.navX, serverMe.navY, serverMe.x, serverMe.y);
          gameRenderer.gameFeelController.moveSpeed = serverMe.moveSpeed;
          if (serverMe.garen?.rRemaining > 0) gameRenderer.gameFeelController.stopMoving();
          if (serverMe.yasuo?.eRemaining > 0 || serverMe.yasuo?.rRemaining > 0) {
            clientMe.x = serverMe.x; clientMe.y = serverMe.y;
            gameRenderer.gameFeelController.initPosition(serverMe.x, serverMe.y);
          }
        }
      }

      // Reconcile other players and game state
      if (state.players) {
        for (let i = latestGameState.players.length - 1; i >= 0; i--) {
          if (!state.players.some(p => p.id === latestGameState.players[i].id)) latestGameState.players.splice(i, 1);
        }
        state.players.forEach(sp => {
          if (sp.id !== localUser.socketId) {
            let cp = latestGameState.players ? latestGameState.players.find(p => p.id === sp.id) : null;
            if (!cp) {
              if (latestGameState.players) latestGameState.players.push(sp);
            } else {
              Object.assign(cp, sp);
            }
          }
        });
      }
      latestGameState.structures = state.structures;
      latestGameState.minions = state.minions;
      latestGameState.projectiles = state.projectiles;
      latestGameState.yasuoWalls = state.yasuoWalls;
      latestGameState.jungleMonsters = state.jungleMonsters;
      latestGameState.wards = state.wards;
      latestGameState.aoeZones = state.aoeZones;
      latestGameState.events = state.events;
      latestGameState.scores = state.scores;
      latestGameState.gameTime = state.gameTime;
    }

    if (!isGameActive || !gameRenderer) return;

    // Process events for VFX
    gameRenderer.processEvents(state.events);

    // Throttle HUD DOM reflows to 15 Hz (~66ms) to prevent UI thread locking
    const now = performance.now();
    if (now - lastHudUpdate >= 66) {
      lastHudUpdate = now;
      updateInGameHUD(latestGameState);
    }
  });

  function setupInGameInputListeners() {
    const canvasContainer = document.getElementById('game-canvas-container');
    const gameScreenEl = document.getElementById('screen-game');
    const minimapCanvas = document.getElementById('minimap-canvas');
    const btnCameraMode = document.getElementById('btn-camera-mode');

    // Camera Mode button helper
    function updateCameraModeUI(mode) {
      if (!btnCameraMode) return;
      btnCameraMode.textContent = mode === 'LOCKED' ? '[Y] 고정 시점' : '[Y] 자유 시점';
      btnCameraMode.style.background = mode === 'LOCKED' ? '#1e3a5f' : '#27ae60';
      btnCameraMode.style.borderColor = mode === 'LOCKED' ? '#00d2d3' : '#2ecc71';
    }

    if (btnCameraMode) {
      btnCameraMode.addEventListener('click', () => {
        if (gameRenderer && gameRenderer.camera) {
          const newMode = gameRenderer.camera.toggleLock();
          updateCameraModeUI(newMode);
        }
      });
    }

    // Minimap Left-Click & Drag Navigation
    let isMinimapNavigating = false;
    function handleMinimapPan(e) {
      if (!gameRenderer || !gameRenderer.camera || !minimapCanvas) return;
      const rect = minimapCanvas.getBoundingClientRect();
      const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      const mapW = gameRenderer.mapData.width || 2400;
      const mapH = gameRenderer.mapData.height || 1600;
      gameRenderer.camera.panTo(normX * mapW, normY * mapH);
    }

    if (minimapCanvas) {
      minimapCanvas.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (e.button === 0) {
          isMinimapNavigating = true;
          handleMinimapPan(e);
        } else if (e.button === 2) {
          // Authentic LoL minimap right-click move command
          e.preventDefault();
          const rect = minimapCanvas.getBoundingClientRect();
          const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
          const mapW = (gameRenderer && gameRenderer.mapData && gameRenderer.mapData.width) ? gameRenderer.mapData.width : 2400;
          const mapH = (gameRenderer && gameRenderer.mapData && gameRenderer.mapData.height) ? gameRenderer.mapData.height : 1600;
          const targetWorldX = normX * mapW;
          const targetWorldY = normY * mapH;
          if (isGameActive && socket) {
            socket.emit('playerMove', { x: targetWorldX, y: targetWorldY });
            gameRenderer.gameFeelController?.issueMoveCommand(targetWorldX, targetWorldY);
            if (gameRenderer) {
              gameRenderer.addClickRing(targetWorldX, targetWorldY, false);
            }
          }
        }
      });
      window.addEventListener('mousemove', (e) => {
        if (isMinimapNavigating) {
          handleMinimapPan(e);
        }
      });
      window.addEventListener('mouseup', () => {
        isMinimapNavigating = false;
      });
    }

    // High-performance mouse tracking (Zero raycasts or DOM touches on mousemove for 1000Hz gaming mice)
    window.addEventListener('mousemove', (e) => {
      mouseScreenPos.x = e.clientX;
      mouseScreenPos.y = e.clientY;
    });

    // Disable default right-click context menu
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    // Mouse Click Handling (Left = Cast/A-Move, Right = Move/Target)
    window.addEventListener('mousedown', (e) => {
      if (!isGameActive || !latestGameState) return;

      if (e.button === 2) { // Right Click (Move / Auto-Attack Target)
        e.preventDefault();
        const worldPos = gameRenderer.screenToWorld(e.clientX, e.clientY);

        // Cancel A-move mode if active
        if (isAttackMoveActive) {
          isAttackMoveActive = false;
          if (gameRenderer) gameRenderer.isAttackMoveActive = false;
          if (gameScreenEl) gameScreenEl.classList.remove('cursor-attack');
        }

        // Check if right-clicked on an enemy champion or structure with generous 75px hitbox
        let clickedTarget = null;
        let targetX = worldPos.x;
        let targetY = worldPos.y;
        const myPlayer = latestGameState.players.find(p => p.id === localUser.socketId);
        if (myPlayer?.yasuo?.eRemaining > 0 || myPlayer?.yasuo?.rRemaining > 0) return;

        if (myPlayer) {
          // Check enemy players (Direct click on champion hitbox)
          let closestDist = 32;
          for (const ep of latestGameState.players) {
            if (ep.isAlive && ep.team !== myPlayer.team) {
              const d = Math.hypot(ep.x - worldPos.x, ep.y - worldPos.y);
              if (d <= closestDist) {
                closestDist = d;
                clickedTarget = ep.id;
                targetX = ep.x;
                targetY = ep.y;
              }
            }
          }
          // Check enemy minions (Direct click on minion hitbox)
          if (!clickedTarget && latestGameState.minions) {
            let closestMinionDist = 24;
            for (const m of latestGameState.minions) {
              if (m.hp > 0 && m.team !== myPlayer.team) {
                const d = Math.hypot(m.x - worldPos.x, m.y - worldPos.y);
                if (d <= closestMinionDist) {
                  closestMinionDist = d;
                  clickedTarget = m.id;
                  targetX = m.x;
                  targetY = m.y;
                }
              }
            }
          }
          // Check enemy structures (Direct click on tower base)
          if (!clickedTarget && latestGameState.structures) {
            let closestStructDist = 52;
            for (const s of latestGameState.structures) {
              if (s.isAlive && s.team !== myPlayer.team) {
                const d = Math.hypot(s.x - worldPos.x, s.y - worldPos.y);
                if (d <= closestStructDist) {
                  closestStructDist = d;
                  clickedTarget = s.id;
                  targetX = s.x;
                  targetY = s.y;
                }
              }
            }
          }
        }

        if (myPlayer) {
          const meshTarget = gameRenderer.pickCombatTarget(e.clientX, e.clientY, myPlayer.team);
          if (meshTarget) { clickedTarget = meshTarget.id; targetX = meshTarget.x; targetY = meshTarget.y; }
          if (!clickedTarget) for (const monster of latestGameState.jungleMonsters || []) {
            if (monster.isAlive && Math.hypot(monster.x - worldPos.x, monster.y - worldPos.y) <= monster.radius) {
              clickedTarget = monster.id; targetX = monster.x; targetY = monster.y; break;
            }
          }
        }

        if (clickedTarget) {
          socket.emit('playerTarget', { targetId: clickedTarget });
          gameRenderer.addClickRing(targetX, targetY, true); // Red targeting ring!
          if (gameRenderer && gameRenderer.gameFeelController) {
            gameRenderer.gameFeelController.stopMoving();
          }
        } else {
          // Move command - Instantly apply client-side prediction for 0ms perceptual latency!
          const tx = Math.round(worldPos.x);
          const ty = Math.round(worldPos.y);
          socket.emit('playerMove', { x: tx, y: ty });
          gameRenderer.addClickRing(worldPos.x, worldPos.y, false); // Green move ring!
          if (window.soundEngine) window.soundEngine.playMovePing();

          if (myPlayer && myPlayer.isAlive) {
            myPlayer.targetX = tx;
            myPlayer.targetY = ty;
            const dx = tx - myPlayer.x;
            const dy = ty - myPlayer.y;
            if (Math.hypot(dx, dy) > 5) {
              myPlayer.angle = Math.atan2(dy, dx);
              myPlayer.isMoving = true;
            }
          }

          // GameFeelController instant 0ms input prediction
          if (gameRenderer && gameRenderer.gameFeelController) {
            gameRenderer.gameFeelController.issueMoveCommand(tx, ty);
          }
        }
      } else if (e.button === 0) { // Left Click
        if (isAttackMoveActive) {
          const worldPos = gameRenderer.screenToWorld(e.clientX, e.clientY);
          socket.emit('playerAttackMove', { x: Math.round(worldPos.x), y: Math.round(worldPos.y) });
          gameRenderer.addClickRing(worldPos.x, worldPos.y, true); // Red attack ring!
          isAttackMoveActive = false;
          if (gameRenderer) gameRenderer.isAttackMoveActive = false;
          if (gameScreenEl) gameScreenEl.classList.remove('cursor-attack');
        } else if (activeAimKey) {
          // Cast the queued skill
          const worldPos = gameRenderer.screenToWorld(e.clientX, e.clientY);
          if (activeAimKey === 'D' || activeAimKey === 'F') {
            socket.emit('castSpell', { slot: activeAimKey, targetX: Math.round(worldPos.x), targetY: Math.round(worldPos.y) });
            if (activeAimKey === 'D' && window.soundEngine) window.soundEngine.playFlash();
          } else {
            requestChampionSkill(activeAimKey, worldPos);
          }
          activeAimKey = null;
          gameRenderer.clearSkillAim();
        }
      }
    });

    function castWardTrinket() {
      if (!isGameActive || !gameRenderer) return;
      const worldPos = gameRenderer.screenToWorld(mouseScreenPos.x, mouseScreenPos.y);
      socket.emit('placeWard', { x: Math.round(worldPos.x), y: Math.round(worldPos.y) });
    }

    function requestChampionSkill(key, worldPos) {
      const isGaren = localUser.selectedChampId === 'garen';
      const isYasuo = localUser.selectedChampId === 'yasuo';
      let targetId;
      if ((isGaren && key === 'R') || (isYasuo && (key === 'E' || key === 'R'))) {
        const me = latestGameState?.players?.find(p => p.id === localUser.socketId);
        let nearest = 55;
        for (const player of latestGameState?.players || []) {
          if (!player.isAlive || player.team === me?.team || player.stealth ||
              (player.inBush && !player.revealed && !me?.inBush)) continue;
          if (isYasuo && key === 'R' && !(player.airborneRemaining > 0)) continue;
          const distance = Math.hypot(player.x - worldPos.x, player.y - worldPos.y);
          if (distance < nearest) { nearest = distance; targetId = player.id; }
        }
        if (isYasuo && key === 'E') {
          for (const units of [latestGameState?.minions, latestGameState?.jungleMonsters]) {
            for (const unit of units || []) {
              if (!(unit.hp > 0) || unit.team === me?.team) continue;
              const distance = Math.hypot(unit.x - worldPos.x, unit.y - worldPos.y);
              if (distance < nearest) { nearest = distance; targetId = unit.id; }
            }
          }
        }
        if (!targetId) return;
      }
      socket.emit('castSkill', { key, targetId, targetX: Math.round(worldPos.x), targetY: Math.round(worldPos.y) });
      if (!isGaren && !isYasuo) {
        gameRenderer.triggerSkillVfx(localUser.socketId, localUser.selectedChampId, key, worldPos.x, worldPos.y);
        playChampionSkillSound(localUser.selectedChampId, key);
      }
    }

    // Keyboard Shortcuts (Q, W, E, R, D, F, A, S, Y, Space, B, P, 4, Ctrl+Q/W/E/R)
    window.addEventListener('keydown', (e) => {
      if (!isGameActive) return;
      const key = e.key.toUpperCase();

      // Quick Skill Upgrade: Ctrl + Q/W/E/R
      if (e.ctrlKey && ['Q', 'W', 'E', 'R'].includes(key)) {
        e.preventDefault();
        socket.emit('upgradeSkill', { key });
        return;
      }

      if (['Q', 'W', 'E', 'R'].includes(key)) {
        if (e.repeat) return;
        // Quick Cast towards cursor
        const worldPos = gameRenderer.screenToWorld(mouseScreenPos.x, mouseScreenPos.y);
        requestChampionSkill(key, worldPos);
      } else if (['D', 'F'].includes(key)) {
        // Quick Cast Summoner Spells
        const worldPos = gameRenderer.screenToWorld(mouseScreenPos.x, mouseScreenPos.y);
        socket.emit('castSpell', {
          slot: key,
          targetX: Math.round(worldPos.x),
          targetY: Math.round(worldPos.y)
        });
        if (key === 'D' && window.soundEngine) window.soundEngine.playFlash();
      } else if (e.code === 'KeyB') {
        // Recall to Base [B]
        socket.emit('startRecall');
      } else if (e.code === 'KeyP') {
        // Toggle Hextech Shop [P]
        toggleShopModal();
      } else if (e.code === 'Digit4' || e.key === '4') {
        // Vision Ward Trinket [4]
        castWardTrinket();
      } else if (e.code === 'KeyA') {
        // Toggle Attack-Move (A-Key) Mode
        isAttackMoveActive = !isAttackMoveActive;
        if (gameRenderer) gameRenderer.isAttackMoveActive = isAttackMoveActive;
        if (gameScreenEl) {
          if (isAttackMoveActive) gameScreenEl.classList.add('cursor-attack');
          else gameScreenEl.classList.remove('cursor-attack');
        }
      } else if (e.code === 'KeyS') {
        // Stop Command (S-Key)
        socket.emit('playerStop');
        isAttackMoveActive = false;
        if (gameRenderer) gameRenderer.isAttackMoveActive = false;
        if (gameScreenEl) gameScreenEl.classList.remove('cursor-attack');
        const myP = latestGameState?.players?.find(p => p.id === localUser.socketId);
        if (myP) {
          myP.targetX = myP.x;
          myP.targetY = myP.y;
          myP.isMoving = false;
        }
        if (gameRenderer && gameRenderer.gameFeelController) {
          gameRenderer.gameFeelController.stopMoving();
        }
      } else if (e.code === 'KeyY') {
        // Toggle camera lock mode
        if (gameRenderer && gameRenderer.camera) {
          const newMode = gameRenderer.camera.toggleLock();
          updateCameraModeUI(newMode);
        }
      } else if (e.code === 'Space') {
        e.preventDefault();
        // Hold Spacebar to lock onto champion
        if (gameRenderer && gameRenderer.camera) {
          gameRenderer.camera.isSpaceHeld = true;
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        if (gameRenderer && gameRenderer.camera) {
          gameRenderer.camera.isSpaceHeld = false;
        }
      }
    });

    // Sound Toggle Button
    const btnSoundToggle = document.getElementById('btn-sound-toggle');
    if (btnSoundToggle) {
      btnSoundToggle.addEventListener('click', () => {
        if (window.soundEngine) {
          const isMuted = window.soundEngine.toggleMute();
          btnSoundToggle.textContent = isMuted ? '🔇' : '🔊';
        }
      });
    }

    function playChampionSkillSound(champId, key) {
      if (!window.soundEngine || champId === 'garen' || champId === 'yasuo') return;
      if (champId === 'sniper') window.soundEngine.playGunshot(key === 'R');
      else if (champId === 'pyromancer') window.soundEngine.playFireBlast();
      else if (champId === 'demolitionist') window.soundEngine.playExplosion(key === 'R');
      else if (champId === 'frost_mage') window.soundEngine.playIceMagic();
      else if (champId === 'blademaster' || champId === 'brawler') window.soundEngine.playSwordSlash();
      else window.soundEngine.playShieldProc();
    }

    // HUD skill buttons click triggers
    ['Q', 'W', 'E', 'R'].forEach(key => {
      const slot = document.getElementById(`hud-slot-${key.toLowerCase()}`);
      if (slot) {
        slot.addEventListener('click', () => {
          if (localUser.selectedChampId === 'yasuo') {
            activeAimKey = key;
            gameRenderer.setSkillAim({ type: 'circle', range: key === 'R' ? 1400 : 475, radius: key === 'W' ? 150 : 45 });
            return;
          }
          if (localUser.selectedChampId === 'garen' && key === 'R') {
            activeAimKey = 'R';
            gameRenderer.setSkillAim({ type: 'circle', range: 400, radius: 45 });
            return;
          }
          const worldPos = gameRenderer.screenToWorld(mouseScreenPos.x, mouseScreenPos.y);
          requestChampionSkill(key, worldPos);
        });
      }
    });

    // Skill Upgrade buttons [▲] click triggers
    ['Q', 'W', 'E', 'R'].forEach(key => {
      const btnUpgrade = document.getElementById(`btn-upgrade-${key.toLowerCase()}`);
      if (btnUpgrade) {
        btnUpgrade.addEventListener('click', (e) => {
          e.stopPropagation();
          socket.emit('upgradeSkill', { key });
        });
      }
    });

    // Recall [B] button click trigger
    const slotB = document.getElementById('hud-slot-b');
    if (slotB) {
      slotB.addEventListener('click', () => {
        socket.emit('startRecall');
      });
    }

    // Vision Ward trinket [4] click trigger
    const slotTrinket = document.getElementById('hud-trinket-slot');
    if (slotTrinket) {
      slotTrinket.addEventListener('click', () => {
        castWardTrinket();
      });
    }

    // Item Slots click triggers (opens shop)
    for (let i = 0; i < 6; i++) {
      const slotItem = document.getElementById(`hud-item-${i}`);
      if (slotItem) {
        slotItem.addEventListener('click', () => {
          toggleShopModal();
        });
      }
    }

    // Shop Close Button
    const btnCloseShop = document.getElementById('btn-close-shop');
    if (btnCloseShop) {
      btnCloseShop.addEventListener('click', () => {
        toggleShopModal();
      });
    }

    ['D', 'F'].forEach(slotKey => {
      const slot = document.getElementById(`hud-slot-${slotKey.toLowerCase()}`);
      if (slot) {
        slot.addEventListener('click', () => {
          const worldPos = gameRenderer.screenToWorld(mouseScreenPos.x, mouseScreenPos.y);
          socket.emit('castSpell', { slot: slotKey, targetX: Math.round(worldPos.x), targetY: Math.round(worldPos.y) });
          if (slotKey === 'D' && window.soundEngine) window.soundEngine.playFlash();
        });
      }
    });
  }

  const CHAMPION_SKILL_ICONS = {
    blademaster: { P: '⚔️', Q: '💨', W: '🌀', E: '🛡️', R: '⚡' },
    garen: { P: '💚', Q: '⚔️', W: '🛡️', E: '🌀', R: '🗡️' },
    yasuo: { P: '💨', Q: '🌪️', W: '🌊', E: '💨', R: '⚔️' },
    sniper: { P: '👁️', Q: '🎯', W: '🌫️', E: '👟', R: '🔭' },
    pyromancer: { P: '🔥', Q: '☄️', W: '🌋', E: '🛡️', R: '💥' },
    frost_mage: { P: '❄️', Q: '🧊', W: '🌨️', E: '💎', R: '🔮' },
    guardian: { P: '🏰', Q: '🛡️', W: '⚔️', E: '⚜️', R: '🔨' },
    shadow_assassin: { P: '🌑', Q: '🥷', W: '🌫️', E: '💨', R: '🗡️' },
    berserker: { P: '🩸', Q: '🪓', W: '🦁', E: '⛓️', R: '⚡' },
    shadow_hunter: { P: '🏹', Q: '🌪️', W: '📌', E: '🦅', R: '☠️' },
    brawler: { P: '👊', Q: '🥊', W: '💥', E: '🤼', R: '🌋' },
    demolitionist: { P: '🧨', Q: '💣', W: '🚀', E: '⚠️', R: '☢️' }
  };

  function setupInGameHud(champId) {
    const champ = championsData[champId];
    if (!champ) return;

    // Portrait and Champion Name with Glow
    const avatarEl = document.getElementById('hud-avatar-icon');
    if (avatarEl) {
      avatarEl.textContent = champ.avatar;
      avatarEl.style.boxShadow = `0 0 16px ${champ.color || '#00d2d3'}, inset 0 0 8px rgba(0,0,0,0.8)`;
    }
    const nameEl = document.getElementById('hud-hero-name');
    if (nameEl) nameEl.textContent = champ.name;

    // Update Stats Pane (AD, Armor, AS, MS)
    const adEl = document.getElementById('hud-stat-ad');
    if (adEl && champ.stats) adEl.textContent = champ.stats.attackDamage || 68;
    const armorEl = document.getElementById('hud-stat-armor');
    if (armorEl && champ.stats) armorEl.textContent = champ.stats.armor || 34;
    const asEl = document.getElementById('hud-stat-as');
    if (asEl && champ.stats) asEl.textContent = champ.stats.attackSpeed || '0.75';
    const msEl = document.getElementById('hud-stat-ms');
    if (msEl && champ.stats) msEl.textContent = champ.stats.moveSpeed || 310;

    // Generate 100-HP Ticks Overlay
    const hpTicksEl = document.getElementById('hud-hp-ticks');
    if (hpTicksEl && champ.stats?.maxHp) {
      hpTicksEl.innerHTML = '';
      const totalTicks = Math.floor(champ.stats.maxHp / 100);
      for (let t = 1; t < totalTicks; t++) {
        const tick = document.createElement('div');
        tick.className = `hp-tick ${t % 10 === 0 ? 'major' : ''}`;
        tick.style.left = `${(t * 100 / champ.stats.maxHp) * 100}%`;
        hpTicksEl.appendChild(tick);
      }
    }

    const champIcons = CHAMPION_SKILL_ICONS[champId] || { P: 'P', Q: 'Q', W: 'W', E: 'E', R: 'R' };

    const tooltipEl = document.getElementById('hud-skill-tooltip');
    const tipBadge = document.getElementById('tooltip-key-badge');
    const tipName = document.getElementById('tooltip-name');
    const tipCost = document.getElementById('tooltip-cost');
    const tipCd = document.getElementById('tooltip-cooldown');
    const tipDesc = document.getElementById('tooltip-desc');
    const tipExtra = document.getElementById('tooltip-tip');

    function displaySkillTooltip(slotEl, keyBadge, name, cost, cd, desc, tip) {
      if (!tooltipEl) return;
      tipBadge.textContent = keyBadge;
      tipName.textContent = name;
      tipCost.textContent = cost || '소모값 없음';
      tipCd.textContent = cd ? `재사용 대기시간: ${cd}초` : '패시브 지속 효과';
      tipDesc.textContent = desc;
      tipExtra.textContent = tip ? `💡 팁: ${tip}` : '';
      tipExtra.style.display = tip ? 'block' : 'none';

      const rect = slotEl.getBoundingClientRect();
      const hudRect = document.querySelector('.game-hud')?.getBoundingClientRect() || { left: 0 };
      const offsetLeft = rect.left + rect.width / 2 - hudRect.left;
      tooltipEl.style.left = `${offsetLeft}px`;
      tooltipEl.classList.remove('hidden');
    }

    function hideSkillTooltip() {
      if (tooltipEl) tooltipEl.classList.add('hidden');
    }

    // 1. Passive
    const slotP = document.getElementById('hud-slot-p');
    if (slotP) {
      const pIcon = document.getElementById('hud-skill-p-icon');
      if (pIcon) pIcon.textContent = champIcons.P || 'P';
      slotP.addEventListener('mouseenter', () => {
        displaySkillTooltip(slotP, 'P', champ.passive.name, '소모값 없음', null, champ.passive.desc, '전투 중 지속적으로 적용되는 고유 지속 효과입니다.');
      });
      slotP.addEventListener('mouseleave', hideSkillTooltip);
    }

    // 2. QWER Skills
    ['Q', 'W', 'E', 'R'].forEach(k => {
      const sk = champ.skills[k];
      const slot = document.getElementById(`hud-slot-${k.toLowerCase()}`);
      if (sk && slot) {
        const iconEl = document.getElementById(`hud-skill-${k.toLowerCase()}-icon`);
        if (iconEl) iconEl.textContent = champIcons[k] || k;
        const manaEl = document.getElementById(`hud-mana-${k.toLowerCase()}`);
        if (manaEl) manaEl.textContent = sk.mana;
        slot.addEventListener('mouseenter', () => {
          const costStr = sk.mana ? `마나: ${sk.mana}` : '소모값 없음';
          const rank = latestGameState?.players?.find(p => p.id === localUser.socketId)?.skillRanks?.[k] || 1;
          const tipStr = champId === 'yasuo' ? (k === 'R' ? '공중에 뜬 적 챔피언 위에 커서를 두고 R · 6레벨부터 습득' :
            k === 'E' ? '적 유닛 위에 커서를 두고 E · 돌진 중 Q로 원형 공격' : k === 'Q' ? '2회 적중 후 다음 Q는 회오리 · 중첩은 6초 유지' : '커서 방향으로 장막 · 포탑 공격 제외') : champId === 'garen' ? (k === 'R' ? '6레벨부터 습득 · 적 챔피언 위에 커서를 두고 R' :
            k === 'E' ? '이동 중 사용 가능 · 1초 후 E 재입력으로 종료' : k === 'Q' ? '다음 기본 공격을 강화합니다.' : '이동·회전 중에도 사용할 수 있습니다.') :
            `사거리: ${sk.range || sk.radius || 300}px | 피해 계수: ${(sk.damageRatio || 1.0) * 100}% AD/AP`;
          displaySkillTooltip(slot, k, sk.name, costStr, sk.cooldowns?.[rank - 1] ?? sk.cooldown, sk.desc, tipStr);
        });
        slot.addEventListener('mouseleave', hideSkillTooltip);
      }
    });

    // 3. Spells (D, F)
    const dSpell = spellsData[localUser.spellD];
    const fSpell = spellsData[localUser.spellF];
    const slotD = document.getElementById('hud-slot-d');
    const slotF = document.getElementById('hud-slot-f');

    if (dSpell && slotD) {
      document.getElementById('hud-spell-d-icon').textContent = dSpell.icon || '⚡';
      slotD.addEventListener('mouseenter', () => {
        displaySkillTooltip(slotD, 'D', dSpell.name, '소모값 없음', dSpell.cooldown, dSpell.desc, `순간이동 사거리: ${dSpell.range || 380}px`);
      });
      slotD.addEventListener('mouseleave', hideSkillTooltip);
    }

    if (fSpell && slotF) {
      document.getElementById('hud-spell-f-icon').textContent = fSpell.icon || '🔥';
      slotF.addEventListener('mouseenter', () => {
        displaySkillTooltip(slotF, 'F', fSpell.name, '소모값 없음', fSpell.cooldown, fSpell.desc, fSpell.id === 'ignite' ? '치유량 50% 감소' : '이동 속도 30% 증가');
      });
      slotF.addEventListener('mouseleave', hideSkillTooltip);
    }
  }

  const hudDomCache = {};
  function setHudText(id, text) {
    if (hudDomCache[id] !== text) {
      hudDomCache[id] = text;
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    }
  }
  function setHudWidth(id, width) {
    if (hudDomCache[id] !== width) {
      hudDomCache[id] = width;
      const el = document.getElementById(id);
      if (el) el.style.width = width;
    }
  }

  let isShopOpen = false;
  function toggleShopModal() {
    isShopOpen = !isShopOpen;
    const modal = document.getElementById('shop-modal');
    if (!modal) return;
    if (isShopOpen) {
      modal.classList.remove('hidden');
      updateShopUI();
    } else {
      modal.classList.add('hidden');
    }
  }

  function updateShopUI() {
    const modal = document.getElementById('shop-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    const me = latestGameState?.players?.find(p => p.id === localUser.socketId);
    if (!me) return;

    // Gold display
    const shopGoldEl = document.getElementById('shop-player-gold');
    if (shopGoldEl) shopGoldEl.textContent = me.gold || 0;

    // Catalog items
    const shopListEl = document.getElementById('shop-items-list');
    if (shopListEl && Object.keys(itemsData).length > 0) {
      shopListEl.innerHTML = '';
      Object.values(itemsData).forEach(item => {
        const canAfford = (me.gold || 0) >= item.cost;
        const itemCard = document.createElement('div');
        itemCard.className = `shop-item-card ${canAfford ? '' : 'cannot-afford'}`;
        itemCard.innerHTML = `
          <div class="shop-item-icon">${item.icon || '📦'}</div>
          <div class="shop-item-info">
            <div class="shop-item-name">${item.name}</div>
            <div class="shop-item-cost">${item.cost} 💰</div>
            <div class="shop-item-desc">${item.desc}</div>
          </div>
          <button class="btn-shop-buy" ${canAfford ? '' : 'disabled'}>구매</button>
        `;
        const buyBtn = itemCard.querySelector('.btn-shop-buy');
        buyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          socket.emit('buyItem', { itemId: item.id });
        });
        shopListEl.appendChild(itemCard);
      });
    }

    // Current player inventory in shop
    const invListEl = document.getElementById('shop-inventory-list');
    if (invListEl) {
      invListEl.innerHTML = '';
      const items = me.items || [];
      for (let i = 0; i < 6; i++) {
        const itemId = items[i];
        const item = itemId ? itemsData[itemId] : null;
        const slotEl = document.createElement('div');
        slotEl.className = 'shop-inv-slot';
        if (item) {
          const sellPrice = Math.floor(item.cost * 0.7);
          slotEl.innerHTML = `
            <div class="shop-item-icon">${item.icon}</div>
            <div class="shop-item-info">
              <div class="shop-item-name">${item.name}</div>
              <div class="shop-item-cost">판매가: ${sellPrice} 💰</div>
            </div>
            <button class="btn-shop-sell">판매</button>
          `;
          const sellBtn = slotEl.querySelector('.btn-shop-sell');
          sellBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            socket.emit('sellItem', { slotIndex: i });
          });
          slotEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            socket.emit('sellItem', { slotIndex: i });
          });
        } else {
          slotEl.innerHTML = `<span style="color:#576574; font-size:0.85rem;">빈 슬롯 (${i + 1})</span>`;
        }
        invListEl.appendChild(slotEl);
      }
    }
  }

  function updateInGameHUD(state) {
    // 1. Scoreboard & Timer
    const blueScore = state.scores ? state.scores.blue : 0;
    const redScore = state.scores ? state.scores.red : 0;
    setHudText('score-blue-num', blueScore);
    setHudText('score-red-num', redScore);

    const totalSec = state.gameTime || 0;
    const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
    const s = Math.floor(totalSec % 60).toString().padStart(2, '0');
    setHudText('game-timer-display', `${m}:${s}`);

    // 2. Local Player Vitals & KDA & Level Progression
    const me = state.players ? state.players.find(p => p.id === localUser.socketId) : null;
    if (me) {
      setHudText('kda-display', `${me.kills} / ${me.deaths} / ${me.assists}`);
      setHudText('cs-display', `${me.cs || 0}`);
      setHudText('gold-display', `${me.gold || 500} 💰`);

      // Level Badge
      setHudText('hud-level-badge', me.level || 1);

      // Dynamic Stats Pane (AD, Armor, AS, MS)
      if (me.ad !== undefined) setHudText('hud-stat-ad', me.ad);
      if (me.armor !== undefined) setHudText('hud-stat-armor', me.armor);
      if (me.as !== undefined) setHudText('hud-stat-as', me.as);
      if (me.moveSpeed !== undefined) setHudText('hud-stat-ms', me.moveSpeed);

      // HP & MP Fill
      const hpPct = Math.max(0, Math.min(100, (me.hp / me.maxHp) * 100)).toFixed(1);
      const mpPct = me.yasuo ? Math.min(100, me.yasuo.flow).toFixed(1) : me.maxMp > 0 ? Math.max(0, Math.min(100, (me.mp / me.maxMp) * 100)).toFixed(1) : '0';
      const shieldPct = Math.max(0, Math.min(100, ((me.shield || 0) / me.maxHp) * 100)).toFixed(1);

      setHudWidth('hud-hp-fill', `${hpPct}%`);
      setHudWidth('hud-shield-fill', `${shieldPct}%`);
      setHudText('hud-hp-text', `${me.hp} / ${me.maxHp} ${me.shield ? `(+${me.shield})` : ''}`);

      setHudWidth('hud-mp-fill', `${mpPct}%`);
      setHudText('hud-mp-text', me.yasuo ? `기류 ${Math.floor(me.yasuo.flow)} / 100 · Q ${me.yasuo.qStacks}/2${me.yasuo.qStacks === 2 ? ' 회오리 준비' : ''}` : me.maxMp > 0 ? `${me.mp} / ${me.maxMp}` : '자원 소모 없음');

      // Skill Upgrade Buttons [▲]
      ['Q', 'W', 'E', 'R'].forEach(k => {
        const btn = document.getElementById(`btn-upgrade-${k.toLowerCase()}`);
        if (btn) {
          let canUpgrade = false;
          if (me.skillPoints > 0) {
            const curRank = me.skillRanks ? (me.skillRanks[k] || 0) : 0;
            if (k === 'R') {
              if (curRank === 0 && me.level >= 6) canUpgrade = true;
              else if (curRank === 1 && me.level >= 11) canUpgrade = true;
              else if (curRank === 2 && me.level >= 16) canUpgrade = true;
            } else {
              if (curRank < 5 && ((!['garen', 'yasuo'].includes(localUser.selectedChampId)) || me.level >= curRank * 2 + 1)) canUpgrade = true;
            }
          }
          if (canUpgrade) {
            btn.classList.remove('hidden');
          } else {
            btn.classList.add('hidden');
          }
        }
      });

      // Skill Rank Indicator Pips
      ['Q', 'W', 'E', 'R'].forEach(k => {
        const pipsContainer = document.getElementById(`hud-pips-${k.toLowerCase()}`);
        if (pipsContainer && me.skillRanks) {
          const curRank = me.skillRanks[k] || 0;
          const pips = pipsContainer.querySelectorAll('.pip');
          pips.forEach((pip, idx) => {
            if (idx < curRank) {
              pip.classList.add('active');
            } else {
              pip.classList.remove('active');
            }
          });
        }
      });

      // Channeling Cast Bar (Recall, etc.)
      const castBar = document.getElementById('hud-cast-bar');
      if (castBar) {
        if (me.recalling) {
          castBar.classList.remove('hidden');
          const prog = Math.min(100, Math.max(0, (me.recallProgress || 0) * 100));
          const castFill = document.getElementById('hud-cast-fill');
          if (castFill) castFill.style.width = `${prog.toFixed(1)}%`;
          const remSec = (8.0 * (1 - (me.recallProgress || 0))).toFixed(1);
          const castLabel = document.getElementById('hud-cast-label');
          if (castLabel) castLabel.textContent = `귀환 중... ${remSec}s`;
        } else {
          castBar.classList.add('hidden');
        }
      }

      // 6 Inventory Item Slots
      const items = me.items || [];
      for (let i = 0; i < 6; i++) {
        const slotEl = document.getElementById(`hud-item-${i}`);
        if (slotEl) {
          const itemId = items[i];
          const item = itemId ? itemsData[itemId] : null;
          const num = i < 3 ? i + 1 : i + 2;
          if (item) {
            slotEl.innerHTML = `<span class="item-icon">${item.icon}</span><span class="slot-num">${num}</span>`;
            slotEl.title = `${item.name}\n${item.desc}`;
          } else {
            slotEl.innerHTML = `<span class="slot-num">${num}</span>`;
            slotEl.title = `아이템 ${num} [P 키로 상점]`;
          }
        }
      }

      // Ward Trinket Slot Cooldown
      const wardCd = me.wardCooldown || 0;
      const wardOverlay = document.getElementById('hud-ward-overlay');
      const wardText = document.getElementById('hud-ward-text');
      if (wardOverlay && wardText) {
        if (wardCd > 0) {
          wardOverlay.classList.remove('hidden');
          wardText.textContent = wardCd;
        } else {
          wardOverlay.classList.add('hidden');
        }
      }

      // Update Shop UI if active
      if (isShopOpen) {
        updateShopUI();
      }

      // Cooldowns
      ['Q', 'W', 'E', 'R', 'D', 'F'].forEach(k => {
        const cd = me.cooldowns ? me.cooldowns[k] : 0;
        const overlayId = `hud-cd-overlay-${k.toLowerCase()}`;
        const cdTextId = `hud-cd-text-${k.toLowerCase()}`;
        const cdFormatted = cd > 0 ? (cd > 1 ? Math.ceil(cd) : cd.toFixed(1)) : '';

        if (cd > 0) {
          if (hudDomCache[overlayId] !== true) {
            hudDomCache[overlayId] = true;
            const overlay = document.getElementById(overlayId);
            if (overlay) overlay.classList.remove('hidden');
          }
          setHudText(cdTextId, cdFormatted);
        } else {
          if (hudDomCache[overlayId] !== false) {
            hudDomCache[overlayId] = false;
            const overlay = document.getElementById(overlayId);
            if (overlay) overlay.classList.add('hidden');
          }
        }
      });

      // Respawn Overlay
      const respawnOverlayId = 'respawn-overlay';
      if (!me.isAlive) {
        if (hudDomCache[respawnOverlayId] !== true) {
          hudDomCache[respawnOverlayId] = true;
          const respawnOverlay = document.getElementById(respawnOverlayId);
          if (respawnOverlay) respawnOverlay.classList.remove('hidden');
        }
        setHudText('respawn-timer-sec', me.respawnTimer);
      } else {
        if (hudDomCache[respawnOverlayId] !== false) {
          hudDomCache[respawnOverlayId] = false;
          const respawnOverlay = document.getElementById(respawnOverlayId);
          if (respawnOverlay) respawnOverlay.classList.add('hidden');
        }
      }
    }

    // Kill events & LoL announcer events
    if (state.events) {
      state.events.forEach(ev => {
        if (ev.type === 'kill') {
          showKillBanner(ev);
        } else if (['first_blood', 'multikill', 'ace', 'dragon_slain', 'turret_destroyed'].includes(ev.type)) {
          showAnnouncerBanner(ev);
        }
      });
    }
  }

  // Multi-kill streak tracker
  const killStreakTracker = {};

  function showKillBanner(ev) {
    const bannerContainer = document.getElementById('kill-banner-container');
    const div = document.createElement('div');

    const now = Date.now();
    const pid = ev.killerId || ev.killerName;
    if (!killStreakTracker[pid] || now - killStreakTracker[pid].lastTime > 14000) {
      killStreakTracker[pid] = { count: 1, lastTime: now };
    } else {
      killStreakTracker[pid].count++;
      killStreakTracker[pid].lastTime = now;
    }

    const count = killStreakTracker[pid].count;
    let badgeTitle = 'CHAMPION SLAIN!';
    let isPenta = false;

    if (count === 2) badgeTitle = '⚔️ DOUBLE KILL! (더블 킬)';
    else if (count === 3) badgeTitle = '⚔️ TRIPLE KILL! (트리플 킬)';
    else if (count === 4) badgeTitle = '👑 QUADRA KILL! (쿼드라 킬)';
    else if (count >= 5) {
      badgeTitle = '🔥 PENTAKILL! (펜타킬) 🔥';
      isPenta = true;
    }

    div.className = `kill-banner-item ${isPenta ? 'pentakill' : ''}`;
    div.innerHTML = `
      <div style="font-size: 1.5rem;">👑</div>
      <div>
        <div style="font-size: 0.85rem; color: #f1c40f; letter-spacing: 1px;">${badgeTitle}</div>
        <div style="font-size: 1.05rem; color: #fff;"><b>${escapeHtml(ev.killerName)}</b> 님이 <b>${escapeHtml(ev.victimName)}</b> 님을 처치!</div>
      </div>
    `;
    bannerContainer.appendChild(div);
    setTimeout(() => { div.remove(); }, 3800);
  }

  // Authentic LoL Announcer Banner System
  const seenAnnouncerEvents = new Set();
  function showAnnouncerBanner(ev) {
    const key = `${ev.type}_${ev.killerName || ''}_${ev.victimName || ''}_${ev.team || ''}_${ev.killerTeam || ''}_${Math.floor(Date.now() / 2500)}`;
    if (seenAnnouncerEvents.has(key)) return;
    seenAnnouncerEvents.add(key);

    const overlay = document.getElementById('announcer-overlay');
    if (!overlay) return;

    let title = '';
    let subtitle = '';
    let bannerType = 'gold-banner';

    if (ev.type === 'first_blood') {
      title = 'FIRST BLOOD';
      subtitle = `${escapeHtml(ev.killerName)} 님이 첫 번째 처치를 달성했습니다! (+100G 보너스)`;
      bannerType = 'red-banner';
      if (window.soundEngine) window.soundEngine.playCrit();
    } else if (ev.type === 'multikill') {
      if (ev.count === 2) {
        title = 'DOUBLE KILL!';
        subtitle = `${escapeHtml(ev.killerName)} 님의 더블 킬!`;
      } else if (ev.count === 3) {
        title = 'TRIPLE KILL!';
        subtitle = `${escapeHtml(ev.killerName)} 님의 트리플 킬!`;
      } else if (ev.count === 4) {
        title = 'QUADRA KILL!';
        subtitle = `${escapeHtml(ev.killerName)} 님의 쿼드라 킬!`;
      } else {
        title = '🔥 PENTAKILL! 🔥';
        subtitle = `${escapeHtml(ev.killerName)} 님의 전설적인 펜타킬!!`;
      }
      bannerType = ev.count >= 4 ? 'red-banner' : 'gold-banner';
      if (window.soundEngine) window.soundEngine.playCrit();
    } else if (ev.type === 'ace') {
      title = 'ACE (에이스)';
      subtitle = `${ev.team === 'blue' ? '블루 팀' : '레드 팀'}이 전멸했습니다!`;
      bannerType = ev.team === localUser.team ? 'red-banner' : 'blue-banner';
    } else if (ev.type === 'dragon_slain') {
      title = 'ELEMENTAL DRAGON SLAIN';
      subtitle = `${ev.killerTeam === 'blue' ? '블루 팀' : '레드 팀'}이 원소 드래곤을 처치하여 영구 버프를 획득했습니다! (+12% 공격력/주문력)`;
      bannerType = ev.killerTeam === 'blue' ? 'blue-banner' : 'red-banner';
    } else if (ev.type === 'turret_destroyed') {
      title = 'TURRET DESTROYED';
      subtitle = `${ev.team === 'blue' ? '블루 팀' : '레드 팀'}의 포탑이 파괴되었습니다!`;
      bannerType = ev.team === localUser.team ? 'red-banner' : 'blue-banner';
    } else {
      return;
    }

    const banner = document.createElement('div');
    banner.className = `announcer-banner ${bannerType}`;
    banner.innerHTML = `
      <div class="banner-title">${title}</div>
      <div class="banner-sub">${subtitle}</div>
    `;
    overlay.appendChild(banner);
    setTimeout(() => {
      banner.remove();
    }, 4200);
  }

  // Battle Ended
  socket.on('battleEnded', (data) => {
    isGameActive = false;
    gameRenderer?.garenAudio.update([]);
    gameRenderer?.garenEffects.update([], gameRenderer.threePlayerMeshes, 0);
    gameRenderer?.yasuoAudio.update([], []);
    gameRenderer?.yasuoEffects.update([], gameRenderer.threePlayerMeshes, 0, [], []);
    const modal = document.getElementById('gameover-modal');
    const title = document.getElementById('gameover-banner-text');
    const desc = document.getElementById('gameover-desc-text');
    const finalBlue = document.getElementById('final-blue-score');
    const finalRed = document.getElementById('final-red-score');

    const isWinner = localUser.team === data.winningTeam;
    title.textContent = isWinner ? 'VICTORY' : 'DEFEAT';
    title.className = `gameover-title ${isWinner ? 'victory' : 'defeat'}`;
    desc.textContent = data.message;

    if (data.scores) {
      finalBlue.textContent = data.scores.blue;
      finalRed.textContent = data.scores.red;
    }

    modal.classList.remove('hidden');
  });

  document.getElementById('btn-return-lobby').addEventListener('click', () => {
    document.getElementById('gameover-modal').classList.add('hidden');
    socket.emit('returnToLobby');
    switchScreen('lobby');
    exitRoomView();
  });

  // Helper
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

})();
