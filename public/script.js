class TerminalApp {
    constructor() {
        this.socket = null;
        this.sessions = new Map();
        this.activeSessionId = null;
        this.fitAddons = new Map();
        
        this.init();
    }

    init() {
        this.connectSocket();
        this.setupEventListeners();
        this.loadSettings();
    }

    connectSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.updateConnectionStatus('connected');
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.updateConnectionStatus('disconnected');
        });

        this.socket.on('session-created', ({ sessionId }) => {
            this.createTerminalSession(sessionId);
        });

        this.socket.on('terminal-output', ({ sessionId, data }) => {
            const session = this.sessions.get(sessionId);
            if (session) {
                session.terminal.write(data);
            }
        });

        this.socket.on('session-closed', ({ sessionId }) => {
            this.closeSession(sessionId);
        });

        this.socket.on('sessions-list', (sessions) => {
            this.renderSessionsList(sessions);
        });
    }

    setupEventListeners() {
        // Header buttons
        document.getElementById('newSessionBtn').addEventListener('click', () => {
            this.createNewSession();
        });

        document.getElementById('sessionsBtn').addEventListener('click', () => {
            this.showSessionsModal();
        });

        document.getElementById('settingsBtn').addEventListener('click', () => {
            this.showSettingsModal();
        });

        // Mobile keyboard
        document.querySelectorAll('.key-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.handleVirtualKey(btn.dataset.key);
            });
        });

        // Settings
        document.getElementById('fontSize').addEventListener('change', (e) => {
            this.changeFontSize(e.target.value);
        });

        document.getElementById('theme').addEventListener('change', (e) => {
            this.changeTheme(e.target.value);
        });

        document.getElementById('showKeyboard').addEventListener('change', (e) => {
            this.toggleKeyboard(e.target.checked);
        });

        // Window resize
        window.addEventListener('resize', () => {
            this.fitAddons.forEach((fitAddon, sessionId) => {
                if (fitAddon) {
                    setTimeout(() => fitAddon.fit(), 100);
                }
            });
        });
    }

    createNewSession() {
        this.updateConnectionStatus('connecting');
        this.socket.emit('create-session');
    }

    createTerminalSession(sessionId) {
        // Create terminal instance
        const terminal = new Terminal({
            cursorBlink: true,
            fontSize: parseInt(localStorage.getItem('fontSize') || '14'),
            fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
            theme: this.getTheme(localStorage.getItem('theme') || 'dark')
        });

        const fitAddon = new FitAddon.FitAddon();
        terminal.loadAddon(fitAddon);

        // Create terminal container
        const terminalDiv = document.createElement('div');
        terminalDiv.className = 'terminal-instance';
        terminalDiv.id = `terminal-${sessionId}`;
        
        document.getElementById('terminalWrapper').appendChild(terminalDiv);
        terminal.open(terminalDiv);
        
        // Fit terminal to container
        setTimeout(() => {
            fitAddon.fit();
            this.socket.emit('resize-terminal', {
                sessionId,
                cols: terminal.cols,
                rows: terminal.rows
            });
        }, 100);

        // Handle input
        terminal.onData((data) => {
            this.socket.emit('terminal-input', { sessionId, data });
        });

        // Handle resize
        terminal.onResize(({ cols, rows }) => {
            this.socket.emit('resize-terminal', { sessionId, cols, rows });
        });

        // Store session
        this.sessions.set(sessionId, {
            terminal,
            element: terminalDiv,
            createdAt: new Date()
        });
        
        this.fitAddons.set(sessionId, fitAddon);

        // Create tab
        this.createSessionTab(sessionId);
        
        // Switch to new session
        this.switchToSession(sessionId);
        
        // Hide no-session message
        document.querySelector('.no-session').style.display = 'none';
    }

    createSessionTab(sessionId) {
        const tabsContainer = document.getElementById('sessionTabs');
        
        const tab = document.createElement('button');
        tab.className = 'session-tab';
        tab.id = `tab-${sessionId}`;
        tab.innerHTML = `
            <i class="fas fa-terminal"></i>
            Session ${this.sessions.size}
            <button class="close-btn" onclick="app.closeSession('${sessionId}')">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        tab.addEventListener('click', (e) => {
            if (!e.target.classList.contains('close-btn') && !e.target.classList.contains('fa-times')) {
                this.switchToSession(sessionId);
            }
        });
        
        tabsContainer.appendChild(tab);
    }

    switchToSession(sessionId) {
        // Hide all terminals
        document.querySelectorAll('.terminal-instance').forEach(el => {
            el.classList.remove('active');
        });
        
        // Remove active class from all tabs
        document.querySelectorAll('.session-tab').forEach(el => {
            el.classList.remove('active');
        });
        
        // Show selected terminal
        const terminalElement = document.getElementById(`terminal-${sessionId}`);
        if (terminalElement) {
            terminalElement.classList.add('active');
        }
        
        // Activate tab
        const tabElement = document.getElementById(`tab-${sessionId}`);
        if (tabElement) {
            tabElement.classList.add('active');
        }
        
        this.activeSessionId = sessionId;
        
        // Fit terminal
        const fitAddon = this.fitAddons.get(sessionId);
        if (fitAddon) {
            setTimeout(() => fitAddon.fit(), 100);
        }
    }

    closeSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return;
        
        // Close terminal
        this.socket.emit('close-session', { sessionId });
        
        // Remove from DOM
        session.element.remove();
        document.getElementById(`tab-${sessionId}`).remove();
        
        // Clean up
        this.sessions.delete(sessionId);
        this.fitAddons.delete(sessionId);
        
        // Switch to another session if this was active
        if (this.activeSessionId === sessionId) {
            const remainingSessions = Array.from(this.sessions.keys());
            if (remainingSessions.length > 0) {
                this.switchToSession(remainingSessions[0]);
            } else {
                this.activeSessionId = null;
                document.querySelector('.no-session').style.display = 'flex';
            }
        }
    }

    handleVirtualKey(key) {
        if (!this.activeSessionId) return;
        
        const session = this.sessions.get(this.activeSessionId);
        if (!session) return;
        
        const terminal = session.terminal;
        
        switch (key) {
            case 'Tab':
                this.socket.emit('terminal-input', { 
                    sessionId: this.activeSessionId, 
                    data: '\t' 
                });
                break;
            case 'Enter':
                this.socket.emit('terminal-input', { 
                    sessionId: this.activeSessionId, 
                    data: '\r' 
                });
                break;
            case 'Escape':
                this.socket.emit('terminal-input', { 
                    sessionId: this.activeSessionId, 
                    data: '\x1b' 
                });
                break;
            case 'Ctrl+C':
                this.socket.emit('terminal-input', { 
                    sessionId: this.activeSessionId, 
                    data: '\x03' 
                });
                break;
            case 'Ctrl+Z':
                this.socket.emit('terminal-input', { 
                    sessionId: this.activeSessionId, 
                    data: '\x1a' 
                });
                break;
            case 'Ctrl+D':
                this.socket.emit('terminal-input', { 
                    sessionId: this.activeSessionId, 
                    data: '\x04' 
                });
                break;
            case 'ArrowUp':
                this.socket.emit('terminal-input', { 
                    sessionId: this.activeSessionId, 
                    data: '\x1b[A' 
                });
                break;
            case 'ArrowDown':
                this.socket.emit('terminal-input', { 
                    sessionId: this.activeSessionId, 
                    data: '\x1b[B' 
                });
                break;
            case 'ArrowRight':
                this.socket.emit('terminal-input', { 
                    sessionId: this.activeSessionId, 
                    data: '\x1b[C' 
                });
                break;
            case 'ArrowLeft':
                this.socket.emit('terminal-input', { 
                    sessionId: this.activeSessionId, 
                    data: '\x1b[D' 
                });
                break;
            default:
                this.socket.emit('terminal-input', { 
                    sessionId: this.activeSessionId, 
                    data: key 
                });
        }
    }

    showSessionsModal() {
        this.socket.emit('get-sessions');
        this.showModal('sessionsModal');
    }

    showSettingsModal() {
        this.showModal('settingsModal');
    }

    showModal(modalId) {
        document.getElementById(modalId).classList.add('show');
    }

    closeModal(modalId) {
        document.getElementById(modalId).classList.remove('show');
    }

    renderSessionsList(sessions) {
        const container = document.getElementById('sessionsList');
        container.innerHTML = '';
        
        sessions.forEach(session => {
            const sessionDiv = document.createElement('div');
            sessionDiv.className = 'session-item';
            sessionDiv.innerHTML = `
                <div class="session-info">
                    <h4>Session ${session.sessionId.slice(0, 8)}</h4>
                    <small>Created: ${new Date(session.createdAt).toLocaleString()}</small>
                </div>
                <div class="session-actions">
                    <button class="btn-small" onclick="app.switchToSession('${session.sessionId}'); app.closeModal('sessionsModal')">
                        Open
                    </button>
                    <button class="btn-small btn-danger" onclick="app.closeSession('${session.sessionId}')">
                        Close
                    </button>
                </div>
            `;
            container.appendChild(sessionDiv);
        });
    }

    updateConnectionStatus(status) {
        // Remove existing status
        document.querySelector('.connection-status')?.remove();
        
        const statusDiv = document.createElement('div');
        statusDiv.className = `connection-status status-${status}`;
        statusDiv.textContent = status.toUpperCase();
        
        document.body.appendChild(statusDiv);
        
        // Remove after 3 seconds if connected
        if (status === 'connected') {
            setTimeout(() => statusDiv.remove(), 3000);
        }
    }

    changeFontSize(size) {
        localStorage.setItem('fontSize', size);
        this.sessions.forEach((session) => {
            session.terminal.options.fontSize = parseInt(size);
        });
    }

    changeTheme(themeName) {
        localStorage.setItem('theme', themeName);
        const theme = this.getTheme(themeName);
        
        this.sessions.forEach((session) => {
            session.terminal.options.theme = theme;
        });
        
        // Update body class for overall theme
        document.body.className = `theme-${themeName}`;
    }

    getTheme(themeName) {
        const themes = {
            dark: {
                background: '#000000',
                foreground: '#ffffff',
                cursor: '#ffffff',
                selection: '#ffffff40'
            },
            light: {
                background: '#ffffff',
                foreground: '#000000',
                cursor: '#000000',
                selection: '#00000040'
            },
            green: {
                background: '#000000',
                foreground: '#00ff41',
                cursor: '#00ff41',
                selection: '#00ff4140'
            }
        };
        
        return themes[themeName] || themes.dark;
    }

    toggleKeyboard(show) {
        localStorage.setItem('showKeyboard', show);
        const keyboard = document.querySelector('.mobile-keyboard');
        keyboard.style.display = show ? 'flex' : 'none';
    }

    loadSettings() {
        // Load saved settings
        const fontSize = localStorage.getItem('fontSize') || '14';
        const theme = localStorage.getItem('theme') || 'dark';
        const showKeyboard = localStorage.getItem('showKeyboard') !== 'false';
        
        document.getElementById('fontSize').value = fontSize;
        document.getElementById('theme').value = theme;
        document.getElementById('showKeyboard').checked = showKeyboard;
        
        this.changeTheme(theme);
        this.toggleKeyboard(showKeyboard);
    }
}

// Global functions
function createNewSession() {
    app.createNewSession();
}

function closeModal(modalId) {
    app.closeModal(modalId);
}

// Initialize app
const app = new TerminalApp();

// Handle back button on Android
window.addEventListener('popstate', (e) => {
    // Close any open modals
    document.querySelectorAll('.modal.show').forEach(modal => {
        modal.classList.remove('show');
    });
});
