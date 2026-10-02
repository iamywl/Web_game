/**
 * Room.js
 * Handles game room state, teams, draft pick exclusivity, and lifecycle.
 */

const { CHAMPIONS, SUMMONER_SPELLS } = require('./ChampionData');
const GameEngine = require('./GameEngine');

class Room {
  constructor(id, name, mode, hostPlayer, io) {
    this.id = id;
    this.name = name;
    this.mode = mode || '1v1'; // '1v1', '2v2', 'custom'
    this.maxPlayers = this.getMaxPlayersForMode(this.mode);
    this.hostId = hostPlayer.socketId;
    this.io = io;
    this.state = 'LOBBY'; // 'LOBBY', 'DRAFT', 'PLAYING', 'GAMEOVER'

    this.players = {}; // socketId -> player object
    this.gameEngine = null;
    this.countdownTimer = null;
    this.countdownSeconds = 3;

    // Add host player
    this.addPlayer(hostPlayer.socketId, hostPlayer.nickname);
  }

  getMaxPlayersForMode(mode) {
    switch (mode) {
      case '1v1': return 2;
      case '2v2': return 4;
      case 'custom': return 10;
      default: return 2;
    }
  }

  addPlayer(socketId, nickname) {
    const currentCount = Object.keys(this.players).length;
    if (currentCount >= this.maxPlayers) {
      return { success: false, error: '방이 가득 찼습니다.' };
    }
    if (this.state !== 'LOBBY') {
      return { success: false, error: '이미 게임이 진행 중인 방입니다.' };
    }

    // Auto-balance team: blue first, then red
    const blueCount = Object.values(this.players).filter(p => p.team === 'blue').length;
    const redCount = Object.values(this.players).filter(p => p.team === 'red').length;
    const team = blueCount <= redCount ? 'blue' : 'red';

    this.players[socketId] = {
      socketId,
      nickname,
      team,
      isReady: socketId === this.hostId, // Host is ready by default
      tentativeChampId: null,
      championId: null,
      isLocked: false,
      spellD: 'flash',
      spellF: 'ignite'
    };

    return { success: true };
  }

  removePlayer(socketId) {
    delete this.players[socketId];

    if (this.gameEngine) {
      this.gameEngine.removePlayer(socketId);
    }

    // If room is empty
    const remainingCount = Object.keys(this.players).length;
    if (remainingCount === 0) {
      this.cleanup();
      return { empty: true };
    }

    // If host left, assign new host
    if (this.hostId === socketId) {
      const remainingIds = Object.keys(this.players);
      this.hostId = remainingIds[0];
      if (this.hostId && this.players[this.hostId]) {
        this.players[this.hostId].isReady = true;
      }
    }

    // If in draft or playing and not enough players
    if (this.state === 'DRAFT') {
      this.cancelDraft('플레이어가 퇴장하여 대기실로 돌아갑니다.');
    } else if (this.state === 'PLAYING') {
      // Check if one team has no players left
      const blues = Object.values(this.players).filter(p => p.team === 'blue');
      const reds = Object.values(this.players).filter(p => p.team === 'red');
      if (blues.length === 0 && reds.length > 0) {
        this.endGame('red', '블루 팀 기권 승리');
      } else if (reds.length === 0 && blues.length > 0) {
        this.endGame('blue', '레드 팀 기권 승리');
      }
    }

    this.broadcastState();
    return { empty: false };
  }

  switchTeam(socketId, targetTeam) {
    if (this.state !== 'LOBBY') return { success: false, error: '대기실에서만 팀을 변경할 수 있습니다.' };
    const player = this.players[socketId];
    if (!player) return { success: false, error: '플레이어를 찾을 수 없습니다.' };
    if (player.team === targetTeam) return { success: true };

    const half = Math.ceil(this.maxPlayers / 2);
    const targetTeamCount = Object.values(this.players).filter(p => p.team === targetTeam).length;
    if (targetTeamCount >= half) {
      return { success: false, error: `${targetTeam === 'blue' ? '블루' : '레드'} 팀 정원이 찼습니다.` };
    }

    player.team = targetTeam;
    this.broadcastState();
    return { success: true };
  }

  toggleReady(socketId) {
    if (this.state !== 'LOBBY') return { success: false };
    const player = this.players[socketId];
    if (!player) return { success: false };

    // Host cannot toggle ready (host starts game)
    if (socketId !== this.hostId) {
      player.isReady = !player.isReady;
    }
    this.broadcastState();
    return { success: true };
  }

  startDraft(socketId) {
    if (this.state !== 'LOBBY') return { success: false, error: '대기실 상태가 아닙니다.' };
    if (this.hostId !== socketId) return { success: false, error: '방장만 밴픽을 시작할 수 있습니다.' };

    const playerList = Object.values(this.players);
    if (playerList.length < 2 && this.mode !== '1v1') {
      return { success: false, error: '최소 2명 이상의 플레이어가 필요합니다.' };
    }

    // Check team balance: at least 1 blue and 1 red
    const blueCount = playerList.filter(p => p.team === 'blue').length;
    const redCount = playerList.filter(p => p.team === 'red').length;
    if (blueCount === 0 || redCount === 0) {
      return { success: false, error: '양 팀에 각각 최소 1명 이상의 플레이어가 있어야 합니다.' };
    }

    // Check if non-host players are ready
    const unready = playerList.find(p => p.socketId !== this.hostId && !p.isReady);
    if (unready) {
      return { success: false, error: `${unready.nickname}님이 아직 준비 완료하지 않았습니다.` };
    }

    // Enter draft
    this.state = 'DRAFT';
    playerList.forEach(p => {
      p.tentativeChampId = null;
      p.championId = null;
      p.isLocked = false;
    });

    this.broadcastState();
    this.io.to(this.id).emit('draftStarted', {
      roomId: this.id,
      champions: CHAMPIONS,
      spells: SUMMONER_SPELLS
    });

    return { success: true };
  }

  cancelDraft(reason) {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.state = 'LOBBY';
    Object.values(this.players).forEach(p => {
      p.isLocked = false;
      p.championId = null;
      p.tentativeChampId = null;
      if (p.socketId !== this.hostId) p.isReady = false;
    });
    this.broadcastState();
    this.io.to(this.id).emit('draftCancelled', { reason });
  }

  selectTentativeChampion(socketId, champId) {
    if (this.state !== 'DRAFT') return { success: false, error: '밴픽 진행 중이 아닙니다.' };
    const player = this.players[socketId];
    if (!player) return { success: false, error: '플레이어를 찾을 수 없습니다.' };
    if (player.isLocked) return { success: false, error: '이미 선택을 확정했습니다.' };
    if (!champId || !CHAMPIONS[champId]) return { success: false, error: '존재하지 않는 챔피언입니다.' };

    // Check if champion is already locked by someone else
    for (const p of Object.values(this.players)) {
      if (p.isLocked && p.championId === champId) {
        return { success: false, error: '이미 다른 플레이어가 확정한 챔피언입니다.' };
      }
    }

    player.tentativeChampId = champId;
    this.broadcastDraftUpdate();
    return { success: true };
  }

  lockChampion(socketId, champId) {
    if (this.state !== 'DRAFT') return { success: false, error: '밴픽 진행 중이 아닙니다.' };
    const player = this.players[socketId];
    if (!player) return { success: false, error: '플레이어를 찾을 수 없습니다.' };
    if (player.isLocked) return { success: false, error: '이미 챔피언을 확정했습니다.' };

    if (!CHAMPIONS[champId]) {
      return { success: false, error: '존재하지 않는 챔피언입니다.' };
    }

    // ATOMIC EXCLUSIVITY CHECK: Single-threaded event loop guarantee
    for (const p of Object.values(this.players)) {
      if (p.socketId !== socketId && p.isLocked && p.championId === champId) {
        return { success: false, error: '방금 다른 플레이어가 먼저 확정(Lock-in)했습니다!' };
      }
    }

    // Successfully lock
    player.championId = champId;
    player.tentativeChampId = champId;
    player.isLocked = true;

    this.broadcastDraftUpdate();

    // Check if all players locked in
    const allLocked = Object.values(this.players).every(p => p.isLocked && p.championId);
    if (allLocked) {
      this.startCountdownToBattle();
    }

    return { success: true };
  }

  setSpells(socketId, spellD, spellF) {
    const player = this.players[socketId];
    if (!player) return { success: false };
    if (spellD && SUMMONER_SPELLS[spellD]) player.spellD = spellD;
    if (spellF && SUMMONER_SPELLS[spellF]) player.spellF = spellF;
    this.broadcastDraftUpdate();
    return { success: true };
  }

  startCountdownToBattle() {
    if (this.countdownTimer) return;
    this.countdownSeconds = 3;

    this.io.to(this.id).emit('draftCountdown', { seconds: this.countdownSeconds });

    this.countdownTimer = setInterval(() => {
      this.countdownSeconds -= 1;
      if (this.countdownSeconds > 0) {
        this.io.to(this.id).emit('draftCountdown', { seconds: this.countdownSeconds });
      } else {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
        this.startBattle();
      }
    }, 1000);
  }

  startBattle() {
    this.state = 'PLAYING';
    this.broadcastState();

    // Instantiate and start GameEngine
    this.gameEngine = new GameEngine(this, this.io);
    this.gameEngine.initialize();
    this.gameEngine.start();

    this.io.to(this.id).emit('battleStarted', {
      roomId: this.id,
      mapData: this.gameEngine.getMapData(),
      initialGameState: this.gameEngine.getState()
    });
  }

  endGame(winningTeam, message) {
    if (this.state !== 'PLAYING') return;
    this.state = 'GAMEOVER';

    if (this.gameEngine) {
      this.gameEngine.stop();
    }

    this.io.to(this.id).emit('battleEnded', {
      winningTeam,
      message: message || `${winningTeam === 'blue' ? '블루 팀' : '레드 팀'} 승리!`,
      scores: this.gameEngine ? this.gameEngine.scores : { blue: 0, red: 0 }
    });

    this.broadcastState();
  }

  resetToLobby() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (this.gameEngine) {
      this.gameEngine.stop();
      this.gameEngine = null;
    }
    this.state = 'LOBBY';
    Object.values(this.players).forEach(p => {
      p.isLocked = false;
      p.championId = null;
      p.tentativeChampId = null;
      if (p.socketId !== this.hostId) p.isReady = false;
    });
    this.broadcastState();
  }

  broadcastState() {
    this.io.to(this.id).emit('roomStateChanged', this.getPublicData());
  }

  broadcastDraftUpdate() {
    const lockedChampions = {};
    const playerPicks = {};

    Object.values(this.players).forEach(p => {
      playerPicks[p.socketId] = {
        socketId: p.socketId,
        nickname: p.nickname,
        team: p.team,
        tentativeChampId: p.tentativeChampId,
        championId: p.championId,
        isLocked: p.isLocked,
        spellD: p.spellD,
        spellF: p.spellF
      };
      if (p.isLocked && p.championId) {
        lockedChampions[p.championId] = p.nickname;
      }
    });

    this.io.to(this.id).emit('draftUpdate', {
      playerPicks,
      lockedChampions,
      allLocked: Object.values(this.players).every(p => p.isLocked)
    });
  }

  cleanup() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (this.gameEngine) {
      this.gameEngine.stop();
      this.gameEngine = null;
    }
  }

  getPublicData() {
    return {
      id: this.id,
      name: this.name,
      mode: this.mode,
      maxPlayers: this.maxPlayers,
      hostId: this.hostId,
      state: this.state,
      playerCount: Object.keys(this.players).length,
      players: Object.values(this.players).map(p => ({
        socketId: p.socketId,
        nickname: p.nickname,
        team: p.team,
        isReady: p.isReady,
        isHost: p.socketId === this.hostId,
        championId: p.championId,
        tentativeChampId: p.tentativeChampId,
        isLocked: p.isLocked,
        spellD: p.spellD,
        spellF: p.spellF
      }))
    };
  }
}

module.exports = Room;
