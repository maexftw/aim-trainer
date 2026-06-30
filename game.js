/**
 * Milbona07 LoL Mechanical Trainer - Core Game Engine
 * Manages game loop, canvas rendering, pointer lock, state machine, and calibration pipeline.
 */

// Initialize Audio Context for synthesized feedback
let audioCtx = null;
function playSound(freq, duration, type = 'sine') {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        osc.type = type;
        osc.frequency.value = freq;
        
        gainNode.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
        
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
        console.warn("Audio Context blocked or unsupported:", e);
    }
}

// Special coin pickup sound arpeggio (C6 then E6)
function playGoldSound() {
    playSound(1046.50, 0.05, 'sine'); // C6
    setTimeout(() => {
        playSound(1318.51, 0.15, 'sine'); // E6
    }, 50);
}

// Game State Definitions
const GameMode = {
    CS: 'cs',
    KITING: 'kiting',
    DODGE: 'dodge'
};

const GameState = {
    IDLE: 'idle',
    PLAYING: 'playing',
    PAUSED: 'paused',
    FINISHED: 'finished'
};

const App = {
    // Game configurations
    sessionDuration: 30, // seconds
    calibrationSteps: [0.6, 0.8, 1.0, 1.2, 1.4],
    
    // Core states
    currentMode: GameMode.CS,
    state: GameState.IDLE,
    timer: 0,
    timerInterval: null,
    isCalibrationMode: false,
    
    // Canvas & Pointer Lock variables
    canvas: null,
    ctx: null,
    virtualCursor: { x: 0, y: 0 },
    
    // Tracking active session data
    activeSession: {
        multiplier: 1.0,
        dpi: 12000,
        targetsTracked: [], // list of clicks/paths
        startTime: 0,
    },
    
    // Calibration run storage
    calibrationRuns: [], // array of completed session metrics
    currentCalibrationStep: 0,
    optimalMultiplier: 1.0,

    // --- GAME MODE SPECIFIC VARIABLES ---
    
    // Last Hitting (CS) Mode
    minions: [],
    spawnTimer: 0,
    minionsSpawnedCount: 0,
    csScore: 0,
    missedMinionsCount: 0,
    tooEarlyCount: 0,
    floatingTexts: [], // floating text elements: {x, y, text, color, life}

    // Kiting Mode
    kitingTargets: {
        enemy: { x: 0, y: 0, radius: 26 },
        ground: { x: 0, y: 0, radius: 20 }
    },
    activeKitingTarget: 'enemy', // 'enemy' (red) or 'ground' (green)
    kitingClicks: [], // times of successful clicks
    rhythmIntervals: [],
    
    // Dodge Mode
    player: {
        x: 0,
        y: 0,
        targetX: 0,
        targetY: 0,
        radius: 14,
        hp: 100,
        maxHp: 100,
        speed: 4.5,
        flashRedTime: 0
    },
    projectiles: [], // {x, y, vx, vy, radius, warning: true/false, warningTimer: 0, targetX, targetY}
    projectileSpawnTimer: 0,
    skillshotsSpawnedCount: 0,
    hitsTakenCount: 0,
    dodgesCount: 0,

    // visual click feedback indicator (expanding circle on ground)
    clickFeedback: { x: 0, y: 0, radius: 0, maxRadius: 20, active: false, color: 'rgba(10, 203, 230, 0.6)' },

    // Setup and initialization
    init() {
        this.canvas = document.getElementById('aim-canvas');
        this.ctx = this.canvas.getContext('2d');
        
        this.setupEventListeners();
        this.resizeCanvas();
        this.loadProfileSettings();
        this.renderHistoryTable();
        
        // Show initial layout
        this.switchView('view-game');
        this.setUIMode(GameMode.CS);
    },

    setupEventListeners() {
        window.addEventListener('resize', () => this.resizeCanvas());

        // Navigation Sidebar
        document.getElementById('btn-mode-cs').addEventListener('click', () => {
            this.isCalibrationMode = false;
            this.setUIMode(GameMode.CS);
            this.switchView('view-game');
        });
        document.getElementById('btn-mode-kiting').addEventListener('click', () => {
            this.isCalibrationMode = false;
            this.setUIMode(GameMode.KITING);
            this.switchView('view-game');
        });
        document.getElementById('btn-mode-dodge').addEventListener('click', () => {
            this.isCalibrationMode = false;
            this.setUIMode(GameMode.DODGE);
            this.switchView('view-game');
        });
        document.getElementById('btn-mode-security').addEventListener('click', () => {
            this.switchView('view-security');
        });
        document.getElementById('btn-mode-history').addEventListener('click', () => {
            this.switchView('view-history');
            this.renderHistoryTable();
        });

        // Settings Input Listeners
        const inputDpi = document.getElementById('input-dpi');
        const inputTrainerSens = document.getElementById('input-trainer-sens');
        const inputSens = document.getElementById('input-sens');
        const checkRawInput = document.getElementById('check-rawinput');
        const selectGame = document.getElementById('select-game');

        const updateProfile = () => {
            StorageController.saveProfile(inputDpi.value, inputSens.value, inputTrainerSens.value);
            this.updateSensBadge();
            if (this.optimalMultiplier) {
                this.updateGameConversionUI(this.optimalMultiplier);
            }
        };
        inputDpi.addEventListener('change', updateProfile);
        inputTrainerSens.addEventListener('change', updateProfile);
        inputSens.addEventListener('change', updateProfile);

        checkRawInput.addEventListener('change', () => {
            if (!checkRawInput.checked) {
                alert("Sicherheits-Notiz: Windows-Zeigerbeschleunigung verfälscht deine physikalische Bewegung. Es wird dringend empfohlen, diese Option deaktiviert zu lassen.");
            }
        });

        // Start button on Canvas Overlay
        document.getElementById('btn-start-game').addEventListener('click', () => {
            this.isCalibrationMode = false;
            this.requestLockAndStart();
        });

        // Calibrate button on Canvas Overlay
        document.getElementById('btn-calibrate-game').addEventListener('click', () => {
            this.isCalibrationMode = true;
            document.getElementById('calibration-bar-container').style.display = 'block';
            this.currentCalibrationStep = 0;
            this.calibrationRuns = [];
            this.updateCalibrationUI();
            this.requestLockAndStart();
        });

        // Pointer Lock state changes
        document.addEventListener('pointerlockchange', () => this.handlePointerLockChange());
        document.addEventListener('mozpointerlockchange', () => this.handlePointerLockChange());

        // Mouse inputs
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));

        // Result screen buttons
        document.getElementById('btn-apply-sens').addEventListener('click', () => {
            const optMultiplier = this.optimalMultiplier;
            if (optMultiplier) {
                const inputTrainerSens = document.getElementById('input-trainer-sens');
                const currentTrainerSens = parseFloat(inputTrainerSens.value) || 1.0;
                const newTrainerSens = currentTrainerSens * optMultiplier;
                
                inputTrainerSens.value = newTrainerSens.toFixed(2);
                
                const inputSens = document.getElementById('input-sens');
                const currentSens = parseFloat(inputSens.value) || 50;
                // Round to nearest integer for LoL sensitivity
                inputSens.value = Math.max(0, Math.min(100, Math.round(currentSens * optMultiplier)));
                
                updateProfile();
                alert(`Trainer-Mauseinstellungen angepasst!\n- Trainer-Sens: ${newTrainerSens.toFixed(2)}x\n- LoL In-Game Sens: ${inputSens.value}`);
                this.isCalibrationMode = false;
                this.setUIMode(this.currentMode);
                this.switchView('view-game');
            }
        });

        document.getElementById('btn-copy-prompt').addEventListener('click', () => {
            const promptArea = document.createElement('textarea');
            promptArea.value = this.generatedDeepseekPromptText || "";
            document.body.appendChild(promptArea);
            promptArea.select();
            document.execCommand('copy');
            document.body.removeChild(promptArea);
            
            const btn = document.getElementById('btn-copy-prompt');
            const oldText = btn.innerText;
            btn.innerText = "📋 Kopiert!";
            btn.style.borderColor = "var(--accent-green)";
            setTimeout(() => {
                btn.innerText = oldText;
                btn.style.borderColor = "var(--border-color)";
            }, 2000);
        });

        document.getElementById('btn-clear-history').addEventListener('click', () => {
            if (confirm("Möchtest du die gesamte Historie unwiderruflich löschen?")) {
                StorageController.clearHistory();
                this.renderHistoryTable();
            }
        });
    },

    resizeCanvas() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
        
        this.ctx.scale(dpr, dpr);
        
        this.virtualCursor.x = rect.width / 2;
        this.virtualCursor.y = rect.height / 2;

        if (this.state === GameState.PLAYING) {
            // Reposition targets if out of bounds after resize
            if (this.currentMode === GameMode.KITING) {
                this.resetKitingTargets(rect.width, rect.height);
            }
        }
    },

    loadProfileSettings() {
        const profile = StorageController.loadProfile();
        document.getElementById('input-dpi').value = profile.dpi || 12000;
        document.getElementById('input-trainer-sens').value = profile.trainerMultiplier || 1.0;
        document.getElementById('input-sens').value = profile.multiplier || 50;
        this.updateSensBadge();
    },

    updateSensBadge() {
        const dpi = parseInt(document.getElementById('input-dpi').value) || 12000;
        const trainerSens = parseFloat(document.getElementById('input-trainer-sens').value) || 1.0;
        const gameSens = parseInt(document.getElementById('input-sens').value) || 50;
        const edpi = dpi * gameSens;
        document.getElementById('current-sens-badge').innerText = `Trainer-Sens: ${trainerSens.toFixed(1)}x | LoL-eDPI: ${edpi} (Sens ${gameSens} bei ${dpi} DPI)`;
    },

    setUIMode(mode) {
        this.currentMode = mode;
        
        document.getElementById('btn-mode-cs').classList.toggle('active', mode === GameMode.CS);
        document.getElementById('btn-mode-kiting').classList.toggle('active', mode === GameMode.KITING);
        document.getElementById('btn-mode-dodge').classList.toggle('active', mode === GameMode.DODGE);

        const overlayTitle = document.getElementById('overlay-title');
        const overlayDesc = document.getElementById('overlay-desc');
        const calBar = document.getElementById('calibration-bar-container');

        if (!this.isCalibrationMode) {
            calBar.style.display = 'none';
        }

        if (mode === GameMode.CS) {
            overlayTitle.innerText = "Last Hitting Trainer 🌾";
            overlayDesc.innerHTML = "Lerne das perfekte CSing (Creep Score). Spawnt Minions, deren Leben kontinuierlich abnimmt.<br>Klicke sie <strong>nur</strong> an, wenn ihr Lebensbalken im goldenen Bereich (<20% HP) liegt, um Gold zu erhalten.";
        } else if (mode === GameMode.KITING) {
            overlayTitle.innerText = "Kiting / Attack-Move Trainer 🏃";
            overlayDesc.innerHTML = "Trainiere deine ADC-Mechaniken. Wechsle so schnell und rhythmisch wie möglich ab:<br>Klicke den roten gegnerischen Champion an, dann klicke auf den grünen Ausweichpunkt am Boden.";
        } else if (mode === GameMode.DODGE) {
            overlayTitle.innerText = "Skillshot Dodger 🛡️";
            overlayDesc.innerHTML = "Bewege deinen blauen Champion-Kreis über Klicks auf den Boden (wie in LoL).<br>Weiche den roten, linienförmigen Skillshot-Projektilen aus. Überlebe so lange wie möglich!";
        }

        this.endSession();
    },

    updateCalibrationUI() {
        if (!this.isCalibrationMode) return;
        
        const step = this.currentCalibrationStep + 1;
        const mult = this.calibrationSteps[this.currentCalibrationStep];
        
        document.getElementById('cal-current-step').innerText = step;
        document.getElementById('cal-step-sens').innerText = `Simulierter Faktor: ${mult}x`;
        document.getElementById('cal-progress-fill').style.width = `${(step / this.calibrationSteps.length) * 100}%`;
    },

    switchView(viewId) {
        document.querySelectorAll('.screen-view').forEach(view => {
            view.classList.toggle('active', view.id === viewId);
        });
    },

    requestLockAndStart() {
        this.canvas.requestPointerLock = this.canvas.requestPointerLock || 
                                        this.canvas.mozRequestPointerLock;
        this.canvas.requestPointerLock();
    },

    handlePointerLockChange() {
        const isLocked = document.pointerLockElement === this.canvas || 
                         document.mozPointerLockElement === this.canvas;

        if (isLocked) {
            this.hideOverlay();
            if (this.state !== GameState.PLAYING) {
                this.startSession();
            }
        } else {
            this.showOverlay();
            if (this.state === GameState.PLAYING) {
                this.pauseSession();
            }
        }
    },

    showOverlay() {
        const overlay = document.getElementById('canvas-overlay');
        const title = document.getElementById('overlay-title');
        const desc = document.getElementById('overlay-desc');
        const btn = document.getElementById('btn-start-game');
        const btnCal = document.getElementById('btn-calibrate-game');

        overlay.style.opacity = '1';
        overlay.style.pointerEvents = 'all';

        if (this.state === GameState.PAUSED) {
            title.innerText = "Pausiert";
            desc.innerText = "Das Training wurde pausiert. Klicke auf 'Fortsetzen', um die Maus wieder zu sperren.";
            btn.innerText = "Fortsetzen";
            btnCal.style.display = 'none';
        } else if (this.state === GameState.FINISHED) {
            title.innerText = "Runde Beendet!";
            btnCal.style.display = this.isCalibrationMode ? 'none' : 'block';
            
            const metrics = PerformanceAnalyzer.calculateSessionMetrics(
                this.activeSession.targetsTracked, 
                this.sessionDuration,
                this.currentMode
            );
            
            let resultHTML = `<strong>Modus:</strong> ${this.getModeName(this.currentMode)}<br>`;
            if (this.currentMode === GameMode.CS) {
                resultHTML += `
                    <strong>Creep Score (CS):</strong> ${metrics.extraMetrics.scoreText} minion hits<br>
                    <strong>Treffgenauigkeit:</strong> ${metrics.extraMetrics.precisionText} (${metrics.extraMetrics.precisionSub})<br>
                    <strong>Fehlerquote:</strong> ${metrics.extraMetrics.errorText} (${metrics.extraMetrics.errorSub})<br>
                `;
            } else if (this.currentMode === GameMode.KITING) {
                resultHTML += `
                    <strong>Rhythmus-Konsistenz:</strong> ${metrics.extraMetrics.efficiencyText}<br>
                    <strong>Transitions:</strong> ${metrics.extraMetrics.scoreText}<br>
                    <strong>Klick-Genauigkeit:</strong> ${metrics.precision}%<br>
                `;
            } else if (this.currentMode === GameMode.DODGE) {
                resultHTML += `
                    <strong>Überlebenszeit:</strong> ${metrics.extraMetrics.scoreText}<br>
                    <strong>Ausweich-Quote:</strong> ${metrics.extraMetrics.precisionText}<br>
                    <strong>Einschläge:</strong> ${metrics.extraMetrics.errorText}<br>
                `;
            }
            
            desc.innerHTML = resultHTML;
            btn.innerText = this.isCalibrationMode && this.currentCalibrationStep < this.calibrationSteps.length 
                ? "Nächste Kalibrierungs-Phase starten" 
                : "Erneut Starten";
        } else {
            btnCal.style.display = 'block';
        }
    },

    getModeName(mode) {
        if (mode === GameMode.CS) return "Last Hitting";
        if (mode === GameMode.KITING) return "Kiting (Attack-Move)";
        if (mode === GameMode.DODGE) return "Skillshot Dodger";
        return "";
    },

    hideOverlay() {
        const overlay = document.getElementById('canvas-overlay');
        overlay.style.opacity = '0';
        overlay.style.pointerEvents = 'none';
    },

    startSession() {
        const profile = StorageController.loadProfile();
        let activeMultiplier = parseFloat(profile.trainerMultiplier) || 1.0;
        
        if (this.isCalibrationMode) {
            activeMultiplier = (parseFloat(profile.trainerMultiplier) || 1.0) * this.calibrationSteps[this.currentCalibrationStep];
        }

        this.state = GameState.PLAYING;
        
        this.activeSession = {
            mode: this.currentMode,
            multiplier: activeMultiplier,
            dpi: parseInt(profile.dpi) || 12000,
            targetsTracked: [],
            startTime: performance.now()
        };

        const rect = this.canvas.getBoundingClientRect();
        this.virtualCursor.x = rect.width / 2;
        this.virtualCursor.y = rect.height / 2;

        // Reset Mode Specific variables
        this.floatingTexts = [];
        this.clickFeedback.active = false;

        if (this.currentMode === GameMode.CS) {
            this.minions = [];
            this.spawnTimer = 0;
            this.minionsSpawnedCount = 0;
            this.csScore = 0;
            this.missedMinionsCount = 0;
            this.tooEarlyCount = 0;
            this.spawnMinion();
        } else if (this.currentMode === GameMode.KITING) {
            this.kitingClicks = [];
            this.rhythmIntervals = [];
            this.activeKitingTarget = 'enemy';
            this.resetKitingTargets(rect.width, rect.height);
        } else if (this.currentMode === GameMode.DODGE) {
            this.player.x = rect.width / 2;
            this.player.y = rect.height / 2;
            this.player.targetX = this.player.x;
            this.player.targetY = this.player.y;
            this.player.hp = 100;
            this.player.flashRedTime = 0;
            
            this.projectiles = [];
            this.projectileSpawnTimer = 0;
            this.skillshotsSpawnedCount = 0;
            this.hitsTakenCount = 0;
            this.dodgesCount = 0;
        }

        this.timer = this.sessionDuration;
        document.getElementById('timer-display').innerText = `${this.timer.toFixed(1)}s`;
        document.getElementById('game-status-badge').innerText = "Live";
        document.getElementById('game-status-badge').className = "badge active";
        
        clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => {
            this.timer -= 0.1;
            if (this.timer <= 0) {
                this.timer = 0;
                this.endSession();
            }
            document.getElementById('timer-display').innerText = `${this.timer.toFixed(1)}s`;
        }, 100);

        this.gameLoop();
    },

    pauseSession() {
        this.state = GameState.PAUSED;
        clearInterval(this.timerInterval);
        document.getElementById('game-status-badge').innerText = "Pause";
        document.getElementById('game-status-badge').className = "badge";
    },

    endSession() {
        const wasPlaying = this.state === GameState.PLAYING || this.state === GameState.PAUSED;
        this.state = GameState.FINISHED;
        clearInterval(this.timerInterval);
        document.getElementById('game-status-badge').innerText = "Beendet";
        document.getElementById('game-status-badge').className = "badge";

        if (document.pointerLockElement === this.canvas) {
            document.exitPointerLock();
        }

        if (wasPlaying) {
            const metrics = PerformanceAnalyzer.calculateSessionMetrics(
                this.activeSession.targetsTracked, 
                this.sessionDuration,
                this.currentMode
            );

            // Finalized score calculation
            let sessionScore = 0;
            if (this.currentMode === GameMode.CS) {
                sessionScore = this.csScore * 100;
            } else if (this.currentMode === GameMode.KITING) {
                sessionScore = metrics.totalHits * 50;
            } else if (this.currentMode === GameMode.DODGE) {
                sessionScore = Math.round((this.sessionDuration - this.timer) * 10) + (this.dodgesCount * 50);
            }

            // Trigger success sound arpeggio
            playGoldSound();

            if (this.isCalibrationMode) {
                this.calibrationRuns.push({
                    multiplier: this.activeSession.multiplier,
                    throughput: metrics.avgThroughput,
                    precision: metrics.precision,
                    overshootRate: metrics.overshootRate,
                    metrics: metrics
                });

                this.currentCalibrationStep++;
                
                if (this.currentCalibrationStep >= this.calibrationSteps.length) {
                    this.processCalibrationResults();
                } else {
                    this.updateCalibrationUI();
                    this.showOverlay();
                }
            } else {
                const profile = StorageController.loadProfile();
                const entry = {
                    date: new Date().toLocaleString('de-DE'),
                    mode: this.getModeName(this.currentMode),
                    dpi: profile.dpi,
                    multiplier: profile.trainerMultiplier,
                    edpi: profile.dpi * profile.multiplier,
                    score: sessionScore,
                    precision: this.currentMode === GameMode.CS ? metrics.extraMetrics.scoreText + " CS" : `${metrics.precision}%`,
                    reactionTime: `${metrics.avgReactionTime} ms`,
                    throughput: `${metrics.avgThroughput} bits/s`
                };
                StorageController.saveRunEntry(entry);
                this.showOverlay();
                this.updateDashboardMetrics(metrics);
            }
        }
    },

    spawnMinion() {
        const rect = this.canvas.getBoundingClientRect();
        const radius = 22;
        const padding = radius * 3;
        
        const minion = {
            id: Math.random(),
            x: padding + Math.random() * (rect.width - padding * 2),
            y: padding + Math.random() * (rect.height - padding * 2),
            radius: radius,
            maxHp: 100,
            hp: 100,
            // Health decays in 4 to 8 seconds
            decayRate: 15 + Math.random() * 15, // hp units per second
            spawnTime: performance.now(),
            startX: this.virtualCursor.x,
            startY: this.virtualCursor.y,
            currentPath: []
        };
        
        this.minions.push(minion);
        this.minionsSpawnedCount++;
    },

    resetKitingTargets(width, height) {
        const padding = 60;
        // Enemy spawns on left or right half
        this.kitingTargets.enemy.x = padding + Math.random() * (width / 2 - padding);
        this.kitingTargets.enemy.y = padding + Math.random() * (height - padding * 2);

        // Ground target spawns on the other half
        this.kitingTargets.ground.x = width / 2 + Math.random() * (width / 2 - padding * 2);
        this.kitingTargets.ground.y = padding + Math.random() * (height - padding * 2);
        
        this.activeKitingTarget = 'enemy';
    },

    spawnSkillshot() {
        const rect = this.canvas.getBoundingClientRect();
        const radius = 18;
        
        // Spawn randomly from borders
        let startX, startY, targetX, targetY;
        const border = Math.floor(Math.random() * 4); // 0=Top, 1=Right, 2=Bottom, 3=Left

        if (border === 0) {
            startX = Math.random() * rect.width;
            startY = -radius;
        } else if (border === 1) {
            startX = rect.width + radius;
            startY = Math.random() * rect.height;
        } else if (border === 2) {
            startX = Math.random() * rect.width;
            startY = rect.height + radius;
        } else {
            startX = -radius;
            startY = Math.random() * rect.height;
        }

        // Aim at player's current location with a small error
        targetX = this.player.x + (Math.random() - 0.5) * 80;
        targetY = this.player.y + (Math.random() - 0.5) * 80;

        const dx = targetX - startX;
        const dy = targetY - startY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        const speed = 4.0 + Math.random() * 3.5;
        const vx = (dx / dist) * speed;
        const vy = (dy / dist) * speed;

        const p = {
            x: startX,
            y: startY,
            vx: vx,
            vy: vy,
            radius: radius,
            warning: true,
            warningTimer: 45, // frames warning line is drawn before movement
            originX: startX,
            originY: startY,
            targetX: targetX + (dx / dist) * 1000, // extend line far
            targetY: targetY + (dy / dist) * 1000
        };

        this.projectiles.push(p);
        this.skillshotsSpawnedCount++;
    },

    handleMouseMove(e) {
        if (this.state !== GameState.PLAYING) return;

        const rawX = e.movementX || e.mozMovementX || 0;
        const rawY = e.movementY || e.mozMovementY || 0;
        
        // Apply Trainer Sens multiplier
        this.virtualCursor.x += rawX * this.activeSession.multiplier;
        this.virtualCursor.y += rawY * this.activeSession.multiplier;

        const rect = this.canvas.getBoundingClientRect();
        this.virtualCursor.x = Math.max(0, Math.min(rect.width, this.virtualCursor.x));
        this.virtualCursor.y = Math.max(0, Math.min(rect.height, this.virtualCursor.y));

        // Log paths
        if (this.currentMode === GameMode.CS) {
            this.minions.forEach(m => {
                m.currentPath.push({ x: this.virtualCursor.x, y: this.virtualCursor.y, t: performance.now() });
            });
        } else if (this.currentMode === GameMode.KITING) {
            this.currentPath.push({ x: this.virtualCursor.x, y: this.virtualCursor.y, t: performance.now() });
        }
    },

    handleMouseDown(e) {
        if (this.state !== GameState.PLAYING) return;

        const clickX = this.virtualCursor.x;
        const clickY = this.virtualCursor.y;

        // Visual click feedback
        this.clickFeedback = {
            x: clickX,
            y: clickY,
            radius: 1,
            maxRadius: 18,
            active: true,
            color: 'rgba(10, 203, 230, 0.7)' // cyan default
        };

        if (this.currentMode === GameMode.CS) {
            // Check minions
            let clickRegistered = false;
            
            for (let i = this.minions.length - 1; i >= 0; i--) {
                const m = this.minions[i];
                const dist = Math.sqrt((clickX - m.x) ** 2 + (clickY - m.y) ** 2);
                
                if (dist <= m.radius) {
                    clickRegistered = true;
                    // Check health
                    if (m.hp <= 20) {
                        // SUCCESSFUL LAST HIT!
                        this.csScore++;
                        playGoldSound();
                        
                        // Floating Gold text
                        this.floatingTexts.push({ x: m.x, y: m.y - 10, text: "+20g", color: '#c8aa6e', life: 40 });
                        
                        // Log metrics entry
                        this.activeSession.targetsTracked.push({
                            spawnTime: m.spawnTime,
                            clickTime: performance.now(),
                            targetX: m.x,
                            targetY: m.y,
                            targetRadius: m.radius,
                            startX: m.startX,
                            startY: m.startY,
                            isHit: true,
                            tooEarly: false,
                            missed: false,
                            spawnedMinions: this.minionsSpawnedCount,
                            cursorPath: [...m.currentPath]
                        });

                        // Remove minion
                        this.minions.splice(i, 1);
                    } else {
                        // CLICKED TOO EARLY (Denial Failure)
                        this.tooEarlyCount++;
                        playSound(180, 0.15, 'sawtooth'); // Error sound
                        this.floatingTexts.push({ x: m.x, y: m.y - 10, text: "ZU FRÜH", color: '#ef4444', life: 40 });
                        
                        // Log early click
                        this.activeSession.targetsTracked.push({
                            spawnTime: m.spawnTime,
                            clickTime: performance.now(),
                            targetX: m.x,
                            targetY: m.y,
                            targetRadius: m.radius,
                            startX: m.startX,
                            startY: m.startY,
                            isHit: false,
                            tooEarly: true,
                            missed: false,
                            spawnedMinions: this.minionsSpawnedCount,
                            cursorPath: [...m.currentPath]
                        });
                        
                        // Flash HP bar red
                        m.flashRed = 10; 
                    }
                    break; // Only click one minion at a time
                }
            }
        } else if (this.currentMode === GameMode.KITING) {
            const now = performance.now();
            this.clickFeedback.color = this.activeKitingTarget === 'enemy' ? 'rgba(239, 68, 68, 0.7)' : 'rgba(16, 185, 129, 0.7)';
            
            const target = this.activeKitingTarget === 'enemy' ? this.kitingTargets.enemy : this.kitingTargets.ground;
            const dist = Math.sqrt((clickX - target.x) ** 2 + (clickY - target.y) ** 2);
            
            const isHit = dist <= target.radius;

            if (isHit) {
                // Successful transition click
                if (this.activeKitingTarget === 'enemy') {
                    playSound(880, 0.05, 'sine'); // Attack beep
                    this.activeKitingTarget = 'ground';
                } else {
                    playSound(1200, 0.02, 'sine'); // Move tick
                    this.activeKitingTarget = 'enemy';
                    
                    // Reposition target once kiting cycle complete
                    const rect = this.canvas.getBoundingClientRect();
                    this.resetKitingTargets(rect.width, rect.height);
                }

                // Log click timings for rhythm analysis
                this.kitingClicks.push(now);
                if (this.kitingClicks.length > 1) {
                    const diff = now - this.kitingClicks[this.kitingClicks.length - 2];
                    this.rhythmIntervals.push(diff);
                }

                // Calculate rhythm deviation
                let deviation = 0;
                if (this.rhythmIntervals.length > 2) {
                    const avg = this.rhythmIntervals.reduce((a, b) => a + b, 0) / this.rhythmIntervals.length;
                    const variance = this.rhythmIntervals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / this.rhythmIntervals.length;
                    const stdDev = Math.sqrt(variance);
                    deviation = (stdDev / avg) * 100; // Coefficient of variation as %
                }

                this.activeSession.targetsTracked.push({
                    spawnTime: now - 300, // mock spawn
                    clickTime: now,
                    targetX: target.x,
                    targetY: target.y,
                    targetRadius: target.radius,
                    startX: clickX - 20,
                    startY: clickY - 20,
                    isHit: true,
                    kitingSuccess: true,
                    rhythmDeviation: Math.min(100, deviation),
                    cursorPath: [...this.currentPath]
                });

                this.currentPath = [{ x: clickX, y: clickY, t: now }];
            } else {
                // Clicked wrong location
                playSound(150, 0.15, 'sawtooth');
                
                this.activeSession.targetsTracked.push({
                    spawnTime: now - 300,
                    clickTime: now,
                    targetX: target.x,
                    targetY: target.y,
                    targetRadius: target.radius,
                    startX: clickX - 20,
                    startY: clickY - 20,
                    isHit: false,
                    kitingSuccess: false,
                    cursorPath: [...this.currentPath]
                });
            }
        } else if (this.currentMode === GameMode.DODGE) {
            // Set Player move target coordinates (LoL movement click)
            this.player.targetX = clickX;
            this.player.targetY = clickY;
            
            // Move feedback green arrow
            this.clickFeedback.color = 'rgba(16, 185, 129, 0.75)';
            playSound(1600, 0.02, 'sine'); // Quick click tick
        }
    },

    gameLoop() {
        if (this.state !== GameState.PLAYING) return;

        const rect = this.canvas.getBoundingClientRect();
        this.ctx.clearRect(0, 0, rect.width, rect.height);

        const now = performance.now();

        // --- UPDATE & RENDER GAME MODES ---

        if (this.currentMode === GameMode.CS) {
            // Spawn minion logic
            this.spawnTimer++;
            if (this.spawnTimer >= 100) { // roughly every 1.6s
                this.spawnMinion();
                this.spawnTimer = 0;
            }

            // Update & Render Minions
            for (let i = this.minions.length - 1; i >= 0; i--) {
                const m = this.minions[i];
                
                // Decay health
                m.hp -= m.decayRate / 60; // 60 fps approx
                
                if (m.hp <= 0) {
                    // Minion died without last hit! (Missed CS)
                    this.missedMinionsCount++;
                    playSound(130, 0.2, 'sawtooth'); // low buzz
                    this.floatingTexts.push({ x: m.x, y: m.y - 10, text: "VERPASST", color: '#6c6b5e', life: 40 });
                    
                    this.activeSession.targetsTracked.push({
                        spawnTime: m.spawnTime,
                        clickTime: now,
                        targetX: m.x,
                        targetY: m.y,
                        targetRadius: m.radius,
                        startX: m.startX,
                        startY: m.startY,
                        isHit: false,
                        tooEarly: false,
                        missed: true,
                        spawnedMinions: this.minionsSpawnedCount,
                        cursorPath: [...m.currentPath]
                    });

                    this.minions.splice(i, 1);
                    continue;
                }

                // Draw minion circle
                this.ctx.beginPath();
                this.ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
                this.ctx.fillStyle = m.flashRed > 0 ? 'rgba(239, 68, 68, 0.3)' : 'rgba(1, 10, 19, 0.8)';
                this.ctx.strokeStyle = m.hp <= 20 ? 'var(--accent-gold)' : 'rgba(255,255,255,0.2)';
                this.ctx.lineWidth = m.hp <= 20 ? 3 : 1.5;
                if (m.flashRed > 0) m.flashRed--;
                this.ctx.fill();
                this.ctx.stroke();

                // Draw minion staff (funny little visual detail)
                this.ctx.fillStyle = m.hp <= 20 ? 'var(--accent-gold)' : 'var(--text-secondary)';
                this.ctx.font = '11px Space Grotesk';
                this.ctx.textAlign = 'center';
                this.ctx.fillText("MINION", m.x, m.y + 4);

                // Draw health bar above minion
                const barW = m.radius * 2;
                const barH = 5;
                const bx = m.x - m.radius;
                const by = m.y - m.radius - 12;

                // background
                this.ctx.fillStyle = 'rgba(0,0,0,0.6)';
                this.ctx.fillRect(bx, by, barW, barH);

                // foreground health
                let hpColor = 'var(--accent-blue)';
                if (m.hp <= 20) {
                    hpColor = 'var(--accent-gold)'; // Gold/red in kill zone
                } else if (m.hp <= 50) {
                    hpColor = 'var(--accent-red)';
                }
                
                this.ctx.fillStyle = hpColor;
                this.ctx.fillRect(bx, by, barW * (m.hp / 100), barH);
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = 1;
                this.ctx.strokeRect(bx, by, barW, barH);
            }
        } 
        else if (this.currentMode === GameMode.KITING) {
            // Render Enemy Champion (Red)
            const enemy = this.kitingTargets.enemy;
            const isEnemyActive = this.activeKitingTarget === 'enemy';

            this.ctx.beginPath();
            this.ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
            this.ctx.fillStyle = isEnemyActive ? 'rgba(239, 68, 68, 0.15)' : 'rgba(0,0,0,0.4)';
            this.ctx.strokeStyle = isEnemyActive ? 'var(--accent-red)' : 'rgba(239, 68, 68, 0.2)';
            this.ctx.lineWidth = isEnemyActive ? 3 : 1.5;
            this.ctx.fill();
            this.ctx.stroke();

            this.ctx.fillStyle = isEnemyActive ? 'var(--text-primary)' : 'var(--text-muted)';
            this.ctx.font = '12px Space Grotesk';
            this.ctx.textAlign = 'center';
            this.ctx.fillText("CHAMPION", enemy.x, enemy.y + 4);

            if (isEnemyActive) {
                // Red glowing pointer brackets
                this.ctx.strokeStyle = 'var(--accent-red)';
                this.ctx.lineWidth = 2;
                this.ctx.strokeRect(enemy.x - enemy.radius - 4, enemy.y - enemy.radius - 4, enemy.radius * 2 + 8, enemy.radius * 2 + 8);
            }

            // Render Ground Target (Green)
            const ground = this.kitingTargets.ground;
            const isGroundActive = this.activeKitingTarget === 'ground';

            this.ctx.beginPath();
            this.ctx.arc(ground.x, ground.y, ground.radius, 0, Math.PI * 2);
            this.ctx.fillStyle = isGroundActive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(0,0,0,0.4)';
            this.ctx.strokeStyle = isGroundActive ? 'var(--accent-green)' : 'rgba(16, 185, 129, 0.2)';
            this.ctx.lineWidth = isGroundActive ? 3 : 1.5;
            this.ctx.fill();
            this.ctx.stroke();

            this.ctx.fillStyle = isGroundActive ? 'var(--text-primary)' : 'var(--text-muted)';
            this.ctx.font = '11px Space Grotesk';
            this.ctx.fillText("MOVE", ground.x, ground.y + 4);
        } 
        else if (this.currentMode === GameMode.DODGE) {
            // Update Player Position (linear interpolation towards move target)
            const p = this.player;
            const dx = p.targetX - p.x;
            const dy = p.targetY - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > p.speed) {
                p.x += (dx / dist) * p.speed;
                p.y += (dy / dist) * p.speed;
            } else {
                p.x = p.targetX;
                p.y = p.targetY;
            }

            // Spawn projectiles
            this.projectileSpawnTimer++;
            if (this.projectileSpawnTimer >= 70) { // every ~1.1s
                this.spawnSkillshot();
                this.projectileSpawnTimer = 0;
            }

            // Update & Render Projectiles
            for (let i = this.projectiles.length - 1; i >= 0; i--) {
                const pr = this.projectiles[i];

                if (pr.warning) {
                    // Draw Danger Warning Indicator
                    this.ctx.beginPath();
                    this.ctx.moveTo(pr.originX, pr.originY);
                    this.ctx.lineTo(pr.targetX, pr.targetY);
                    this.ctx.strokeStyle = 'rgba(239, 68, 68, 0.25)';
                    this.ctx.lineWidth = pr.radius * 2;
                    this.ctx.stroke();

                    // Dashed outline
                    this.ctx.beginPath();
                    this.ctx.moveTo(pr.originX, pr.originY);
                    this.ctx.lineTo(pr.targetX, pr.targetY);
                    this.ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
                    this.ctx.lineWidth = 1;
                    this.ctx.setLineDash([8, 6]);
                    this.ctx.stroke();
                    this.ctx.setLineDash([]); // Reset dash

                    pr.warningTimer--;
                    if (pr.warningTimer <= 0) {
                        pr.warning = false;
                    }
                } else {
                    // Move projectile
                    pr.x += pr.vx;
                    pr.y += pr.vy;

                    // Draw Projectile sphere
                    this.ctx.beginPath();
                    this.ctx.arc(pr.x, pr.y, pr.radius, 0, Math.PI * 2);
                    this.ctx.fillStyle = 'rgba(239, 68, 68, 0.6)';
                    this.ctx.strokeStyle = '#ef4444';
                    this.ctx.lineWidth = 2;
                    this.ctx.fill();
                    this.ctx.stroke();

                    // Check Collision with player
                    const colDist = Math.sqrt((pr.x - p.x) ** 2 + (pr.y - p.y) ** 2);
                    if (colDist <= pr.radius + p.radius) {
                        // Got Hit!
                        p.hp -= 20;
                        this.hitsTakenCount++;
                        p.flashRedTime = 12; // flash player red
                        playSound(140, 0.2, 'sawtooth'); // impact buzz

                        this.activeSession.targetsTracked.push({
                            spawnTime: now - 500,
                            clickTime: now,
                            targetX: pr.x,
                            targetY: pr.y,
                            targetRadius: pr.radius,
                            startX: p.x,
                            startY: p.y,
                            isHit: false,
                            gotHit: true,
                            survivalTime: this.sessionDuration - this.timer,
                            skillshotsSpawned: this.skillshotsSpawnedCount
                        });

                        // Remove projectile
                        this.projectiles.splice(i, 1);

                        // Check Game Over
                        if (p.hp <= 0) {
                            this.timer = 0; // Trigger session end
                            this.endSession();
                        }
                        continue;
                    }

                    // Check offscreen cleanup
                    if (pr.x < -pr.radius * 2 || pr.x > rect.width + pr.radius * 2 ||
                        pr.y < -pr.radius * 2 || pr.y > rect.height + pr.radius * 2) {
                        this.dodgesCount++;
                        
                        this.activeSession.targetsTracked.push({
                            spawnTime: now - 1000,
                            clickTime: now,
                            targetX: pr.x,
                            targetY: pr.y,
                            targetRadius: pr.radius,
                            startX: p.x,
                            startY: p.y,
                            isHit: true,
                            gotHit: false,
                            survivalTime: this.sessionDuration - this.timer,
                            skillshotsSpawned: this.skillshotsSpawnedCount
                        });

                        this.projectiles.splice(i, 1);
                    }
                }
            }

            // Draw Player Champion Circle
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            this.ctx.fillStyle = p.flashRedTime > 0 ? 'rgba(239, 68, 68, 0.7)' : 'rgba(10, 203, 230, 0.4)';
            this.ctx.strokeStyle = p.flashRedTime > 0 ? '#ef4444' : 'var(--accent-blue)';
            this.ctx.lineWidth = 2.5;
            if (p.flashRedTime > 0) p.flashRedTime--;
            this.ctx.fill();
            this.ctx.stroke();

            // Champion visual label
            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = '10px Space Grotesk';
            this.ctx.textAlign = 'center';
            this.ctx.fillText("CHAMP", p.x, p.y + 3);

            // Draw player destination line
            if (p.x !== p.targetX || p.y !== p.targetY) {
                this.ctx.beginPath();
                this.ctx.moveTo(p.x, p.y);
                this.ctx.lineTo(p.targetX, p.targetY);
                this.ctx.strokeStyle = 'rgba(10, 203, 230, 0.15)';
                this.ctx.lineWidth = 1.5;
                this.ctx.stroke();
            }

            // Draw HP Bar above player
            const hpBarW = p.radius * 2.2;
            const hpBarH = 4;
            const hpx = p.x - hpBarW / 2;
            const hpy = p.y - p.radius - 10;

            this.ctx.fillStyle = 'rgba(0,0,0,0.6)';
            this.ctx.fillRect(hpx, hpy, hpBarW, hpBarH);

            this.ctx.fillStyle = '#10b981'; // Green health
            this.ctx.fillRect(hpx, hpy, hpBarW * (p.hp / p.maxHp), hpBarH);
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(hpx, hpy, hpBarW, hpBarH);
        }

        // --- DRAW UTILITIES (Floating texts & click rings) ---

        // Draw Click expanding feedback indicator
        if (this.clickFeedback.active) {
            this.clickFeedback.radius += 1.5;
            if (this.clickFeedback.radius >= this.clickFeedback.maxRadius) {
                this.clickFeedback.active = false;
            } else {
                this.ctx.beginPath();
                this.ctx.arc(this.clickFeedback.x, this.clickFeedback.y, this.clickFeedback.radius, 0, Math.PI * 2);
                this.ctx.strokeStyle = this.clickFeedback.color;
                this.ctx.lineWidth = 2 * (1 - this.clickFeedback.radius / this.clickFeedback.maxRadius);
                this.ctx.stroke();
            }
        }

        // Draw Floating Texts
        for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
            const ft = this.floatingTexts[i];
            this.ctx.fillStyle = ft.color;
            this.ctx.font = 'bold 12px Space Grotesk';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(ft.text, ft.x, ft.y);
            ft.y -= 0.6; // float upwards
            ft.life--;
            if (ft.life <= 0) {
                this.floatingTexts.splice(i, 1);
            }
        }

        // Render Custom LoL-Style Cursor (Enlarged and glowing for high-DPI/4K screens)
        this.ctx.save();
        const cursorColor = this.currentMode === GameMode.KITING && this.activeKitingTarget === 'enemy' ? '#ff3b30' : '#c8aa6e';
        
        // Add neon outer glow
        this.ctx.shadowColor = cursorColor;
        this.ctx.shadowBlur = 12;
        
        this.ctx.beginPath();
        // Hover pointer shape (scaled up for high-DPI visibility)
        this.ctx.moveTo(this.virtualCursor.x, this.virtualCursor.y);
        this.ctx.lineTo(this.virtualCursor.x + 22, this.virtualCursor.y + 22);
        this.ctx.lineTo(this.virtualCursor.x + 8, this.virtualCursor.y + 22);
        this.ctx.lineTo(this.virtualCursor.x, this.virtualCursor.y + 30);
        this.ctx.closePath();
        
        this.ctx.fillStyle = cursorColor;
        this.ctx.strokeStyle = '#ffffff'; // White inner border to pop against black
        this.ctx.lineWidth = 1.5;
        this.ctx.fill();
        this.ctx.stroke();
        
        // Draw strong black outer border for high contrast
        this.ctx.shadowBlur = 0; // Turn off glow for outer stroke
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 3.0;
        this.ctx.stroke();
        
        this.ctx.restore();

        requestAnimationFrame(() => this.gameLoop());
    },

    updateDashboardMetrics(metrics) {
        // Populate metric cards using dynamic labels from analysis
        const keys = ['metric-1', 'metric-2', 'metric-3', 'metric-4'];
        
        document.getElementById('metric-1').innerText = metrics.extraMetrics.scoreText;
        document.getElementById('sub-metric-1').innerText = metrics.extraMetrics.subText;

        document.getElementById('metric-2').innerText = metrics.extraMetrics.precisionText;
        document.getElementById('sub-metric-2').innerText = metrics.extraMetrics.precisionSub;

        document.getElementById('metric-3').innerText = metrics.extraMetrics.efficiencyText;
        document.getElementById('sub-metric-3').innerText = metrics.extraMetrics.efficiencySub;

        document.getElementById('metric-4').innerText = metrics.extraMetrics.errorText;
        document.getElementById('sub-metric-4').innerText = metrics.extraMetrics.errorSub;
    },

    processCalibrationResults() {
        const profile = StorageController.loadProfile();
        const currentSens = parseInt(profile.multiplier) || 50;
        const currentTrainerSens = parseFloat(profile.trainerMultiplier) || 1.0;
        const dpi = parseInt(profile.dpi) || 12000;

        // Fit quadratic curve
        const curve = PerformanceAnalyzer.fitPerformanceCurve(this.calibrationRuns);
        this.optimalMultiplier = curve.optimalMultiplier;

        // Scale settings
        const optimalTrainerSens = currentTrainerSens * this.optimalMultiplier;
        const recommendedInGameSens = Math.max(1, Math.min(100, Math.round(currentSens * this.optimalMultiplier)));

        // Render curve bar chart
        this.renderThroughputChart(this.optimalMultiplier);

        // Populate summary metrics
        const avgPrecision = parseFloat((this.calibrationRuns.reduce((acc, r) => acc + r.precision, 0) / this.calibrationRuns.length).toFixed(1));
        const bestRun = this.calibrationRuns.reduce((best, run) => run.throughput > best.throughput ? run : best, this.calibrationRuns[0]);
        
        const summaryList = document.getElementById('calibration-summary-list');
        summaryList.innerHTML = `
            <div class="mini-stat-row">
                <span class="stat-label">Bester Durchsatz</span>
                <span class="stat-val">${bestRun.throughput} bits/s (bei ${bestRun.multiplier.toFixed(2)}x)</span>
            </div>
            <div class="mini-stat-row">
                <span class="stat-label">Durchschnittliche Präzision</span>
                <span class="stat-val">${avgPrecision}%</span>
            </div>
            <div class="mini-stat-row">
                <span class="stat-label">DPI Profil</span>
                <span class="stat-val">${dpi} DPI</span>
            </div>
            <div class="mini-stat-row">
                <span class="stat-label">Kalibrierte Phasen</span>
                <span class="stat-val">5 von 5 abgeschlossen</span>
            </div>
        `;

        // Render qualitative feedback
        const optimalRunMetrics = bestRun.metrics;
        const coachingHTML = PerformanceAnalyzer.generateCoachingText(optimalRunMetrics, optimalTrainerSens, currentTrainerSens, dpi, this.currentMode);
        document.getElementById('rec-text').innerHTML = coachingHTML;

        // Populate Recommendation settings display
        document.getElementById('rec-current-sens').innerText = `Trainer: ${currentTrainerSens.toFixed(2)}x | In-Game: ${currentSens}`;
        document.getElementById('rec-optimal-sens').innerText = `Trainer: ${optimalTrainerSens.toFixed(2)}x | In-Game: ${recommendedInGameSens}`;

        // Update In-Game Sensitivity Translation UI
        document.getElementById('lol-current-display').innerText = currentSens;
        document.getElementById('lol-target-calc').innerText = recommendedInGameSens;

        // Generate Deepseek/ChatGPT Prompt
        this.generatedDeepseekPromptText = PerformanceAnalyzer.generateDeepseekPrompt(optimalRunMetrics, this.calibrationRuns, currentSens, dpi, this.currentMode);

        // Write calibration run to history database (using absolute eDPI)
        const calEntry = {
            date: new Date().toLocaleString('de-DE'),
            mode: 'Kalibrierung (' + this.getModeName(this.currentMode) + ')',
            dpi: dpi,
            multiplier: optimalTrainerSens,
            edpi: dpi * recommendedInGameSens,
            score: Math.round(bestRun.throughput * 100),
            precision: `${avgPrecision}%`,
            reactionTime: `${optimalRunMetrics.avgReactionTime} ms`,
            throughput: `${bestRun.throughput} bits/s`
        };
        StorageController.saveRunEntry(calEntry);

        // Switch to the calibration screen
        this.switchView('view-calibration-results');
    },

    updateGameConversionUI(optimalMultiplier) {
        const inputSens = parseInt(document.getElementById('input-sens').value) || 50;
        const targetSens = Math.max(1, Math.min(100, Math.round(inputSens * optimalMultiplier)));
        
        document.getElementById('lol-current-display').innerText = inputSens;
        document.getElementById('lol-target-calc').innerText = targetSens;
    },

    renderThroughputChart(optimalSens) {
        const chart = document.getElementById('throughput-chart');
        const xLabels = document.getElementById('throughput-chart-labels');
        chart.innerHTML = '';
        xLabels.innerHTML = '';

        const maxTP = Math.max(...this.calibrationRuns.map(r => r.throughput), 1.0);

        this.calibrationRuns.forEach((run, idx) => {
            const heightPct = (run.throughput / maxTP) * 85;
            
            const barContainer = document.createElement('div');
            barContainer.className = 'chart-bar-container';

            const valSpan = document.createElement('span');
            valSpan.className = 'chart-bar-value';
            valSpan.innerText = run.throughput.toFixed(1);

            const bar = document.createElement('div');
            bar.className = 'chart-bar';
            
            const profile = StorageController.loadProfile();
            const currentTrainerSens = parseFloat(profile.trainerMultiplier) || 1.0;
            
            // Highlight optimal or current runs (optimal is currentTrainerSens * optimalMultiplier)
            const optimalValue = currentTrainerSens * optimalSens;
            
            if (Math.abs(run.multiplier - optimalValue) < 0.05) {
                bar.classList.add('optimal');
            } else if (Math.abs(run.multiplier - currentTrainerSens) < 0.05) {
                bar.classList.add('current');
            }

            barContainer.appendChild(valSpan);
            barContainer.appendChild(bar);
            chart.appendChild(barContainer);

            setTimeout(() => {
                bar.style.height = `${heightPct}%`;
            }, 50 * idx);

            const label = document.createElement('span');
            label.innerText = `${(run.multiplier / currentTrainerSens).toFixed(1)}x`;
            xLabels.appendChild(label);
        });
    },

    renderHistoryTable() {
        const body = document.getElementById('history-table-body');
        body.innerHTML = '';
        const history = StorageController.loadHistory();

        if (history.length === 0) {
            body.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted);">Keine Sitzungseinträge aufgezeichnet. Starte ein Training!</td></tr>`;
            return;
        }

        history.forEach(entry => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${entry.date}</td>
                <td><span class="badge ${entry.mode.includes('Kalibrierung') ? 'active' : ''}">${entry.mode}</span></td>
                <td>${entry.dpi}</td>
                <td>${entry.multiplier.toFixed(2)}x</td>
                <td>${entry.edpi.toFixed(0)}</td>
                <td><strong>${entry.score}</strong></td>
                <td>${entry.precision}</td>
                <td>${entry.reactionTime}</td>
                <td>${entry.throughput}</td>
            `;
            body.appendChild(tr);
        });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
