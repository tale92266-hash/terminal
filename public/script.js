class TerminalApp {
    constructor() {
        this.socket = null;
        this.sessions = new Map();
        this.activeSessionId = null;
        this.ctrlPressed = false;
        this.altPressed = false;
        this.init();
    }

    init() {
        this.connectSocket();
        this.setupEventListeners();
        this.loadSettings();
        this.setupMobileKeyboard();
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
        document.getElementById('newSessionBtn').addEventListener('click', () => {
            this.socket.emit('create-session');
        });

        document.getElementById('createFirstSession').addEventListener('click', () => {
            this.socket.emit('create-session');
        });

        document.getElementById('sessionsBtn').addEventListener('click', () => {
            this.showSessionsModal();
        });

        document.getElementById('settingsBtn').addEventListener('click', () => {
            this.showSettingsModal();
        });

        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                this.hideModals();
            });
        });

        document.getElementById('fontSize').addEventListener('change', (e) => {
            this.setFontSize(parseInt(e.target.value));
        });

        document.getElementById('theme').addEventListener('change', (e) => {
            this.setTheme(e.target.value);
        });

        document.getElementById('showKeyboard').addEventListener('change', (e) => {
            this.toggleKeyboard(e.target.checked);
        });

        document.getElementById('enableSound').addEventListener('change', (e) => {
            this.toggleSound(e.target.checked);
        });
    }

    loadSettings() {
        const fontSize = localStorage.getItem('fontSize') || '14';
        const theme = localStorage.getItem('theme') || 'dark';
        const showKeyboard = localStorage.getItem('showKeyboard') !== 'false';
        const enableSound = localStorage.getItem('enableSound') === 'true';

        document.getElementById('fontSize').value = fontSize;
        document.getElementById('theme').value = theme;
        document.getElementById('showKeyboard').checked = showKeyboard;
        document.getElementById('enableSound').checked = enableSound;

        this.setFontSize(parseInt(fontSize));
        this.setTheme(theme);
        this.toggleKeyboard(showKeyboard);
        this.toggleSound(enableSound);
    }

    setFontSize(size) {
        localStorage.setItem('fontSize', size);
        this.sessions.forEach(({ terminal }) => {
            terminal.setOption('fontSize', size);
        });
    }

    setTheme(theme) {
        localStorage.setItem('theme', theme);
        // Switch xterm themes accordingly
        // Light/Dark/Matrix themes can be implemented here
    }

    toggleKeyboard(show) {
        localStorage.setItem('showKeyboard', show);
        const keyboard = document.getElementById('mobileKeyboard');
        keyboard.style.display = show ? 'flex' : 'none';
    }

    toggleSound(enable) {
        localStorage.setItem('enableSound', enable);
        // Define or toggle sound effects here
    }

    createTerminalSession(sessionId) {
        const terminalWrapper = document.getElementById('terminalWrapper');
        const noSessionElement = document.getElementById('noSession');

        if (noSessionElement) noSessionElement.style.display = 'none';

        const terminalElement = document.createElement('div');
        terminalElement.classList.add('terminal-instance');
        terminalElement.id = `terminal-${sessionId}`;
        terminalWrapper.appendChild(terminalElement);

        // Create xterm instance
        const terminal = new Terminal({
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: parseInt(document.getElementById('fontSize').value) || 14,
            theme: this.getXtermTheme()
        });
        const fitAddon = new FitAddon.FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(terminalElement);
        fitAddon.fit();

        terminal.onData(data => {
            this.socket.emit('terminal-input', { sessionId, data });
        });

        this.sessions.set(sessionId, { terminal, fitAddon });
        this.setActiveSession(sessionId);
        this.updateSessionsTabs();
    }

    closeSession(sessionId) {
        const terminal = this.sessions.get(sessionId);
        if (terminal) {
            terminal.terminal.dispose();
            this.sessions.delete(sessionId);
            const terminalElement = document.getElementById(`terminal-${sessionId}`);
            if (terminalElement) terminalElement.remove();
            if (this.activeSessionId === sessionId) {
                this.activeSessionId = null;
                this.showNoSession();
            }
            this.updateSessionsTabs();
        }
    }

    setActiveSession(sessionId) {
        this.activeSessionId = sessionId;

        this.sessions.forEach(({ terminal }, id) => {
            const terminalElement = document.getElementById(`terminal-${id}`);
            if (terminalElement) {
                if (id === sessionId) {
                    terminalElement.classList.add('active');
                    terminal.focus();
                    this.sessions.get(id).fitAddon.fit();
                } else {
                    terminalElement.classList.remove('active');
                }
            }
        });

        this.updateSessionsTabs();
    }

    updateSessionsTabs() {
        const sessionTabs = document.getElementById('sessionTabs');
        sessionTabs.innerHTML = '';

        this.sessions.forEach((_, id) => {
            const tab = document.createElement('button');
            tab.classList.add('session-tab');
            if (id === this.activeSessionId) tab.classList.add('active');
            tab.textContent = `Session ${id}`;
            tab.addEventListener('click', () => this.setActiveSession(id));

            const closeBtn = document.createElement('button');
            closeBtn.classList.add('close-btn');
            closeBtn.innerHTML = '&times;';
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.socket.emit('close-session', id);
            });

            tab.appendChild(closeBtn);
            sessionTabs.appendChild(tab);
        });
    }

    showNoSession() {
        const noSessionElement = document.getElementById('noSession');
        noSessionElement.style.display = 'flex';
    }

    showSessionsModal() {
        document.getElementById('sessionsModal').classList.add('show');
        this.requestSessionsList();
    }

    hideModals() {
        document.querySelectorAll('.modal').forEach(modal => modal.classList.remove('show'));
    }

    requestSessionsList() {
        this.socket.emit('get-sessions');
    }

    renderSessionsList(sessions) {
        const list = document.getElementById('sessionsList');
        list.innerHTML = '';
        sessions.forEach(session => {
            const item = document.createElement('div');
            item.classList.add('session-item');

            const info = document.createElement('div');
            info.classList.add('session-info');
            info.innerHTML = `<h4>Session ${session.id}</h4><small>Status: ${session.status}</small>`;

            const actions = document.createElement('div');
            actions.classList.add('session-actions');

            const resume = document.createElement('button');
            resume.classList.add('btn-small');
            resume.textContent = 'Resume';
            resume.addEventListener('click', () => {
                this.setActiveSession(session.id);
                this.hideModals();
            });

            const close = document.createElement('button');
            close.classList.add('btn-small', 'btn-danger');
            close.textContent = 'Close';
            close.addEventListener('click', () => {
                this.socket.emit('close-session', session.id);
            });

            actions.appendChild(resume);
            actions.appendChild(close);

            item.appendChild(info);
            item.appendChild(actions);

            list.appendChild(item);
        });
    }

    setupMobileKeyboard() {
        const keyboard = document.getElementById('mobileKeyboard');
        if (!keyboard) return;
        const keyButtons = keyboard.querySelectorAll('.key-btn');
        
        keyButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const key = e.target.dataset.key;
                this.handleVirtualKey(key);
            });
        });
    }

    handleVirtualKey(key) {
        const session = this.sessions.get(this.activeSessionId);
        if (!session || !session.terminal) return;

        switch(key) {
            case 'ctrl':
                this.ctrlPressed = !this.ctrlPressed;
                this.showKeyFeedback(this.ctrlPressed ? 'Ctrl activated' : 'Ctrl deactivated');
                break;
            case 'alt':
                this.altPressed = !this.altPressed;
                this.showKeyFeedback(this.altPressed ? 'Alt activated' : 'Alt deactivated');
                break;
            case 'tab':
                session.terminal.write('\t');
                break;
            case 'esc':
                session.terminal.write('\x1b');
                break;
            case 'home':
                session.terminal.write('\x1b[H');
                break;
            case 'enter':
                session.terminal.write('\r');
                break;
            case 'up':
                session.terminal.write('\x1b[A');
                break;
            case 'down':
                session.terminal.write('\x1b[B');
                break;
            case 'left':
                session.terminal.write('\x1b[D');
                break;
            case 'right':
                session.terminal.write('\x1b[C');
                break;
            case 'paste':
                this.pasteFromClipboard();
                break;
        }
    }

    async pasteFromClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            const session = this.sessions.get(this.activeSessionId);
            if (session && session.terminal) {
                session.terminal.write(text);
            }
        } catch (err) {
            console.error('Failed to paste:', err);
            this.showKeyFeedback('Paste failed');
        }
    }

    showKeyFeedback(message) {
        const feedback = document.createElement('div');
        feedback.textContent = message;
        feedback.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 255, 65, 0.9);
            color: #000;
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: bold;
            z-index: 9999;
            pointer-events: none;
        `;

        document.body.appendChild(feedback);

        setTimeout(() => {
            feedback.remove();
        }, 1000);
    }

    updateConnectionStatus(status) {
        const statusEl = document.getElementById('connectionStatus');
        statusEl.innerHTML = '';
        const span = document.createElement('span');
        span.classList.remove('status-connected', 'status-disconnected', 'status-connecting');

        switch(status) {
            case 'connected':
                span.classList.add('status-connected');
                span.textContent = 'Connected';
                break;
            case 'disconnected':
                span.classList.add('status-disconnected');
                span.textContent = 'Disconnected';
                break;
            default:
                span.classList.add('status-connecting');
                span.textContent = 'Connecting...';
        }

        statusEl.appendChild(span);
    }
}

// Initialize app on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new TerminalApp();
});
