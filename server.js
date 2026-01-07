/**
 * 6KODA - Server
 * Real-time multiplayer card game server
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

let Game;
try {
  Game = require('./game');
} catch (err) {
  console.error('❌ Failed to load game.js:', err.message);
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size, uptime: process.uptime() });
});

// ==================== DATA ====================

const rooms = new Map();
const dataDir = path.join(__dirname, 'data');
const leaderboardPath = path.join(dataDir, 'leaderboard.json');

try {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
} catch (err) {
  console.error('⚠️ Data dir error:', err.message);
}

function loadLeaderboard() {
  try {
    if (fs.existsSync(leaderboardPath)) {
      return JSON.parse(fs.readFileSync(leaderboardPath, 'utf8')) || {};
    }
  } catch (err) {
    console.error('⚠️ Leaderboard load error:', err.message);
  }
  return {};
}

function saveLeaderboard(data) {
  try {
    fs.writeFileSync(leaderboardPath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('⚠️ Leaderboard save error:', err.message);
  }
}

// ==================== HELPERS ====================

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function getRoom(code) {
  return code ? rooms.get(code.toUpperCase()) : null;
}

function validateName(name) {
  if (!name || typeof name !== 'string') return { valid: false, error: 'Name required' };
  const clean = name.trim().replace(/[<>]/g, '').substring(0, 15);
  if (clean.length < 1) return { valid: false, error: 'Name too short' };
  return { valid: true, name: clean };
}

function broadcastState(room, action = null) {
  if (!room?.game?.players) return;
  room.players.forEach(p => {
    try {
      const state = room.game.getStateForPlayer(p.id);
      if (action) state.lastAction = action;
      io.to(p.id).emit('gameState', state);
    } catch (err) {
      console.error('State broadcast error:', err.message);
    }
  });
}

function checkGameOver(room, roomCode) {
  if (!room?.game?.isGameOver()) return false;

  const loser = room.game.getLoser();
  if (!loser) return false;

  console.log(`🏁 Game over! ${loser.name} is the 6KODA!`);

  const lb = loadLeaderboard();
  room.players.forEach(p => {
    if (!lb[p.name]) lb[p.name] = { wins: 0, losses: 0 };
    if (p.id === loser.id) lb[p.name].losses++;
    else lb[p.name].wins++;
  });
  saveLeaderboard(lb);

  io.to(roomCode).emit('gameOver', { loser: loser.name, leaderboard: lb });
  room.game.phase = 'ended';
  return true;
}

function handleError(socket, msg) {
  console.error(`⚠️ ${socket.id}: ${msg}`);
  socket.emit('error', { message: msg });
}

// Cleanup stale rooms every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (room.players.length === 0 || (room.lastActivity && now - room.lastActivity > 3600000)) {
      rooms.delete(code);
      console.log(`🗑️ Cleaned room: ${code}`);
    }
  }
}, 300000);

// ==================== SOCKET.IO ====================

io.on('connection', (socket) => {
  console.log('✅ Connected:', socket.id);
  socket.roomCode = null;
  socket.playerName = null;

  // CREATE ROOM
  socket.on('createRoom', (data) => {
    try {
      const nameVal = validateName(data?.playerName);
      if (!nameVal.valid) return handleError(socket, nameVal.error);

      let roomCode, attempts = 0;
      do {
        roomCode = generateRoomCode();
        attempts++;
      } while (rooms.has(roomCode) && attempts < 10);

      if (rooms.has(roomCode)) return handleError(socket, 'Failed to create room');

      const room = {
        code: roomCode,
        players: [{ id: socket.id, name: nameVal.name, ready: false }],
        game: null,
        host: socket.id,
        lastActivity: Date.now()
      };

      rooms.set(roomCode, room);
      socket.join(roomCode);
      socket.roomCode = roomCode;
      socket.playerName = nameVal.name;

      console.log(`🏠 Room ${roomCode} by ${nameVal.name}`);
      socket.emit('roomCreated', { roomCode, players: room.players });
    } catch (err) {
      handleError(socket, 'Create room failed');
    }
  });

  // JOIN ROOM
  socket.on('joinRoom', (data) => {
    try {
      const nameVal = validateName(data?.playerName);
      if (!nameVal.valid) return handleError(socket, nameVal.error);

      const roomCode = (data?.roomCode || '').toUpperCase().trim();
      if (roomCode.length < 4) return handleError(socket, 'Invalid room code');

      const room = getRoom(roomCode);
      if (!room) return handleError(socket, 'Room not found!');
      if (room.players.length >= 5) return handleError(socket, 'Room full!');
      if (room.game && room.game.phase !== 'ended') return handleError(socket, 'Game in progress!');
      if (room.players.some(p => p.name.toLowerCase() === nameVal.name.toLowerCase())) {
        return handleError(socket, 'Name taken!');
      }

      room.players.push({ id: socket.id, name: nameVal.name, ready: false });
      room.lastActivity = Date.now();

      socket.join(roomCode);
      socket.roomCode = roomCode;
      socket.playerName = nameVal.name;

      console.log(`👤 ${nameVal.name} joined ${roomCode}`);
      io.to(roomCode).emit('playerJoined', { players: room.players });
    } catch (err) {
      handleError(socket, 'Join failed');
    }
  });

  // PLAYER READY
  socket.on('playerReady', () => {
    try {
      const room = getRoom(socket.roomCode);
      if (!room) return;
      const player = room.players.find(p => p.id === socket.id);
      if (player) player.ready = true;
      room.lastActivity = Date.now();
      io.to(socket.roomCode).emit('playerUpdated', { players: room.players });
    } catch (err) {}
  });

  // START GAME
  socket.on('startGame', () => {
    try {
      const room = getRoom(socket.roomCode);
      if (!room) return handleError(socket, 'Room not found');
      if (socket.id !== room.host) return handleError(socket, 'Only host can start!');
      if (room.players.length < 2) return handleError(socket, 'Need 2+ players!');

      room.game = new Game(room.players.map(p => ({ id: p.id, name: p.name })));
      room.game.deal();
      room.lastActivity = Date.now();

      console.log(`🎮 Game started in ${socket.roomCode}`);
      room.players.forEach(p => {
        io.to(p.id).emit('gameStarted', room.game.getStateForPlayer(p.id));
      });
    } catch (err) {
      handleError(socket, 'Start failed');
    }
  });

  // SWAP CARDS
  socket.on('swapCards', (data) => {
    try {
      const room = getRoom(socket.roomCode);
      if (!room?.game) return;

      const result = room.game.swapCards(socket.id, data?.handIndex, data?.faceUpIndex);
      if (result.error) return handleError(socket, result.error);

      room.lastActivity = Date.now();
      socket.emit('gameState', room.game.getStateForPlayer(socket.id));
    } catch (err) {
      handleError(socket, 'Swap failed');
    }
  });

  // CONFIRM READY
  socket.on('confirmReady', () => {
    try {
      const room = getRoom(socket.roomCode);
      if (!room?.game) return;

      room.game.confirmReady(socket.id);
      room.lastActivity = Date.now();

      if (room.game.allReady()) {
        room.game.startPlay();
        console.log(`▶️ Play started in ${socket.roomCode}`);
        room.players.forEach(p => {
          io.to(p.id).emit('playStarted', room.game.getStateForPlayer(p.id));
        });
      } else {
        socket.emit('waiting', { message: 'Waiting for others...' });
      }
    } catch (err) {
      handleError(socket, 'Ready failed');
    }
  });

  // PLAY CARDS
  socket.on('playCards', (data) => {
    try {
      const room = getRoom(socket.roomCode);
      if (!room?.game) return handleError(socket, 'No game');

      const result = room.game.playCards(socket.id, data?.cardIndices);
      if (result.error) return handleError(socket, result.error);

      room.lastActivity = Date.now();
      console.log(`🃏 ${socket.playerName}: ${result.action}`);
      broadcastState(room, result.action);
      checkGameOver(room, socket.roomCode);
    } catch (err) {
      handleError(socket, 'Play failed');
    }
  });

  // PICK UP PILE
  socket.on('pickUpPile', () => {
    try {
      const room = getRoom(socket.roomCode);
      if (!room?.game) return handleError(socket, 'No game');

      const result = room.game.pickUpPile(socket.id);
      if (result.error) return handleError(socket, result.error);

      room.lastActivity = Date.now();
      console.log(`📥 ${socket.playerName}: ${result.action}`);
      broadcastState(room, result.action);
    } catch (err) {
      handleError(socket, 'Pickup failed');
    }
  });

  // PICK FROM DECK
  socket.on('pickFromDeck', () => {
    try {
      const room = getRoom(socket.roomCode);
      if (!room?.game) return handleError(socket, 'No game');

      const result = room.game.pickFromDeck(socket.id);
      if (result.error) return handleError(socket, result.error);

      room.lastActivity = Date.now();
      console.log(`🎴 ${socket.playerName}: ${result.action}`);

      if (result.mustPlay) {
        const state = room.game.getStateForPlayer(socket.id);
        socket.emit('forcedCardPicked', { ...state, lastAction: result.action, pickedCard: result.pickedCard, canPlayIt: result.canPlayIt });
        room.players.filter(p => p.id !== socket.id).forEach(p => {
          io.to(p.id).emit('gameState', { ...room.game.getStateForPlayer(p.id), lastAction: result.action });
        });
      } else {
        broadcastState(room, result.action);
      }
    } catch (err) {
      handleError(socket, 'Draw failed');
    }
  });

  // PLAY FORCED
  socket.on('playForcedCard', () => {
    try {
      const room = getRoom(socket.roomCode);
      if (!room?.game) return handleError(socket, 'No game');

      const result = room.game.playForcedCard(socket.id);
      if (result.error) return handleError(socket, result.error);

      room.lastActivity = Date.now();
      console.log(`🃏 ${socket.playerName}: ${result.action}`);
      broadcastState(room, result.action);
      checkGameOver(room, socket.roomCode);
    } catch (err) {
      handleError(socket, 'Forced play failed');
    }
  });

  // DECLINE FORCED
  socket.on('declineForcedCard', () => {
    try {
      const room = getRoom(socket.roomCode);
      if (!room?.game) return handleError(socket, 'No game');

      const result = room.game.declineForcedCard(socket.id);
      if (result.error) return handleError(socket, result.error);

      room.lastActivity = Date.now();
      console.log(`📥 ${socket.playerName}: ${result.action}`);
      broadcastState(room, result.action);
    } catch (err) {
      handleError(socket, 'Decline failed');
    }
  });

  // LEADERBOARD
  socket.on('getLeaderboard', () => {
    socket.emit('leaderboard', loadLeaderboard());
  });

  // PLAY AGAIN
  socket.on('playAgain', () => {
    try {
      const room = getRoom(socket.roomCode);
      if (!room || room.players.length < 2) return handleError(socket, 'Need 2+ players');

      room.game = new Game(room.players.map(p => ({ id: p.id, name: p.name })));
      room.game.deal();
      room.lastActivity = Date.now();

      console.log(`🔄 New game in ${socket.roomCode}`);
      room.players.forEach(p => {
        io.to(p.id).emit('gameStarted', room.game.getStateForPlayer(p.id));
      });
    } catch (err) {
      handleError(socket, 'Restart failed');
    }
  });

  // DISCONNECT
  socket.on('disconnect', (reason) => {
    console.log(`❌ Disconnected: ${socket.id} (${reason})`);
    const room = getRoom(socket.roomCode);
    if (!room) return;

    const name = socket.playerName || 'Unknown';
    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.players.length === 0) {
      rooms.delete(socket.roomCode);
      console.log(`🗑️ Room ${socket.roomCode} deleted`);
    } else {
      if (room.host === socket.id) {
        room.host = room.players[0].id;
      }
      io.to(socket.roomCode).emit('playerLeft', { players: room.players, disconnectedPlayer: name });

      if (room.game?.phase === 'playing' && room.players.length === 1) {
        io.to(socket.roomCode).emit('gameOver', { loser: name, message: `${name} left - you win!` });
        room.game.phase = 'ended';
      }
    }
  });
});

// ==================== START ====================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
  🎮 ═══════════════════════════════════════ 🎮
  
     🃏 6KODA Card Game Server
     
     🌐 http://localhost:${PORT}
     📊 http://localhost:${PORT}/health
     
     ✅ Ready for connections!
     
  🎮 ═══════════════════════════════════════ 🎮
  `);
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });