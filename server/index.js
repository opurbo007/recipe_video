const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.get('/', (_, res) => res.send('FlavourKit Signaling Server ✓'));

// rooms: { roomId -> [socketId, socketId] }
const rooms = new Map();

io.on('connection', socket => {
  console.log('connect:', socket.id);

  socket.on('join-room', ({ roomId }) => {
    let members = rooms.get(roomId) || [];
    // Remove stale disconnected sockets
    members = members.filter(id => io.sockets.sockets.has(id));

    if (members.length >= 2) {
      socket.emit('room-full');
      return;
    }

    members.push(socket.id);
    rooms.set(roomId, members);
    socket.join(roomId);
    socket.data.roomId = roomId;

    if (members.length === 1) {
      // First person — wait for peer
      socket.emit('role', { role: 'host' });
      console.log(`${socket.id} is HOST of ${roomId}`);
    } else {
      // Second person — tell host to create offer
      socket.emit('role', { role: 'guest' });
      // Tell the host a guest joined
      const hostId = members[0];
      io.to(hostId).emit('guest-joined', { guestId: socket.id });
      console.log(`${socket.id} joined ${roomId} as GUEST`);
    }
  });

  // Host sends offer to guest
  socket.on('offer', ({ targetId, offer }) => {
    io.to(targetId).emit('offer', { fromId: socket.id, offer });
  });

  // Guest sends answer back to host
  socket.on('answer', ({ targetId, answer }) => {
    io.to(targetId).emit('answer', { fromId: socket.id, answer });
  });

  // Both sides relay ICE candidates
  socket.on('ice-candidate', ({ targetId, candidate }) => {
    io.to(targetId).emit('ice-candidate', { fromId: socket.id, candidate });
  });

  // Mic/cam state broadcast
  socket.on('media-state', ({ targetId, micOn, camOn }) => {
    io.to(targetId).emit('media-state', { micOn, camOn });
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const members = (rooms.get(roomId) || []).filter(id => id !== socket.id);
    if (members.length === 0) {
      rooms.delete(roomId);
    } else {
      rooms.set(roomId, members);
      io.to(members[0]).emit('peer-left');
    }
    console.log('disconnect:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Signaling server on port ${PORT}`));
