/**
 * server.js
 * MOBA LAN Server (Express + Socket.IO)
 * Real-time web MOBA game server with LAN auto-detection
 */

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]:', reason);
});

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const RoomManager = require('./game/RoomManager');
const { CHAMPIONS, SUMMONER_SPELLS } = require('./game/ChampionData');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  perMessageDeflate: false, // Disabling compression eliminates zlib deflate latency
  httpCompression: false,
  transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;

// LAN IP Auto-detection
function getLocalLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      // IPv4 and not internal/loopback
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

const LAN_IP = getLocalLanIp();

// Prevent 404 on browser favicon request
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Serve static assets from public/
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// Fallback direct static route for pixi.min.js
app.get('/lib/pixi.min.js', (req, res) => {
  const customPath = path.join(publicDir, 'lib', 'pixi.min.js');
  const nodeModulesPath = path.join(__dirname, '..', 'node_modules', 'pixi.js', 'dist', 'pixi.min.js');
  res.sendFile(customPath, (err) => {
    if (err) {
      res.sendFile(nodeModulesPath);
    }
  });
});

// Server info API for client LAN display
app.get('/api/server-info', (req, res) => {
  res.json({
    status: 'online',
    port: PORT,
    lanIp: LAN_IP,
    localUrl: `http://localhost:${PORT}`,
    lanUrl: `http://${LAN_IP}:${PORT}`
  });
});

// Champions and Spells API
app.get('/api/game-data', (req, res) => {
  res.json({
    champions: CHAMPIONS,
    spells: SUMMONER_SPELLS
  });
});

// Room Manager instance
const roomManager = new RoomManager(io);

// Socket.IO Connection Handling
io.on('connection', (socket) => {
  console.log(`[Socket Connected] ID: ${socket.id}`);

  // Disable Nagle's algorithm for instant sub-millisecond packet transmission
  try {
    if (socket.conn && socket.conn.transport && socket.conn.transport.socket) {
      if (typeof socket.conn.transport.socket.setNoDelay === 'function') {
        socket.conn.transport.socket.setNoDelay(true);
      }
    }
    socket.conn.on('upgrade', (transport) => {
      if (transport && transport.socket && typeof transport.socket.setNoDelay === 'function') {
        transport.socket.setNoDelay(true);
      }
    });
  } catch (e) {}

  // Register Nickname
  socket.on('registerUser', (data, callback) => {
    try {
      const d = data || {};
      const res = roomManager.registerUser(socket.id, d.nickname || '');
      if (typeof callback === 'function') callback(res);
    } catch (err) {
      console.error('registerUser error:', err);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // Get Lobby State
  socket.on('getLobbyState', (callback) => {
    try {
      if (typeof callback === 'function') {
        callback(roomManager.getLobbyData());
      }
    } catch (err) {
      console.error('getLobbyState error:', err);
      if (typeof callback === 'function') callback({ onlineUsers: [], rooms: [] });
    }
  });

  // Create Room
  socket.on('createRoom', (data, callback) => {
    try {
      const d = data || {};
      const res = roomManager.createRoom(d.name, d.mode, socket.id);
      if (res.success && res.room) {
        socket.join(res.room.id);
      }
      if (typeof callback === 'function') callback(res);
    } catch (err) {
      console.error('createRoom error:', err);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // Join Room
  socket.on('joinRoom', (data, callback) => {
    try {
      const d = data || {};
      const res = roomManager.joinRoom(d.roomId, socket.id);
      if (res.success && res.room) {
        socket.join(res.room.id);
      }
      if (typeof callback === 'function') callback(res);
    } catch (err) {
      console.error('joinRoom error:', err);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // Leave Room
  socket.on('leaveRoom', (callback) => {
    try {
      const user = roomManager.getUser(socket.id);
      if (user && user.roomId) {
        socket.leave(user.roomId);
      }
      const res = roomManager.leaveRoom(socket.id);
      if (typeof callback === 'function') callback(res);
    } catch (err) {
      console.error('leaveRoom error:', err);
      if (typeof callback === 'function') callback({ success: false });
    }
  });

  // Switch Team (Blue / Red)
  socket.on('switchTeam', (data, callback) => {
    try {
      const d = data || {};
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room) {
        if (typeof callback === 'function') callback({ success: false, error: 'Room not found' });
        return;
      }
      const res = room.switchTeam(socket.id, d.team);
      if (typeof callback === 'function') callback(res);
    } catch (err) {
      console.error('switchTeam error:', err);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // Toggle Ready
  socket.on('toggleReady', (callback) => {
    try {
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room) {
        if (typeof callback === 'function') callback({ success: false, error: 'Room not found' });
        return;
      }
      const res = room.toggleReady(socket.id);
      if (typeof callback === 'function') callback(res);
    } catch (err) {
      console.error('toggleReady error:', err);
      if (typeof callback === 'function') callback({ success: false });
    }
  });

  // Start Draft (Host only)
  socket.on('startDraft', (callback) => {
    try {
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room) {
        if (typeof callback === 'function') callback({ success: false, error: 'Room not found' });
        return;
      }
      const res = room.startDraft(socket.id);
      if (typeof callback === 'function') callback(res);
    } catch (err) {
      console.error('startDraft error:', err);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // Select Tentative Champion
  socket.on('selectTentativeChampion', (data, callback) => {
    try {
      const d = data || {};
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room) {
        if (typeof callback === 'function') callback({ success: false, error: 'Room not found' });
        return;
      }
      const res = room.selectTentativeChampion(socket.id, d.championId);
      if (typeof callback === 'function') callback(res);
    } catch (err) {
      console.error('selectTentativeChampion error:', err);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // Lock Champion (Atomic Lock-In Exclusivity)
  socket.on('lockChampion', (data, callback) => {
    try {
      const d = data || {};
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room) {
        if (typeof callback === 'function') callback({ success: false, error: 'Room not found' });
        return;
      }
      const res = room.lockChampion(socket.id, d.championId);
      if (typeof callback === 'function') callback(res);
    } catch (err) {
      console.error('lockChampion error:', err);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // Select Summoner Spells
  socket.on('setSpells', (data, callback) => {
    try {
      const d = data || {};
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room) {
        if (typeof callback === 'function') callback({ success: false, error: 'Room not found' });
        return;
      }
      const res = room.setSpells(socket.id, d.spellD, d.spellF);
      if (typeof callback === 'function') callback(res);
    } catch (err) {
      console.error('setSpells error:', err);
      if (typeof callback === 'function') callback({ success: false });
    }
  });

  // In-Game Player Movement Command (Right-click)
  socket.on('playerMove', (data) => {
    try {
      const d = data || {};
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room || !room.gameEngine || room.state !== 'PLAYING') return;
      room.gameEngine.handleMoveInput(socket.id, d.x, d.y);
    } catch (err) {
      console.error('playerMove error:', err);
    }
  });

  // In-Game Auto Attack Target Command
  socket.on('playerTarget', (data) => {
    try {
      const d = data || {};
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room || !room.gameEngine || room.state !== 'PLAYING') return;
      room.gameEngine.handleAttackTarget(socket.id, d.targetId);
    } catch (err) {
      console.error('playerTarget error:', err);
    }
  });

  // In-Game Attack-Move (A-Key) Command
  socket.on('playerAttackMove', (data) => {
    try {
      const d = data || {};
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room || !room.gameEngine || room.state !== 'PLAYING') return;
      room.gameEngine.handleAttackMove(socket.id, d.x, d.y);
    } catch (err) {
      console.error('playerAttackMove error:', err);
    }
  });

  // In-Game Stop (S-Key) Command
  socket.on('playerStop', () => {
    try {
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room || !room.gameEngine || room.state !== 'PLAYING') return;
      room.gameEngine.handleStop(socket.id);
    } catch (err) {
      console.error('playerStop error:', err);
    }
  });

  // In-Game Cast Skill (Q, W, E, R)
  socket.on('castSkill', (data) => {
    try {
      const d = data || {};
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room || !room.gameEngine || room.state !== 'PLAYING') return;
      room.gameEngine.handleCastSkill(socket.id, d.key, d.targetX, d.targetY);
    } catch (err) {
      console.error('castSkill error:', err);
    }
  });

  // In-Game Cast Summoner Spell (D, F)
  socket.on('castSpell', (data) => {
    try {
      const d = data || {};
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room || !room.gameEngine || room.state !== 'PLAYING') return;
      room.gameEngine.handleCastSpell(socket.id, d.slot, d.targetX, d.targetY);
    } catch (err) {
      console.error('castSpell error:', err);
    }
  });

  // Ping Check for latency display
  socket.on('pingCheck', (clientTimestamp, callback) => {
    if (typeof callback === 'function') callback(clientTimestamp);
  });

  // In-Room Chat Message
  socket.on('sendChat', (data) => {
    try {
      const d = data || {};
      const user = roomManager.getUser(socket.id);
      if (!user || !user.roomId) return;
      const text = (d.message || '').trim().substring(0, 100);
      if (!text) return;

      io.to(user.roomId).emit('chatMessage', {
        sender: user.nickname,
        senderId: socket.id,
        text,
        time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
      });
    } catch (err) {
      console.error('sendChat error:', err);
    }
  });

  // Return to Lobby after game over
  socket.on('returnToLobby', () => {
    try {
      const room = roomManager.getRoomBySocket(socket.id);
      if (room && room.state === 'GAMEOVER') {
        room.resetToLobby();
      }
    } catch (err) {
      console.error('returnToLobby error:', err);
    }
  });

  // Disconnection
  socket.on('disconnect', () => {
    try {
      console.log(`[Socket Disconnected] ID: ${socket.id}`);
      roomManager.handleDisconnect(socket.id);
    } catch (err) {
      console.error('disconnect error:', err);
    }
  });
});

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
==============================================================
   ⚔️ REAL-TIME LOL MOBA LAN SERVER RUNNING ⚔️
==============================================================
   Local:   http://localhost:${PORT}
   LAN IP:  http://${LAN_IP}:${PORT}
   Mode:    Node.js + Socket.IO + WebGL MOBA Arena
==============================================================
  `);
});
