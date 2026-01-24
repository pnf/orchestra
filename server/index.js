const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { nanoid } = require('nanoid');

// Make geoip-lite optional to save memory (uses ~150MB)
// Set DISABLE_GEOIP=1 to disable IP-based geolocation
let geoip = null;
if (process.env.DISABLE_GEOIP !== '1') {
  try {
    console.log('Loading geoip-lite database...');
    const memBefore = process.memoryUsage();
    geoip = require('geoip-lite');
    const memAfter = process.memoryUsage();
    console.log(`geoip-lite loaded (added ${Math.round((memAfter.rss - memBefore.rss) / 1024 / 1024)}MB)`);
  } catch (err) {
    console.warn('geoip-lite not available, IP geolocation disabled:', err.message);
  }
} else {
  console.log('IP-based geolocation disabled (DISABLE_GEOIP=1)');
}

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

// Track users per room: roomId -> Map<clientId, {id, name, socketId}>
const rooms = new Map();
// Track socket to client mapping for disconnect handling: socketId -> {clientId, roomId}
const socketClients = new Map();
// Track room-level sync settings: roomId -> {syncLatency, syncEnabled}
const roomSettings = new Map();

// Get or create room settings with defaults
function getRoomSettings(roomId) {
  if (!roomSettings.has(roomId)) {
    roomSettings.set(roomId, { syncLatency: 200, syncEnabled: true });
  }
  return roomSettings.get(roomId);
}

// Get location from IP address
function getLocationFromIP(ip) {
  // If geoip is disabled or not available, return null
  if (!geoip) {
    return null;
  }

  // Handle localhost and private IPs
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return null;
  }

  // Remove IPv6 prefix if present (::ffff:xxx.xxx.xxx.xxx)
  const cleanIp = ip.replace(/^::ffff:/, '');

  const geo = geoip.lookup(cleanIp);
  if (!geo) return null;

  // Format location as "City, Country" or just "Country" if no city
  const parts = [];
  if (geo.city) parts.push(geo.city);
  if (geo.country) parts.push(geo.country);

  return parts.length > 0 ? parts.join(', ') : null;
}

// Get user list for a room
function getUserList(roomId) {
  if (!rooms.has(roomId)) return [];
  return Array.from(rooms.get(roomId).values()).map(u => ({
    id: u.id,
    name: u.name,
    location: u.location,
    instrument: u.instrument || 'piano'
  }));
}

// Broadcast user list to all in room
function broadcastUserList(roomId) {
  const users = getUserList(roomId);
  io.to(roomId).emit('userList', users);
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let clientId = null;
  let userName = 'Anonymous';
  let userInstrument = 'piano';

  // Time sync: client sends request, server responds with server time
  socket.on('timeSync', (clientTime, callback) => {
    callback({
      clientTime,
      serverTime: Date.now()
    });
  });

  socket.on('join', (data) => {
    // Support both old format (string) and new format (object)
    const roomId = typeof data === 'string' ? data : data.roomId;
    const name = typeof data === 'object' ? data.name : 'Anonymous';
    const incomingClientId = typeof data === 'object' ? data.clientId : null;
    const instrument = typeof data === 'object' ? (data.instrument || 'piano') : 'piano';
    const browserLocation = typeof data === 'object' ? data.location : null;

    // Validate room ID
    if (!roomId || roomId === 'null' || roomId === 'undefined') {
      console.log(`Socket ${socket.id} tried to join invalid room: "${roomId}"`);
      return;
    }

    // Use provided clientId or generate one
    clientId = incomingClientId || nanoid(6);
    currentRoom = roomId;
    userName = name || 'Anonymous';
    userInstrument = instrument;
    socket.join(roomId);

    // Prefer browser location, fall back to IP
    let location;
    let locationSource;

    if (browserLocation) {
      location = browserLocation;
      locationSource = 'browser';
    } else {
      const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() ||
                 socket.handshake.address;
      location = getLocationFromIP(ip);
      locationSource = 'ip';
    }

    console.log(`User ${clientId} connecting from ${locationSource}, location: ${location || 'unknown'}`);


    // Track socket -> client mapping
    socketClients.set(socket.id, { clientId, roomId });

    // Initialize room if needed
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }

    const room = rooms.get(roomId);
    const existingUser = room.get(clientId);

    if (existingUser) {
      // User is reconnecting - update their socket and name
      const oldSocketId = existingUser.socketId;
      existingUser.socketId = socket.id;
      existingUser.name = userName;
      existingUser.location = location;
      existingUser.instrument = userInstrument;

      // Clean up old socket mapping if it exists
      if (oldSocketId && oldSocketId !== socket.id) {
        socketClients.delete(oldSocketId);
        // Force disconnect old socket if still connected
        const oldSocket = io.sockets.sockets.get(oldSocketId);
        if (oldSocket) {
          oldSocket.disconnect(true);
        }
      }

      console.log(`User ${clientId} (${userName}) reconnected to room "${roomId}" (${room.size} users)`);
    } else {
      // New user joining
      room.set(clientId, { id: clientId, name: userName, socketId: socket.id, location, instrument: userInstrument });
      console.log(`User ${clientId} (${userName}) joined room "${roomId}" (${room.size} users)`);
    }

    // Send user their own ID
    socket.emit('yourId', clientId);

    // Send current room sync settings
    const settings = getRoomSettings(roomId);
    socket.emit('roomSettings', settings);

    // Broadcast updated user list to all in room
    broadcastUserList(roomId);
  });

  // Handle sync setting changes - broadcast to all in room
  socket.on('setSyncLatency', (latency) => {
    if (currentRoom) {
      const settings = getRoomSettings(currentRoom);
      settings.syncLatency = Math.max(50, Math.min(500, latency)); // clamp to valid range
      io.to(currentRoom).emit('roomSettings', settings);
      console.log(`Room ${currentRoom}: sync latency set to ${settings.syncLatency}ms by ${clientId}`);
    }
  });

  socket.on('setSyncEnabled', (enabled) => {
    if (currentRoom) {
      const settings = getRoomSettings(currentRoom);
      settings.syncEnabled = !!enabled;
      io.to(currentRoom).emit('roomSettings', settings);
      console.log(`Room ${currentRoom}: sync ${settings.syncEnabled ? 'enabled' : 'disabled'} by ${clientId}`);
    }
  });

  socket.on('setName', (name) => {
    userName = name || 'Anonymous';
    if (currentRoom && rooms.has(currentRoom) && clientId) {
      const user = rooms.get(currentRoom).get(clientId);
      if (user) {
        user.name = userName;
        broadcastUserList(currentRoom);
      }
    }
    console.log(`User ${clientId} changed name to "${userName}"`);
  });

  socket.on('setLocation', (location) => {
    if (currentRoom && rooms.has(currentRoom) && clientId) {
      const user = rooms.get(currentRoom).get(clientId);
      if (user) {
        user.location = location;
        broadcastUserList(currentRoom);
        console.log(`User ${clientId} updated location to "${location}" (from browser)`);
      }
    }
  });

  socket.on('setInstrument', (instrument) => {
    userInstrument = instrument || 'piano';
    if (currentRoom && rooms.has(currentRoom) && clientId) {
      const user = rooms.get(currentRoom).get(clientId);
      if (user) {
        user.instrument = userInstrument;
        // Broadcast instrument change to all users in room
        io.to(currentRoom).emit('userInstrument', {
          userId: clientId,
          instrument: userInstrument
        });
      }
    }
    console.log(`User ${clientId} changed instrument to "${userInstrument}"`);
  });

  socket.on('noteOn', (data) => {
    if (currentRoom && clientId) {
      const serverTime = Date.now();
      socket.to(currentRoom).emit('noteOn', {
        note: data.note,
        velocity: data.velocity,
        userId: clientId,
        timestamp: serverTime
      });
      // Echo back to sender with timestamp for synchronized local playback
      socket.emit('noteOnSelf', {
        note: data.note,
        velocity: data.velocity,
        timestamp: serverTime
      });
    }
  });

  socket.on('noteOff', (data) => {
    if (currentRoom && clientId) {
      const serverTime = Date.now();
      socket.to(currentRoom).emit('noteOff', {
        note: data.note,
        userId: clientId,
        timestamp: serverTime
      });
      // Echo back to sender with timestamp
      socket.emit('noteOffSelf', {
        note: data.note,
        timestamp: serverTime
      });
    }
  });

  socket.on('disconnect', () => {
    const socketInfo = socketClients.get(socket.id);
    socketClients.delete(socket.id);

    if (!socketInfo) return;

    const { clientId: disconnectedClientId, roomId } = socketInfo;

    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      const user = room.get(disconnectedClientId);

      // Only remove user if this socket was their current socket
      // (prevents removing user when old socket disconnects after reconnect)
      if (user && user.socketId === socket.id) {
        room.delete(disconnectedClientId);

        // Notify others to clean up this user's notes
        socket.to(roomId).emit('userLeft', { userId: disconnectedClientId });

        if (room.size === 0) {
          rooms.delete(roomId);
        } else {
          broadcastUserList(roomId);
        }

        console.log(`User ${disconnectedClientId} (${userName}) left room ${roomId}`);
      } else {
        console.log(`Old socket for ${disconnectedClientId} disconnected (user still connected)`);
      }
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log('Initial memory usage:', formatMemory(process.memoryUsage()));

  // Log memory every 5 minutes
  setInterval(() => {
    const mem = process.memoryUsage();
    console.log('Memory usage:', formatMemory(mem));

    // Warn if RSS is over 400MB (leaving buffer before 512MB limit)
    if (mem.rss > 400 * 1024 * 1024) {
      console.warn('WARNING: High memory usage detected:', formatMemory(mem));
    }
  }, 5 * 60 * 1000);
});

function formatMemory(mem) {
  return {
    rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
    heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
    external: `${Math.round(mem.external / 1024 / 1024)}MB`
  };
}
