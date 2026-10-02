/**
 * RoomManager.js
 * Tracks lobby players, handles room creation, joining, and event routing.
 */

const Room = require('./Room');

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // roomId -> Room
    this.users = new Map(); // socketId -> { socketId, nickname, roomId }
    this.nextRoomId = 1;
  }

  registerUser(socketId, nickname) {
    const trimmed = (nickname || '').trim().substring(0, 15) || `소환사_${socketId.substring(0, 4)}`;
    this.users.set(socketId, {
      socketId,
      nickname: trimmed,
      roomId: null
    });
    this.broadcastLobbyUpdate();
    return { success: true, nickname: trimmed };
  }

  getUser(socketId) {
    return this.users.get(socketId);
  }

  createRoom(name, mode, socketId) {
    const user = this.users.get(socketId);
    if (!user) return { success: false, error: '등록되지 않은 사용자입니다.' };
    if (user.roomId) return { success: false, error: '이미 참여 중인 방이 있습니다.' };

    const roomId = `room_${this.nextRoomId++}`;
    const roomName = (name || '').trim().substring(0, 24) || `${user.nickname}님의 협곡`;
    const room = new Room(roomId, roomName, mode, user, this.io);

    this.rooms.set(roomId, room);
    user.roomId = roomId;

    this.broadcastLobbyUpdate();
    return { success: true, room: room.getPublicData() };
  }

  joinRoom(roomId, socketId) {
    const user = this.users.get(socketId);
    if (!user) return { success: false, error: '등록되지 않은 사용자입니다.' };
    if (user.roomId) return { success: false, error: '이미 참여 중인 방이 있습니다.' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: '존재하지 않는 방입니다.' };

    const result = room.addPlayer(socketId, user.nickname);
    if (!result.success) return result;

    user.roomId = roomId;
    this.broadcastLobbyUpdate();
    room.broadcastState();

    return { success: true, room: room.getPublicData() };
  }

  leaveRoom(socketId) {
    const user = this.users.get(socketId);
    if (!user || !user.roomId) return { success: false };

    const room = this.rooms.get(user.roomId);
    if (room) {
      const res = room.removePlayer(socketId);
      if (res && res.empty) {
        this.rooms.delete(room.id);
      }
    }

    user.roomId = null;
    this.broadcastLobbyUpdate();
    return { success: true };
  }

  handleDisconnect(socketId) {
    this.leaveRoom(socketId);
    this.users.delete(socketId);
    this.broadcastLobbyUpdate();
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  getRoomBySocket(socketId) {
    const user = this.users.get(socketId);
    if (!user || !user.roomId) return null;
    return this.rooms.get(user.roomId);
  }

  getLobbyData() {
    const onlineList = Array.from(this.users.values()).map(u => ({
      socketId: u.socketId,
      nickname: u.nickname,
      isInRoom: !!u.roomId
    }));

    const roomList = Array.from(this.rooms.values()).map(r => r.getPublicData());

    return {
      onlineUsers: onlineList,
      rooms: roomList
    };
  }

  broadcastLobbyUpdate() {
    this.io.emit('lobbyUpdate', this.getLobbyData());
  }
}

module.exports = RoomManager;
