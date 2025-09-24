const express = require('express');
const session = require('express-session');
const http = require('http');
const socketIo = require('socket.io');
const pty = require('node-pty');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// Session middleware
app.use(session({
  secret: 'secret-key-terminal-app',
  resave: false,
  saveUninitialized: false
}));

// Body parser for login POST
app.use(express.urlencoded({ extended: true }));

// Hardcoded user credentials
const USER = "samshaad365";
const PASS = "shizuka123";

// Authentication middleware
function authMiddleware(req, res, next) {
  if (req.session && req.session.authenticated) {
    next();
  } else {
    res.redirect('/login');
  }
}

// Login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login POST handler
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if(username === USER && password === PASS) {
    req.session.authenticated = true;
    req.session.username = username;
    res.redirect('/');
  } else {
    res.send(`<p style="color:red;text-align:center;margin-top:20px;">Invalid credentials.<br/><a href="/login">Try again</a></p>`);
  }
});

// Protect terminal app route with auth
app.use(authMiddleware);

// Serve static files (terminal UI)
app.use(express.static(path.join(__dirname, 'public')));

// Root Route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const sessions = new Map();

io.use((socket, next) => {
  // Socket io authentication via cookie session
  let cookie = socket.handshake.headers.cookie;
  // Simplest check: allow all connections, better way is needed for production
  next();
});

// Socket connection handling (same as before)
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

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

    sessions.set(sessionId, {
      ptyProcess,
      socketId: socket.id,
      createdAt: new Date()
    });

    ptyProcess.onData((data) => {
      socket.emit('terminal-output', { sessionId, data });
    });

    ptyProcess.onExit(() => {
      sessions.delete(sessionId);
      socket.emit('session-closed', { sessionId });
    });

    socket.emit('session-created', { sessionId });
    console.log(`Created session: ${sessionId}`);
  });

  socket.on('terminal-input', ({ sessionId, data }) => {
    const session = sessions.get(sessionId);
    if (session && session.socketId === socket.id) {
      session.ptyProcess.write(data);
    }
  });

  socket.on('resize-terminal', ({ sessionId, cols, rows }) => {
    const session = sessions.get(sessionId);
    if (session && session.socketId === socket.id) {
      session.ptyProcess.resize(cols, rows);
    }
  });

  socket.on('close-session', ({ sessionId }) => {
    const session = sessions.get(sessionId);
    if (session && session.socketId === socket.id) {
      session.ptyProcess.kill();
      sessions.delete(sessionId);
      socket.emit('session-closed', { sessionId });
    }
  });

  socket.on('get-sessions', () => {
    const userSessions = Array.from(sessions.entries())
      .filter(([_, session]) => session.socketId === socket.id)
      .map(([sessionId, session]) => ({
        sessionId,
        createdAt: session.createdAt
      }));

    socket.emit('sessions-list', userSessions);
  });

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
