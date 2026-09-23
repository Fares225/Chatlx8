const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  }
});

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname)));

// Active connected sockets and registered Google users
const onlineSockets = new Map();
const registeredUsers = new Map();

io.on('connection', (socket) => {
  console.log(`[Chatlx] New connection: ${socket.id}`);

  // Send current registered users to newly connected client
  socket.emit('users:list', Array.from(registeredUsers.values()));

  // User login/join event with Google
  socket.on('user:join', (userData) => {
    if (!userData || !userData.email) return;

    socket.userData = userData;
    onlineSockets.set(socket.id, userData);

    // Register user in directory
    registeredUsers.set(userData.email, {
      ...userData,
      status: 'online',
      lastSeen: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
    });
    
    // Broadcast updated registered & online users to all clients
    io.emit('users:update', Array.from(registeredUsers.values()));
    
    // Broadcast notification
    socket.broadcast.emit('system:notification', {
      text: `${userData.name} سجل الدخول بحساب Google! 🌐`,
      type: 'join',
      time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
    });
  });

  // Switch/Join room
  socket.on('room:join', (room) => {
    socket.leaveAll();
    socket.join(room);
    socket.currentRoom = room;
  });

  // New message event (text, voice, image)
  socket.on('chat:message', (message) => {
    const room = message.room || 'general';
    io.to(room).emit('chat:message', message);
  });

  // Typing status
  socket.on('chat:typing', (data) => {
    const room = data.room || 'general';
    socket.to(room).emit('chat:typing', data);
  });

  // Message reaction
  socket.on('chat:reaction', (reactionData) => {
    const room = reactionData.room || 'general';
    io.to(room).emit('chat:reaction', reactionData);
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (socket.userData) {
      onlineSockets.delete(socket.id);
      // Update status in directory
      const existing = registeredUsers.get(socket.userData.email);
      if (existing) {
        existing.status = 'offline';
        registeredUsers.set(socket.userData.email, existing);
      }
      io.emit('users:update', Array.from(registeredUsers.values()));
    }
    console.log(`[Chatlx] Disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 خادم Chatlx يعمل بنجاح على: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
