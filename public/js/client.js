/**
 * client.js
 * MOBA LAN Client
 * Manages socket connection, screen flows (Login -> Lobby -> Draft -> Arena),
 * user inputs, skill casts, and real-time state synchronization.
 */

(function () {
  'use strict';

  // Global Socket & State
  const socket = io();

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
  let gameRenderer = null;
  let latestGameState = null;
  let isGameActive = false;
  let mouseScreenPos = { x: 0, y: 0 };
  let mouseWorldPos = { x: 0, y: 0 };

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
      card.innerHTML = `
        <div class="champ-card-icon">${champ.avatar}</div>
        <div class="champ-card-name">${champ.name}</div>
        <div class="champ-card-role">${champ.role.split(' ')[0]}</div>
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

  function start60FpsGameLoop() {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);

    // Periodic Ping Check (every 1.5s)
    if (pingIntervalHandle) clearInterval(pingIntervalHandle);
    pingIntervalHandle = setInterval(() => {
      if (!isGameActive) return;
      const start = performance.now();
      socket.emit('pingCheck', start, () => {
        const pingMs = Math.max(1, Math.round(performance.now() - start));
        const pingEl = document.getElementById('ping-display');
        if (pingEl) pingEl.textContent = `${pingMs}ms`;
      });
    }, 1500);

    function frame(now) {
      if (isGameActive && gameRenderer && latestGameState) {
        // Calculate real FPS
        fpsFrames++;
        if (now - fpsLastCalc >= 500) {
          currentFps = Math.round((fpsFrames * 1000) / (now - fpsLastCalc));
          fpsFrames = 0;
          fpsLastCalc = now;
          const fpsEl = document.getElementById('fps-display');
          if (fpsEl) fpsEl.textContent = `${currentFps} FPS`;
        }

        // Screen to world mouse position
        mouseWorldPos = gameRenderer.screenToWorld(mouseScreenPos.x, mouseScreenPos.y);

        // Render at 60+ FPS with camera update
        gameRenderer.render(latestGameState, mouseScreenPos);
      }
      animationFrameId = requestAnimationFrame(frame);
    }
    animationFrameId = requestAnimationFrame(frame);
  }

  socket.on('battleStarted', (data) => {
    isGameActive = true;
    draftCountdownOverlay.classList.add('hidden');
    switchScreen('game');

    // Initialize Renderer with LoL CameraController
    if (!gameRenderer) {
      const cameraController = new CameraController({
        mapWidth: data.mapData ? data.mapData.width : 2400,
        mapHeight: data.mapData ? data.mapData.height : 1600
      });
      gameRenderer = new GameRenderer('game-canvas-container', cameraController);
    } else {
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
    latestGameState = state;
    if (!isGameActive || !gameRenderer) return;

    // Process events for VFX
    gameRenderer.processEvents(state.events);

    // Update HUD
    updateInGameHUD(state);
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
        if (e.button === 0) {
          isMinimapNavigating = true;
          handleMinimapPan(e);
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

    // Track mouse position & Enemy Hover Attack Cursor
    window.addEventListener('mousemove', (e) => {
      mouseScreenPos.x = e.clientX;
      mouseScreenPos.y = e.clientY;

      if (isGameActive && gameRenderer && latestGameState) {
        const worldPos = gameRenderer.screenToWorld(e.clientX, e.clientY);
        const myPlayer = latestGameState.players.find(p => p.id === localUser.socketId);
        let isEnemyHovered = false;

        if (myPlayer) {
          for (const ep of latestGameState.players) {
            if (ep.isAlive && ep.team !== myPlayer.team) {
              if (Math.hypot(ep.x - worldPos.x, ep.y - worldPos.y) <= ep.radius + 15) {
                isEnemyHovered = true;
                break;
              }
            }
          }
          if (!isEnemyHovered) {
            for (const s of latestGameState.structures) {
              if (s.isAlive && s.team !== myPlayer.team) {
                if (Math.hypot(s.x - worldPos.x, s.y - worldPos.y) <= 55) {
                  isEnemyHovered = true;
                  break;
                }
              }
            }
          }
        }

        if (gameScreenEl) {
          if (isEnemyHovered) gameScreenEl.classList.add('cursor-attack');
          else gameScreenEl.classList.remove('cursor-attack');
        }
      }
    });

    // Disable default right-click context menu
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    // Right Click: Move or Target Enemy
    window.addEventListener('mousedown', (e) => {
      if (!isGameActive || !latestGameState) return;

      if (e.button === 2) { // Right Click
        e.preventDefault();
        const worldPos = gameRenderer.screenToWorld(e.clientX, e.clientY);

        // Check if right-clicked on an enemy champion or structure
        let clickedTarget = null;
        const myPlayer = latestGameState.players.find(p => p.id === localUser.socketId);
        if (myPlayer) {
          // Check enemy players
          for (const ep of latestGameState.players) {
            if (ep.isAlive && ep.team !== myPlayer.team) {
              const d = Math.hypot(ep.x - worldPos.x, ep.y - worldPos.y);
              if (d <= ep.radius + 15) {
                clickedTarget = ep.id;
                break;
              }
            }
          }
          // Check enemy structures
          if (!clickedTarget) {
            for (const s of latestGameState.structures) {
              if (s.isAlive && s.team !== myPlayer.team) {
                const d = Math.hypot(s.x - worldPos.x, s.y - worldPos.y);
                if (d <= 55) {
                  clickedTarget = s.id;
                  break;
                }
              }
            }
          }
        }

        if (clickedTarget) {
          socket.emit('playerTarget', { targetId: clickedTarget });
        } else {
          // Move command
          socket.emit('playerMove', { x: Math.round(worldPos.x), y: Math.round(worldPos.y) });
          gameRenderer.addClickRing(worldPos.x, worldPos.y);
          if (window.soundEngine) window.soundEngine.playMovePing();
        }
      } else if (e.button === 0) { // Left Click
        if (activeAimKey) {
          // Cast the queued skill
          const worldPos = gameRenderer.screenToWorld(e.clientX, e.clientY);
          if (activeAimKey === 'D' || activeAimKey === 'F') {
            socket.emit('castSpell', { slot: activeAimKey, targetX: Math.round(worldPos.x), targetY: Math.round(worldPos.y) });
            if (activeAimKey === 'D' && window.soundEngine) window.soundEngine.playFlash();
          } else {
            socket.emit('castSkill', { key: activeAimKey, targetX: Math.round(worldPos.x), targetY: Math.round(worldPos.y) });
            playChampionSkillSound(localUser.selectedChampId, activeAimKey);
          }
          activeAimKey = null;
          gameRenderer.clearSkillAim();
        }
      }
    });

    // Keyboard Shortcuts (Q, W, E, R, D, F, Y, Space)
    window.addEventListener('keydown', (e) => {
      if (!isGameActive) return;
      const key = e.key.toUpperCase();

      if (['Q', 'W', 'E', 'R'].includes(key)) {
        // Quick Cast towards cursor
        const worldPos = gameRenderer.screenToWorld(mouseScreenPos.x, mouseScreenPos.y);
        socket.emit('castSkill', {
          key: key,
          targetX: Math.round(worldPos.x),
          targetY: Math.round(worldPos.y)
        });
        if (gameRenderer) {
          gameRenderer.triggerSkillVfx(localUser.socketId, localUser.selectedChampId, key, worldPos.x, worldPos.y);
        }
        playChampionSkillSound(localUser.selectedChampId, key);
      } else if (['D', 'F'].includes(key)) {
        // Quick Cast Summoner Spells
        const worldPos = gameRenderer.screenToWorld(mouseScreenPos.x, mouseScreenPos.y);
        socket.emit('castSpell', {
          slot: key,
          targetX: Math.round(worldPos.x),
          targetY: Math.round(worldPos.y)
        });
        if (key === 'D' && window.soundEngine) window.soundEngine.playFlash();
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
      if (!window.soundEngine) return;
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
          const worldPos = gameRenderer.screenToWorld(mouseScreenPos.x, mouseScreenPos.y);
          socket.emit('castSkill', { key, targetX: Math.round(worldPos.x), targetY: Math.round(worldPos.y) });
          if (gameRenderer) {
            gameRenderer.triggerSkillVfx(localUser.socketId, localUser.selectedChampId, key, worldPos.x, worldPos.y);
          }
          playChampionSkillSound(localUser.selectedChampId, key);
        });
      }
    });

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

  function setupInGameHud(champId) {
    const champ = championsData[champId];
    if (!champ) return;

    document.getElementById('hud-avatar-icon').textContent = champ.avatar;
    document.getElementById('hud-hero-name').textContent = champ.name;

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
      document.getElementById('hud-skill-p-icon').textContent = 'P';
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
        document.getElementById(`hud-skill-${k.toLowerCase()}-icon`).textContent = k;
        document.getElementById(`hud-mana-${k.toLowerCase()}`).textContent = sk.mana;
        slot.addEventListener('mouseenter', () => {
          const costStr = sk.mana ? `마나: ${sk.mana}` : '소모값 없음';
          const tipStr = `사거리: ${sk.range || sk.radius || 300}px | 피해 계수: ${(sk.damageRatio || 1.0) * 100}% AD/AP`;
          displaySkillTooltip(slot, k, sk.name, costStr, sk.cooldown, sk.desc, tipStr);
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

  function updateInGameHUD(state) {
    // 1. Scoreboard & Timer
    document.getElementById('score-blue-num').textContent = state.scores ? state.scores.blue : 0;
    document.getElementById('score-red-num').textContent = state.scores ? state.scores.red : 0;

    const totalSec = state.gameTime || 0;
    const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
    const s = Math.floor(totalSec % 60).toString().padStart(2, '0');
    document.getElementById('game-timer-display').textContent = `${m}:${s}`;

    // 2. Local Player Vitals & KDA
    const me = state.players.find(p => p.id === localUser.socketId);
    if (me) {
      document.getElementById('kda-display').textContent = `${me.kills} / ${me.deaths} / ${me.assists}`;

      // HP & MP Fill
      const hpPct = Math.max(0, Math.min(100, (me.hp / me.maxHp) * 100));
      const mpPct = Math.max(0, Math.min(100, (me.mp / me.maxMp) * 100));
      const shieldPct = Math.max(0, Math.min(100, ((me.shield || 0) / me.maxHp) * 100));

      document.getElementById('hud-hp-fill').style.width = `${hpPct}%`;
      document.getElementById('hud-shield-fill').style.width = `${shieldPct}%`;
      document.getElementById('hud-hp-text').textContent = `${me.hp} / ${me.maxHp} ${me.shield ? `(+${me.shield})` : ''}`;

      document.getElementById('hud-mp-fill').style.width = `${mpPct}%`;
      document.getElementById('hud-mp-text').textContent = `${me.mp} / ${me.maxMp}`;

      // Cooldowns
      ['Q', 'W', 'E', 'R', 'D', 'F'].forEach(k => {
        const cd = me.cooldowns ? me.cooldowns[k] : 0;
        const overlay = document.getElementById(`hud-cd-overlay-${k.toLowerCase()}`);
        const cdText = document.getElementById(`hud-cd-text-${k.toLowerCase()}`);
        if (overlay && cdText) {
          if (cd > 0) {
            overlay.classList.remove('hidden');
            cdText.textContent = cd > 1 ? Math.ceil(cd) : cd.toFixed(1);
          } else {
            overlay.classList.add('hidden');
          }
        }
      });

      // Respawn Overlay
      const respawnOverlay = document.getElementById('respawn-overlay');
      if (!me.isAlive) {
        respawnOverlay.classList.remove('hidden');
        document.getElementById('respawn-timer-sec').textContent = me.respawnTimer;
      } else {
        respawnOverlay.classList.add('hidden');
      }
    }

    // Kill events banner
    if (state.events) {
      state.events.forEach(ev => {
        if (ev.type === 'kill') {
          showKillBanner(ev);
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

  // Battle Ended
  socket.on('battleEnded', (data) => {
    isGameActive = false;
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
