const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const http = require('http');
const socketIo = require('socket.io');
const pty = require('node-pty');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const os = require('os');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const sessionsDirectory = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionsDirectory)) {
  fs.mkdirSync(sessionsDirectory);
}

// Session middleware
app.use(session({
  store: new FileStore({
    path: sessionsDirectory
  }),
  secret: 'secret-key-terminal-app',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
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
const sessionLogs = new Map();

// Load sessions from disk on server start
function loadSessions() {
  const sessionFiles = fs.readdirSync(sessionsDirectory);
  sessionFiles.forEach(file => {
    const sessionId = path.basename(file, '.json');
    if (sessionId.length !== 36) return; // Skip non-session files
    try {
      const logData = fs.readFileSync(path.join(sessionsDirectory, file), 'utf8');
      sessionLogs.set(sessionId, logData);
      console.log(`Loaded log for session: ${sessionId}`);
    } catch (error) {
      console.error(`Failed to load session log for file: ${file}`, error);
    }
  });
}
loadSessions();

io.use((socket, next) => {
  // Socket io authentication via cookie session
  let cookie = socket.handshake.headers.cookie;
  // Simplest check: allow all connections, better way is needed for production
  next();
});

// Socket connection handling
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
    sessionLogs.set(sessionId, sessionLogs.get(sessionId) || '');

    ptyProcess.onData((data) => {
      socket.emit('terminal-output', { sessionId, data });
      sessionLogs.set(sessionId, sessionLogs.get(sessionId) + data);
      fs.writeFileSync(path.join(sessionsDirectory, `${sessionId}.json`), sessionLogs.get(sessionId));
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
    if (session) {
      session.ptyProcess.kill();
    }
    sessions.delete(sessionId);
    const logFilePath = path.join(sessionsDirectory, `${sessionId}.json`);
    if (fs.existsSync(logFilePath)) {
      fs.unlinkSync(logFilePath);
    }
    sessionLogs.delete(sessionId);
    socket.emit('session-closed', { sessionId });
  });

  socket.on('get-sessions', () => {
    const userSessions = Array.from(sessions.entries())
      .filter(([_, session]) => session.socketId === socket.id)
      .map(([sessionId, session]) => ({
        sessionId,
        createdAt: session.createdAt
      }));

    const sessionsWithLogs = Array.from(sessionLogs.keys()).map(sessionId => {
      const activeSession = sessions.get(sessionId);
      return {
        sessionId,
        createdAt: activeSession ? activeSession.createdAt : new Date(),
        active: !!activeSession
      };
    });

    socket.emit('sessions-list', sessionsWithLogs);
  });
  
  socket.on('join-session', ({ sessionId }) => {
    const session = sessions.get(sessionId);
    if (session) {
      session.socketId = socket.id;
      const log = sessionLogs.get(sessionId) || '';
      socket.emit('session-joined', { sessionId, log });
      
      // Re-route ptyProcess output to the new socket
      session.ptyProcess.removeAllListeners('data');
      session.ptyProcess.on('data', (data) => {
        socket.emit('terminal-output', { sessionId, data });
        sessionLogs.set(sessionId, sessionLogs.get(sessionId) + data);
        fs.writeFileSync(path.join(sessionsDirectory, `${sessionId}.json`), sessionLogs.get(sessionId));
      });
      
    } else {
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
      
      const log = sessionLogs.get(sessionId) || '';
      socket.emit('session-joined', { sessionId, log });

      ptyProcess.onData((data) => {
        socket.emit('terminal-output', { sessionId, data });
        sessionLogs.set(sessionId, sessionLogs.get(sessionId) + data);
        fs.writeFileSync(path.join(sessionsDirectory, `${sessionId}.json`), sessionLogs.get(sessionId));
      });
    
      ptyProcess.onExit(() => {
        sessions.delete(sessionId);
        const logFilePath = path.join(sessionsDirectory, `${sessionId}.json`);
        if (fs.existsSync(logFilePath)) {
          fs.unlinkSync(logFilePath);
        }
        sessionLogs.delete(sessionId);
        socket.emit('session-closed', { sessionId });
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    for (const [sessionId, session] of sessions.entries()) {
      if (session.socketId === socket.id) {
        session.socketId = null; // Mark as disconnected but don't kill the process
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Terminal server running on port ${PORT}`);
});
