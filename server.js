const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const pty = require('node-pty');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Store terminal sessions
const sessions = new Map();

// Serve static files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Root route serve
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Create new terminal session
  socket.on('create-session', () => {
    const sessionId = uuidv4();
    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
    
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: process.env.HOME,
      env: process.env
    });

    // Store session
    sessions.set(sessionId, {
      ptyProcess,
      socketId: socket.id,
      createdAt: new Date()
    });

    // Send terminal output to client
    ptyProcess.onData((data) => {
      socket.emit('terminal-output', { sessionId, data });
    });

    // Handle terminal exit
    ptyProcess.onExit(() => {
      sessions.delete(sessionId);
      socket.emit('session-closed', { sessionId });
    });

    // Inform client about created session
    socket.emit('session-created', { sessionId });
    console.log(`Created terminal session: ${sessionId}`);
  });

  // Handle terminal input from client
  socket.on('terminal-input', ({ sessionId, data }) => {
    const session = sessions.get(sessionId);
    if (session && session.socketId === socket.id) {
      session.ptyProcess.write(data);
    }
  });

  // Handle terminal resize
  socket.on('resize-terminal', ({ sessionId, cols, rows }) => {
    const session = sessions.get(sessionId);
    if (session && session.socketId === socket.id) {
      session.ptyProcess.resize(cols, rows);
    }
  });

  // Close session explicitly
  socket.on('close-session', ({ sessionId }) => {
    const session = sessions.get(sessionId);
    if (session && session.socketId === socket.id) {
      session.ptyProcess.kill();
      sessions.delete(sessionId);
      socket.emit('session-closed', { sessionId });
    }
  });

  // Send list of active sessions of this client
  socket.on('get-sessions', () => {
    const userSessions = Array.from(sessions.entries())
      .filter(([_, session]) => session.socketId === socket.id)
      .map(([sessionId, session]) => ({
        sessionId,
        createdAt: session.createdAt
      }));
    
    socket.emit('sessions-list', userSessions);
  });

  // Cleanup on socket disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    for (const [sessionId, session] of sessions.entries()) {
      if (session.socketId === socket.id) {
        session.ptyProcess.kill();
        sessions.delete(sessionId);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Terminal server running on port ${PORT}`);
});
