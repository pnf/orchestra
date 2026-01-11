const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { nanoid } = require('nanoid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Root redirects to a new room - MUST be before static middleware
app.get('/', (req, res) => {
  const roomId = nanoid(8);
  res.redirect(`/${roomId}`);
});

// Serve static files (CSS, JS, etc.) but NOT index.html at root
app.use(express.static(path.join(__dirname, '../public'), { index: false }));

// Room routes - serve the same HTML for any room ID
app.get('/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Track users per room: roomId -> Map<odeyId, {id, name}>
const rooms = new Map();

// Get user list for a room
function getUserList(roomId) {
  if (!rooms.has(roomId)) return [];
  return Array.from(rooms.get(roomId).values());
}

// Broadcast user list to all in room
function broadcastUserList(roomId) {
  const users = getUserList(roomId);
  io.to(roomId).emit('userList', users);
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let userId = nanoid(6);
  let userName = 'Anonymous';

  socket.on('join', (data) => {
    // Support both old format (string) and new format (object)
    const roomId = typeof data === 'string' ? data : data.roomId;
    const name = typeof data === 'object' ? data.name : 'Anonymous';

    // Validate room ID
    if (!roomId || roomId === 'null' || roomId === 'undefined') {
      console.log(`User ${userId} tried to join invalid room: "${roomId}"`);
      return;
    }

    currentRoom = roomId;
    userName = name || 'Anonymous';
    socket.join(roomId);

    // Track user in room
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }
    rooms.get(roomId).set(userId, { id: userId, name: userName });

    // Send user their own ID
    socket.emit('yourId', userId);

    // Broadcast updated user list to all in room
    broadcastUserList(roomId);

    console.log(`User ${userId} (${userName}) joined room "${roomId}" (${rooms.get(roomId).size} users)`);
  });

  socket.on('setName', (name) => {
    userName = name || 'Anonymous';
    if (currentRoom && rooms.has(currentRoom)) {
      const user = rooms.get(currentRoom).get(userId);
      if (user) {
        user.name = userName;
        broadcastUserList(currentRoom);
      }
    }
    console.log(`User ${userId} changed name to "${userName}"`);
  });

  socket.on('noteOn', (data) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('noteOn', {
        note: data.note,
        velocity: data.velocity,
        userId: userId
      });
    }
  });

  socket.on('noteOff', (data) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('noteOff', {
        note: data.note,
        userId: userId
      });
    }
  });

  socket.on('disconnect', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      rooms.get(currentRoom).delete(userId);

      // Notify others to clean up this user's notes
      socket.to(currentRoom).emit('userLeft', { userId: userId });

      if (rooms.get(currentRoom).size === 0) {
        rooms.delete(currentRoom);
      } else {
        broadcastUserList(currentRoom);
      }

      console.log(`User ${userId} (${userName}) left room ${currentRoom}`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
