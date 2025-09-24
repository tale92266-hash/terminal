class AdvancedTerminalApp {
    constructor() {
        this.socket = null;
        this.sessions = new Map();
        this.activeSessionId = null;
        this.fitAddons = new Map();
        this.webLinksAddons = new Map();
        this.keyboardVisible = true;
        this.selectedText = '';
        this.clipboardText = '';
        
        this.init();
    }

    init() {
        this.connectSocket();
        this.setupEventListeners();
        this.loadSettings();
        this.startClock();
        this.updateSessionCount();
        this.adjustViewport();
    }

    connectSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.updateConnectionStatus('connected');
            this.showToast('Connected to server', 'success');
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.updateConnectionStatus('disconnected');
            this.showToast('Disconnected from server', 'error');
        });

        this.socket.on('session-created', ({ sessionId }) => {
            this.createTerminalSession(sessionId);
            this.hideLoadingSpinner();
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

        document.getElementById('menuBtn').addEventListener('click', () => {
            this.toggleSlideMenu();
        });

        // Keyboard buttons
        document.querySelectorAll('.key-btn').forEach(btn => {
            btn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                this.handleVirtualKey(btn.dataset.key);
                this.vibrate();
            });
            
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleVirtualKey(btn.dataset.key);
            });
        });

        // Keyboard toggle
        document.getElementById('keyboardToggle').addEventListener('click', () => {
            this.toggleKeyboard();
        });

        // Selection popup buttons
        document.getElementById('copyBtn').addEventListener('click', () => {
            this.copySelection();
        });

        document.getElementById('pasteBtn').addEventListener('click', () => {
            this.pasteClipboard();
        });

        document.getElementById('selectAllBtn').addEventListener('click', () => {
            this.selectAll();
        });

        // Window resize
        window.addEventListener('resize', () => {
            this.adjustViewport();
            this.fitTerminals();
        });

        // Orientation change
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                this.adjustViewport();
                this.fitTerminals();
            }, 300);
        });

        // Touch events for better mobile experience
        document.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
        document.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
        
        // Long press for context menu
        let longPressTimer;
        document.addEventListener('touchstart', (e) => {
            if (e.target.closest('.terminal-instance')) {
                longPressTimer = setTimeout(() => {
                    this.showSelectionPopup(e);
                }, 500);
            }
        });

        document.addEventListener('touchend', () => {
            clearTimeout(longPressTimer);
        });

        // Prevent default behaviors on mobile
        document.addEventListener('touchmove', (e) => {
            if (e.target.closest('.keyboard-container')) {
                e.preventDefault();
            }
        }, { passive: false });
    }

    createNewSession() {
        this.showLoadingSpinner();
        this.socket.emit('create-session');
        this.vibrate();
    }

    createTerminalSession(sessionId) {
        // Create terminal with advanced options
        const terminal = new Terminal({
            cursorBlink: true,
            fontSize: parseInt(localStorage.getItem('fontSize') || '14'),
            fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
            theme: this.getTheme(localStorage.getItem('theme') || 'termux'),
            allowTransparency: true,
            scrollback: 10000,
            bellStyle: 'sound',
            convertEol: true,
            disableStdin: false,
            screenKeys: true,
            useFlowControl: true,
            tabStopWidth: 4
        });

        // Add fit addon
        const fitAddon = new FitAddon.FitAddon();
        terminal.loadAddon(fitAddon);

        // Add web links addon
        const webLinksAddon = new WebLinksAddon.WebLinksAddon();
        terminal.loadAddon(webLinksAddon);

        // Create terminal container
        const terminalDiv = document.createElement('div');
        terminalDiv.className = 'terminal-instance';
        terminalDiv.id = `terminal-${sessionId}`;
        
        document.getElementById('terminalWrapper').appendChild(terminalDiv);
        terminal.open(terminalDiv);
        
        // Enable text selection
        this.enableTextSelection(terminal, terminalDiv);

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
        this.webLinksAddons.set(sessionId, webLinksAddon);

        // Create tab
        this.createSessionTab(sessionId);
        
        // Switch to new session
        this.switchToSession(sessionId);
        
        // Hide no-session message
        document.getElementById('noSession').style.display = 'none';
        
        this.updateSessionCount();
        this.showToast('New session created', 'success');
    }

    createSessionTab(sessionId) {
        const tabsContainer = document.getElementById('sessionTabs');
        
        const tab = document.createElement('button');
        tab.className = 'session-tab';
        tab.id = `tab-${sessionId}`;
        tab.innerHTML = `
            <i class="fas fa-terminal"></i>
            Session ${this.sessions.size}
            <button class="close-btn" onclick="event.stopPropagation(); app.closeSession('${sessionId}')">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        tab.addEventListener('click', (e) => {
            if (!e.target.classList.contains('close-btn') && !e.target.classList.contains('fa-times')) {
                this.switchToSession(sessionId);
                this.vibrate();
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
        setTimeout(() => {
            const fitAddon = this.fitAddons.get(sessionId);
            if (fitAddon) {
                fitAddon.fit();
            }
        }, 100);
        
        this.hideSelectionPopup();
    }

    closeSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return;
        
        // Close terminal
        this.socket.emit('close-session', { sessionId });
        
        // Remove from DOM
        session.element.remove();
        const tabElement = document.getElementById(`tab-${sessionId}`);
        if (tabElement) {
            tabElement.remove();
        }
        
        // Clean up
        this.sessions.delete(sessionId);
        this.fitAddons.delete(sessionId);
        this.webLinksAddons.delete(sessionId);
        
        // Switch to another session if this was active
        if (this.activeSessionId === sessionId) {
            const remainingSessions = Array.from(this.sessions.keys());
            if (remainingSessions.length > 0) {
                this.switchToSession(remainingSessions[0]);
            } else {
                this.activeSessionId = null;
                document.getElementById('noSession').style.display = 'flex';
            }
        }
        
        this.updateSessionCount();
        this.showToast('Session closed', 'info');
        this.vibrate();
    }

    handleVirtualKey(key) {
        if (!this.activeSessionId) return;
        
        const session = this.sessions.get(this.activeSessionId);
        if (!session) return;
        
        let data = '';
        
        switch (key) {
            case 'Tab':
                data = '\t';
                break;
            case 'Enter':
                data = '\r';
                break;
            case 'Escape':
                data = '\x1b';
                break;
            case 'Ctrl+C':
                data = '\x03';
                break;
            case 'Ctrl+Z':
                data = '\x1a';
                break;
            case 'Ctrl+D':
                data = '\x04';
                break;
            case 'Ctrl+L':
                data = '\x0c';
                break;
            case 'Ctrl+V':
                this.pasteClipboard();
                return;
            case 'ArrowUp':
                data = '\x1b[A';
                break;
            case 'ArrowDown':
                data = '\x1b[B';
                break;
            case 'ArrowRight':
                data = '\x1b[C';
                break;
            case 'ArrowLeft':
                data = '\x1b[D';
                break;
            case 'Home':
                data = '\x1b[H';
                break;
            case 'End':
                data = '\x1b[F';
                break;
            case 'F1':
                data = '\x1bOP';
                break;
            case 'F2':
                data = '\x1bOQ';
                break;
            case 'F3':
                data = '\x1bOR';
                break;
            case 'F4':
                data = '\x1bOS';
                break;
            default:
                data = key;
        }
        
        if (data) {
            this.socket.emit('terminal-input', { 
                sessionId: this.activeSessionId, 
                data 
            });
        }
    }

    enableTextSelection(terminal, terminalDiv) {
        let isSelecting = false;
        let selectionStart = null;
        
        terminalDiv.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // Left click
                isSelecting = true;
                selectionStart = { x: e.clientX, y: e.clientY };
            }
        });

        terminalDiv.addEventListener('mousemove', (e) => {
            if (isSelecting) {
                // Handle text selection
                const selection = window.getSelection();
                if (selection.toString().length > 0) {
                    this.selectedText = selection.toString();
                    this.showSelectionPopup(e);
                }
            }
        });

        terminalDiv.addEventListener('mouseup', (e) => {
            if (isSelecting) {
                isSelecting = false;
                const selection = window.getSelection();
                if (selection.toString().length > 0) {
                    this.selectedText = selection.toString();
                    this.showSelectionPopup(e);
                } else {
                    this.hideSelectionPopup();
                }
            }
        });

        // Touch events for mobile
        let touchStartTime;
        terminalDiv.addEventListener('touchstart', (e) => {
            touchStartTime = Date.now();
        });

        terminalDiv.addEventListener('touchend', (e) => {
            const touchDuration = Date.now() - touchStartTime;
            if (touchDuration > 500) { // Long press
                this.showSelectionPopup(e);
            }
        });
    }

    showSelectionPopup(e) {
        const popup = document.getElementById('selectionPopup');
        popup.style.display = 'flex';
        
        // Position popup
        const rect = e.target.getBoundingClientRect();
        popup.style.top = `${rect.top + 50}px`;
        popup.style.right = '15px';
    }

    hideSelectionPopup() {
        document.getElementById('selectionPopup').style.display = 'none';
    }

    copySelection() {
        if (this.selectedText) {
            this.clipboardText = this.selectedText;
            navigator.clipboard.writeText(this.selectedText).then(() => {
                this.showToast('Text copied to clipboard', 'success');
            }).catch(() => {
                this.showToast('Copy failed', 'error');
            });
        }
        this.hideSelectionPopup();
        this.vibrate();
    }

    async pasteClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            if (text && this.activeSessionId) {
                this.socket.emit('terminal-input', {
                    sessionId: this.activeSessionId,
                     text
                });
                this.showToast('Text pasted', 'success');
            }
        } catch (err) {
            if (this.clipboardText && this.activeSessionId) {
                this.socket.emit('terminal-input', {
                    sessionId: this.activeSessionId,
                     this.clipboardText
                });
                this.showToast('Text pasted', 'success');
            }
        }
        this.hideSelectionPopup();
        this.vibrate();
    }

    selectAll() {
        if (this.activeSessionId) {
            const session = this.sessions.get(this.activeSessionId);
            if (session) {
                session.terminal.selectAll();
                this.selectedText = session.terminal.getSelection();
                this.showToast('All text selected', 'info');
            }
        }
        this.hideSelectionPopup();
        this.vibrate();
    }

    toggleKeyboard() {
        this.keyboardVisible = !this.keyboardVisible;
        const keyboard = document.getElementById('keyboardContainer');
        const toggle = document.getElementById('keyboardToggle');
        const icon = toggle.querySelector('i');
        
        if (this.keyboardVisible) {
            keyboard.style.transform = 'translateY(0)';
            icon.className = 'fas fa-chevron-down';
        } else {
            keyboard.style.transform = 'translateY(100%)';
            icon.className = 'fas fa-chevron-up';
        }
        
        setTimeout(() => {
            this.adjustViewport();
            this.fitTerminals();
        }, 300);
        
        this.vibrate();
    }

    adjustViewport() {
        const statusBar = document.querySelector('.status-bar');
        const header = document.querySelector('.header');
        const sessionTabs = document.querySelector('.session-tabs-container');
        const keyboard = document.getElementById('keyboardContainer');
        const terminalContainer = document.getElementById('terminalContainer');
        
        let availableHeight = window.innerHeight;
        availableHeight -= statusBar.offsetHeight;
        availableHeight -= header.offsetHeight;
        availableHeight -= sessionTabs.offsetHeight;
        
        if (this.keyboardVisible) {
            availableHeight -= keyboard.offsetHeight;
        }
        
        terminalContainer.style.height = `${availableHeight}px`;
    }

    fitTerminals() {
        this.fitAddons.forEach((fitAddon, sessionId) => {
            if (fitAddon && this.sessions.has(sessionId)) {
                setTimeout(() => {
                    try {
                        fitAddon.fit();
                        const session = this.sessions.get(sessionId);
                        if (session) {
                            this.socket.emit('resize-terminal', {
                                sessionId,
                                cols: session.terminal.cols,
                                rows: session.terminal.rows
                            });
                        }
                    } catch (e) {
                        console.warn('Fit terminal error:', e);
                    }
                }, 100);
            }
        });
    }

    updateSessionCount() {
        const count = this.sessions.size;
        const sessionCount = document.getElementById('sessionCount');
        sessionCount.textContent = `${count} session${count !== 1 ? 's' : ''}`;
    }

    startClock() {
        const updateTime = () => {
            const now = new Date();
            const timeString = now.toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit'
            });
            document.getElementById('currentTime').textContent = timeString;
        };
        
        updateTime();
        setInterval(updateTime, 1000);
    }

    updateConnectionStatus(status) {
        const indicator = document.getElementById('connectionIndicator');
        const dot = indicator.querySelector('.status-dot');
        const text = indicator.querySelector('span');
        
        switch (status) {
            case 'connected':
                dot.style.background = '#00ff41';
                text.textContent = 'ONLINE';
                break;
            case 'disconnected':
                dot.style.background = '#ff4444';
                text.textContent = 'OFFLINE';
                break;
            case 'connecting':
                dot.style.background = '#ffaa00';
                text.textContent = 'CONNECTING';
                break;
        }
    }

    getTheme(themeName) {
        const themes = {
            termux: {
                background: '#000000',
                foreground: '#ffffff',
                cursor: '#00ff41',
                selection: '#00ff4140',
                black: '#000000',
                red: '#ff5555',
                green: '#00ff41',
                yellow: '#ffff55',
                blue: '#5555ff',
                magenta: '#ff55ff',
                cyan: '#55ffff',
                white: '#ffffff'
            },
            matrix: {
                background: '#000000',
                foreground: '#00ff41',
                cursor: '#00ff41',
                selection: '#00ff4140'
            },
            ocean: {
                background: '#001122',
                foreground: '#aaddff',
                cursor: '#55aaff',
                selection: '#55aaff40'
            },
            sunset: {
                background: '#2d1b00',
                foreground: '#ffaa55',
                cursor: '#ff8833',
                selection: '#ff883340'
            },
            light: {
                background: '#ffffff',
                foreground: '#000000',
                cursor: '#000000',
                selection: '#00000040'
            }
        };
        
        return themes[themeName] || themes.termux;
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <i class="fas fa-${this.getToastIcon(type)}"></i>
            <span>${message}</span>
        `;
        
        const container = document.getElementById('toastContainer') || this.createToastContainer();
        container.appendChild(toast);
        
        setTimeout(() => toast.classList.add('show'), 100);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    createToastContainer() {
        const container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        container.style.cssText = `
            position: fixed;
            top: 80px;
            right: 15px;
            z-index: 1000;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;
        document.body.appendChild(container);
        return container;
    }

    getToastIcon(type) {
        const icons = {
            success: 'check-circle',
            error: 'exclamation-triangle',
            info: 'info-circle',
            warning: 'exclamation-circle'
        };
        return icons[type] || 'info-circle';
    }

    showLoadingSpinner() {
        let spinner = document.getElementById('loadingSpinner');
        if (!spinner) {
            spinner = document.createElement('div');
            spinner.id = 'loadingSpinner';
            spinner.className = 'loading-spinner';
            spinner.innerHTML = `
                <div class="spinner"></div>
                <p>Creating session...</p>
            `;
            spinner.style.cssText = `
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.8);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                z-index: 2000;
                color: #00ff41;
            `;
            document.body.appendChild(spinner);
        }
        spinner.style.display = 'flex';
    }

    hideLoadingSpinner() {
        const spinner = document.getElementById('loadingSpinner');
        if (spinner) {
            spinner.style.display = 'none';
        }
    }

    vibrate() {
        if ('vibrate' in navigator) {
            navigator.vibrate(50);
        }
    }

    handleTouchStart(e) {
        this.touchStartX = e.touches[0].clientX;
        this.touchStartY = e.touches[0].clientY;
    }

    handleTouchMove(e) {
        if (!this.touchStartX || !this.touchStartY) return;
        
        const touchEndX = e.touches[0].clientX;
        const touchEndY = e.touches[0].clientY;
        
        const diffX = this.touchStartX - touchEndX;
        const diffY = this.touchStartY - touchEndY;
        
        // Prevent scrolling in terminal area
        if (e.target.closest('.terminal-instance') && Math.abs(diffY) > Math.abs(diffX)) {
            // Allow vertical scrolling in terminal
            return;
        }
        
        // Horizontal swipe for tab switching
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
            const sessions = Array.from(this.sessions.keys());
            const currentIndex = sessions.indexOf(this.activeSessionId);
            
            if (diffX > 0 && currentIndex < sessions.length - 1) {
                // Swipe left - next session
                this.switchToSession(sessions[currentIndex + 1]);
            } else if (diffX < 0 && currentIndex > 0) {
                // Swipe right - previous session
                this.switchToSession(sessions[currentIndex - 1]);
            }
        }
    }

    loadSettings() {
        const fontSize = localStorage.getItem('fontSize') || '14';
        const theme = localStorage.getItem('theme') || 'termux';
        const showKeyboard = localStorage.getItem('showKeyboard') !== 'false';
        
        // Apply settings if elements exist
        const fontSizeEl = document.getElementById('fontSize');
        const themeEl = document.getElementById('theme');
        const showKeyboardEl = document.getElementById('showKeyboard');
        
        if (fontSizeEl) fontSizeEl.value = fontSize;
        if (themeEl) themeEl.value = theme;
        if (showKeyboardEl) showKeyboardEl.checked = showKeyboard;
        
        this.keyboardVisible = showKeyboard;
        
        // Update battery level
        if ('getBattery' in navigator) {
            navigator.getBattery().then((battery) => {
                const level = Math.round(battery.level * 100);
                document.getElementById('batteryLevel').textContent = `${level}%`;
            });
        }
    }

    showSessionsModal() {
        this.socket.emit('get-sessions');
        // Modal functionality would be implemented here
    }

    toggleSlideMenu() {
        // Slide menu functionality would be implemented here
    }
}

// Global functions
function createNewSession() {
    app.createNewSession();
}

function closeModal(modalId) {
    if (app.closeModal) {
        app.closeModal(modalId);
    }
}

// Initialize app
const app = new AdvancedTerminalApp();

// Handle back button on Android
window.addEventListener('popstate', (e) => {
    document.querySelectorAll('.modal.show').forEach(modal => {
        modal.classList.remove('show');
    });
});

// Service Worker for PWA capabilities
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then((registration) => {
            console.log('SW registered: ', registration);
        }).catch((registrationError) => {
            console.log('SW registration failed: ', registrationError);
        });
    });
}

// Add CSS for additional elements
const additionalCSS = `
.toast {
    background: #232d2d;
    color: #00ff41;
    padding: 12px 16px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 200px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    transform: translateX(100%);
    transition: transform 0.3s ease;
}

.toast.show {
    transform: translateX(0);
}

.toast-success { border-left: 3px solid #00ff41; }
.toast-error { border-left: 3px solid #ff4444; }
.toast-info { border-left: 3px solid #5555ff; }
.toast-warning { border-left: 3px solid #ffaa00; }

.spinner {
    border: 3px solid #333;
    border-top: 3px solid #00ff41;
    border-radius: 50%;
    width: 40px;
    height: 40px;
    animation: spin 1s linear infinite;
    margin-bottom: 15px;
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

.keyboard-container {
    transition: transform 0.3s ease;
}
`;

// Add the additional CSS to the page
const styleSheet = document.createElement('style');
styleSheet.textContent = additionalCSS;
document.head.appendChild(styleSheet);
