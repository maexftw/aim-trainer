/**
 * Pro Aim Optimizer - Core Game Engine
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
        
        gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
        
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
        console.warn("Audio Context blocked or unsupported:", e);
    }
}

// Game State Definitions
const GameMode = {
    TRAINING: 'training',
    CALIBRATION: 'calibration'
};

const GameState = {
    IDLE: 'idle',
    PLAYING: 'playing',
    PAUSED: 'paused',
    FINISHED: 'finished'
};

const App = {
    // Game configurations
    targetRadius: 24,
    sessionDuration: 30, // seconds
    calibrationSteps: [0.6, 0.8, 1.0, 1.2, 1.4],
    
    // Core states
    currentMode: GameMode.TRAINING,
    state: GameState.IDLE,
    timer: 0,
    timerInterval: null,
    
    // Canvas & Pointer Lock variables
    canvas: null,
    ctx: null,
    virtualCursor: { x: 0, y: 0 },
    
    // Tracking active session data
    activeSession: {
        multiplier: 1.0,
        dpi: 1600,
        targetsTracked: [], // list of clicks/paths
        startTime: 0,
    },
    
    // Calibration run storage
    calibrationRuns: [], // array of completed session metrics
    currentCalibrationStep: 0,
    optimalMultiplier: 1.0,

    // Active target state
    currentTarget: { x: 0, y: 0, spawnTime: 0 },
    currentPath: [], // points collected for the active target

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
    },

    setupEventListeners() {
        window.addEventListener('resize', () => this.resizeCanvas());

        // Navigation Sidebar
        document.getElementById('btn-mode-train').addEventListener('click', (e) => {
            this.setUIMode(GameMode.TRAINING);
            this.switchView('view-game');
        });
        document.getElementById('btn-mode-calibrate').addEventListener('click', (e) => {
            this.setUIMode(GameMode.CALIBRATION);
            this.switchView('view-game');
        });
        document.getElementById('btn-mode-history').addEventListener('click', (e) => {
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
        selectGame.addEventListener('change', () => {
            if (this.optimalMultiplier) {
                this.updateGameConversionUI(this.optimalMultiplier);
            }
        });

        checkRawInput.addEventListener('change', () => {
            if (!checkRawInput.checked) {
                alert("Warnung: Mausbeschleunigung in Windows verfälscht deine physikalische Bewegung. Es wird dringend empfohlen, die Zeigerbeschleunigung deaktiviert zu lassen.");
            }
        });

        // Start button on Canvas Overlay
        document.getElementById('btn-start-game').addEventListener('click', () => {
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
                const currentSens = parseFloat(inputSens.value) || 1.0;
                inputSens.value = (currentSens * optMultiplier).toFixed(5);
                
                updateProfile();
                alert(`Mauseinstellungen angepasst!\n- Trainer-Sens: ${newTrainerSens.toFixed(2)}x\n- In-Game Sens: ${(currentSens * optMultiplier).toFixed(5)}`);
                this.setUIMode(GameMode.TRAINING);
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
            if (this.currentTarget.x > rect.width || this.currentTarget.y > rect.height) {
                this.spawnTarget();
            }
        }
    },

    loadProfileSettings() {
        const profile = StorageController.loadProfile();
        document.getElementById('input-dpi').value = profile.dpi || 12000;
        document.getElementById('input-trainer-sens').value = profile.trainerMultiplier || 1.0;
        document.getElementById('input-sens').value = profile.multiplier || 0.05;
        this.updateSensBadge();
    },

    updateSensBadge() {
        const dpi = parseInt(document.getElementById('input-dpi').value) || 12000;
        const trainerSens = parseFloat(document.getElementById('input-trainer-sens').value) || 1.0;
        const gameSens = parseFloat(document.getElementById('input-sens').value) || 0.05;
        const edpi = Math.round(dpi * gameSens);
        document.getElementById('current-sens-badge').innerText = `Trainer-Sens: ${trainerSens.toFixed(1)}x | Spiel-eDPI: ${edpi} (${dpi} DPI)`;
    },

    setUIMode(mode) {
        this.currentMode = mode;
        
        document.getElementById('btn-mode-train').classList.toggle('active', mode === GameMode.TRAINING);
        document.getElementById('btn-mode-calibrate').classList.toggle('active', mode === GameMode.CALIBRATION);

        const calBar = document.getElementById('calibration-bar-container');
        const overlayTitle = document.getElementById('overlay-title');
        const overlayDesc = document.getElementById('overlay-desc');

        if (mode === GameMode.CALIBRATION) {
            calBar.style.display = 'block';
            overlayTitle.innerText = "Kalibrierung starten";
            overlayDesc.innerHTML = "Das System testet nacheinander 5 verschiedene Geschwindigkeiten (0.6x bis 1.4x).<br>Spiele jede Phase konzentriert zu Ende. Das System berechnet am Ende deinen optimalen Faktor.";
            this.currentCalibrationStep = 0;
            this.calibrationRuns = [];
            this.updateCalibrationUI();
        } else {
            calBar.style.display = 'none';
            overlayTitle.innerText = "Ziel-Training starten";
            overlayDesc.innerText = "Klicke die Ziele so schnell und präzise wie möglich an. Nach dem Klick erscheint direkt ein neues Ziel.";
        }

        this.endSession();
    },

    updateCalibrationUI() {
        if (this.currentMode !== GameMode.CALIBRATION) return;
        
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

        overlay.style.opacity = '1';
        overlay.style.pointerEvents = 'all';

        if (this.state === GameState.PAUSED) {
            title.innerText = "Pausiert";
            desc.innerText = "Das Spiel wurde pausiert. Klicke auf 'Fortsetzen', um den Mauszeiger wieder zu sperren.";
            btn.innerText = "Fortsetzen";
        } else if (this.state === GameState.FINISHED) {
            title.innerText = "Runde Beendet!";
            
            const metrics = PerformanceAnalyzer.calculateSessionMetrics(
                this.activeSession.targetsTracked, 
                this.sessionDuration
            );
            
            desc.innerHTML = `
                <strong>DPI:</strong> ${this.activeSession.dpi} | <strong>Trainer-Sens:</strong> ${this.activeSession.multiplier.toFixed(2)}x<br>
                <strong>Trefferquote:</strong> ${metrics.totalHits} / ${metrics.totalClicks} (${metrics.precision}%)<br>
                <strong>Reaktionszeit:</strong> ${metrics.avgReactionTime} ms<br>
                <strong>Bewegungs-Effizienz:</strong> ${metrics.avgPathEfficiency}%<br>
                <strong>Durchsatz:</strong> ${metrics.avgThroughput} bits/s
            `;
            btn.innerText = this.currentMode === GameMode.CALIBRATION && this.currentCalibrationStep < this.calibrationSteps.length 
                ? "Nächste Kalibrierungs-Phase starten" 
                : "Erneut Starten";
        }
    },

    hideOverlay() {
        const overlay = document.getElementById('canvas-overlay');
        overlay.style.opacity = '0';
        overlay.style.pointerEvents = 'none';
    },

    startSession() {
        const profile = StorageController.loadProfile();
        let activeMultiplier = parseFloat(profile.trainerMultiplier) || 1.0;
        
        if (this.currentMode === GameMode.CALIBRATION) {
            activeMultiplier = (parseFloat(profile.trainerMultiplier) || 1.0) * this.calibrationSteps[this.currentCalibrationStep];
        }

        this.state = GameState.PLAYING;
        
        this.activeSession = {
            multiplier: activeMultiplier,
            dpi: parseInt(profile.dpi),
            targetsTracked: [],
            startTime: performance.now()
        };

        const rect = this.canvas.getBoundingClientRect();
        this.virtualCursor.x = rect.width / 2;
        this.virtualCursor.y = rect.height / 2;

        this.spawnTarget();
        
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
                this.sessionDuration
            );

            playSound(523.25, 0.1); // C5
            setTimeout(() => playSound(659.25, 0.15), 100); // E5

            if (this.currentMode === GameMode.CALIBRATION) {
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
                const entry = {
                    date: new Date().toLocaleString('de-DE'),
                    mode: 'Training',
                    dpi: this.activeSession.dpi,
                    multiplier: this.activeSession.multiplier,
                    edpi: this.activeSession.dpi * this.activeSession.multiplier,
                    score: metrics.totalHits * 10,
                    precision: `${metrics.precision}%`,
                    reactionTime: `${metrics.avgReactionTime} ms`,
                    throughput: `${metrics.avgThroughput} bits/s`
                };
                StorageController.saveRunEntry(entry);
                this.showOverlay();
                this.updateDashboardMetrics(metrics);
            }
        }
    },

    spawnTarget() {
        const rect = this.canvas.getBoundingClientRect();
        const padding = this.targetRadius * 2;
        
        this.currentTarget = {
            x: padding + Math.random() * (rect.width - padding * 2),
            y: padding + Math.random() * (rect.height - padding * 2),
            spawnTime: performance.now(),
            startX: this.virtualCursor.x,
            startY: this.virtualCursor.y
        };

        this.currentPath = [
            { x: this.virtualCursor.x, y: this.virtualCursor.y, t: performance.now() }
        ];
    },

    handleMouseMove(e) {
        if (this.state !== GameState.PLAYING) return;

        const rawX = e.movementX || e.mozMovementX || 0;
        const rawY = e.movementY || e.mozMovementY || 0;
        
        this.virtualCursor.x += rawX * this.activeSession.multiplier;
        this.virtualCursor.y += rawY * this.activeSession.multiplier;

        const rect = this.canvas.getBoundingClientRect();
        this.virtualCursor.x = Math.max(0, Math.min(rect.width, this.virtualCursor.x));
        this.virtualCursor.y = Math.max(0, Math.min(rect.height, this.virtualCursor.y));

        this.currentPath.push({
            x: this.virtualCursor.x,
            y: this.virtualCursor.y,
            t: performance.now()
        });
    },

    handleMouseDown(e) {
        if (this.state !== GameState.PLAYING) return;

        const target = this.currentTarget;
        const radius = this.targetRadius;

        const dx = this.virtualCursor.x - target.x;
        const dy = this.virtualCursor.y - target.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        const isHit = distance <= radius;

        if (isHit) {
            playSound(880, 0.08, 'sine');
        } else {
            playSound(220, 0.15, 'sawtooth');
        }

        this.activeSession.targetsTracked.push({
            spawnTime: target.spawnTime,
            clickTime: performance.now(),
            targetX: target.x,
            targetY: target.y,
            targetRadius: radius,
            startX: target.startX,
            startY: target.startY,
            clickX: this.virtualCursor.x,
            clickY: this.virtualCursor.y,
            isHit: isHit,
            cursorPath: [...this.currentPath]
        });

        this.spawnTarget();
    },

    gameLoop() {
        if (this.state !== GameState.PLAYING) return;

        const rect = this.canvas.getBoundingClientRect();
        this.ctx.clearRect(0, 0, rect.width, rect.height);

        const target = this.currentTarget;
        
        // Draw path trail
        if (this.currentPath.length > 1) {
            this.ctx.beginPath();
            this.ctx.moveTo(this.currentPath[0].x, this.currentPath[0].y);
            for (let i = 1; i < this.currentPath.length; i++) {
                this.ctx.lineTo(this.currentPath[i].x, this.currentPath[i].y);
            }
            this.ctx.strokeStyle = 'rgba(168, 85, 247, 0.25)';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
        }

        // Target outer glow
        this.ctx.beginPath();
        this.ctx.arc(target.x, target.y, this.targetRadius, 0, Math.PI * 2);
        this.ctx.fillStyle = 'rgba(0, 240, 255, 0.15)';
        this.ctx.strokeStyle = '#00f0ff';
        this.ctx.lineWidth = 3;
        this.ctx.fill();
        this.ctx.stroke();

        // Target core center
        this.ctx.beginPath();
        this.ctx.arc(target.x, target.y, 4, 0, Math.PI * 2);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fill();

        // Render virtual cursor
        this.ctx.beginPath();
        this.ctx.arc(this.virtualCursor.x, this.virtualCursor.y, 5, 0, Math.PI * 2);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 1.5;
        this.ctx.fill();
        this.ctx.stroke();

        // Crosshair reticle
        this.ctx.beginPath();
        this.ctx.moveTo(this.virtualCursor.x - 10, this.virtualCursor.y);
        this.ctx.lineTo(this.virtualCursor.x - 4, this.virtualCursor.y);
        this.ctx.moveTo(this.virtualCursor.x + 4, this.virtualCursor.y);
        this.ctx.lineTo(this.virtualCursor.x + 10, this.virtualCursor.y);
        this.ctx.moveTo(this.virtualCursor.x, this.virtualCursor.y - 10);
        this.ctx.lineTo(this.virtualCursor.x, this.virtualCursor.y - 4);
        this.ctx.moveTo(this.virtualCursor.x, this.virtualCursor.y + 4);
        this.ctx.lineTo(this.virtualCursor.x, this.virtualCursor.y + 10);
        this.ctx.strokeStyle = '#00f0ff';
        this.ctx.lineWidth = 1.5;
        this.ctx.stroke();

        requestAnimationFrame(() => this.gameLoop());
    },

    updateDashboardMetrics(metrics) {
        document.getElementById('metric-precision').innerText = `${metrics.precision}%`;
        document.getElementById('metric-precision-sub').innerText = `${metrics.totalHits} hits / ${metrics.totalClicks} clicks`;

        document.getElementById('metric-reaction').innerText = `${metrics.avgReactionTime} ms`;
        document.getElementById('metric-reaction-sub').innerText = `Durchsatz: ${metrics.avgThroughput} bits/s`;

        document.getElementById('metric-efficiency').innerText = `${metrics.avgPathEfficiency}%`;
        document.getElementById('metric-efficiency-sub').innerText = `Abweichung: ${metrics.avgJitter}px Jitter`;

        document.getElementById('metric-overshoot').innerText = `${metrics.overshootRate}%`;
        document.getElementById('metric-overshoot-sub').innerText = `Undershoot rate: ${metrics.undershootRate}%`;
    },

    processCalibrationResults() {
        const profile = StorageController.loadProfile();
        const currentSens = parseFloat(profile.multiplier) || 0.05;
        const currentTrainerSens = parseFloat(profile.trainerMultiplier) || 1.0;
        const dpi = parseInt(profile.dpi) || 12000;

        // Fit quadratic curve to find optimal multiplier factor
        const curve = PerformanceAnalyzer.fitPerformanceCurve(this.calibrationRuns);
        this.optimalMultiplier = curve.optimalMultiplier;

        // Scale trainer sensitivity
        const optimalTrainerSens = currentTrainerSens * this.optimalMultiplier;
        const recommendedInGameSens = currentSens * this.optimalMultiplier;

        // Render curve bar chart
        this.renderThroughputChart(this.optimalMultiplier);

        // Populate summary metrics
        const avgPrecision = parseFloat((this.calibrationRuns.reduce((acc, r) => acc + r.precision, 0) / this.calibrationRuns.length).toFixed(1));
        const bestRun = this.calibrationRuns.reduce((best, run) => run.throughput > best.throughput ? run : best, this.calibrationRuns[0]);
        
        const summaryList = document.getElementById('calibration-summary-list');
        summaryList.innerHTML = `
            <div class="mini-stat-row">
                <span class="stat-label">Bester Durchsatz</span>
                <span class="stat-val">${bestRun.throughput} bits/s (bei ${bestRun.multiplier}x)</span>
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

        // Render qualitative feedback using trainer sensitivity bounds
        const optimalRunMetrics = bestRun.metrics;
        const coachingHTML = PerformanceAnalyzer.generateCoachingText(optimalRunMetrics, optimalTrainerSens, currentTrainerSens, dpi);
        document.getElementById('rec-text').innerHTML = coachingHTML;

        // Populate Recommendation settings display (physically adjusted DPI & multiplier)
        document.getElementById('rec-current-sens').innerText = `Trainer: ${currentTrainerSens.toFixed(2)}x | In-Game: ${currentSens.toFixed(5)}`;
        document.getElementById('rec-optimal-sens').innerText = `Trainer: ${optimalTrainerSens.toFixed(2)}x | In-Game: ${recommendedInGameSens.toFixed(5)}`;

        // Update In-Game Sensitivity Translation UI
        this.updateGameConversionUI(this.optimalMultiplier);

        // Generate Deepseek/ChatGPT Prompt
        this.generatedDeepseekPromptText = PerformanceAnalyzer.generateDeepseekPrompt(optimalRunMetrics, this.calibrationRuns, currentSens, dpi);

        // Write calibration run to history database (using absolute eDPI)
        const calEntry = {
            date: new Date().toLocaleString('de-DE'),
            mode: 'Kalibrierung',
            dpi: dpi,
            multiplier: currentSens * this.optimalMultiplier,
            edpi: dpi * (currentSens * this.optimalMultiplier),
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
        const gameNotes = {
            grayzone: "Hinweis für Gray Zone Warfare: Da das Spiel die Empfindlichkeit beim Anvisieren mit hohen Zoomstufen (ADS) nicht separat anpassen lässt, ist die Beibehaltung einer höheren Basis-Empfindlichkeit (wie dein Peak-Durchsatz bei höherem Multiplikator) der beste Kompromiss, um ein Stocken im Visier zu verhindern.",
            farcry: "Hinweis für Far Cry 6: Der Empfindlichkeitsregler skaliert linear. Multipliziere einfach deine Far Cry 6 Sens (z.B. 10) mit dem Multiplikator und runde auf ganze Zahlen, da Far Cry 6 keine feinen Nachkommastellen im Schieberegler unterstützt.",
            helldivers: "Hinweis für Helldivers 2: Helldivers 2 verwendet präzise Gleitkomma-Regler (z.B. standardmäßig 0.05). Multipliziere diesen Wert im Optionsmenü direkt mit dem errechneten Multiplikator. (Tipp: Die separate ADS-Sensitivität im Spiel kann ebenfalls mit diesem Faktor skaliert werden).",
            readyornot: "Hinweis für Ready or Not: Ready or Not läuft auf der Unreal Engine mit linearen Reglern (z.B. standardmäßig 0.50). Trage den berechneten neuen Wert direkt in die Einstellungen ein, um ein perfektes 1:1-Verhältnis zu erzielen.",
            cs2: "Hinweis für CS2 / Valorant: Beide Spiele nutzen exzellente, lineare RAW-Input-Engines. Multipliziere deine aktuelle In-Game-Sensitivität (z.B. 1.20 in CS2 oder 0.35 in Valorant) mit dem Kalibrierungsfaktor.",
            apex: "Hinweis für Apex Legends: Der Maus-Regler ist linear (Source Engine). Ändere deine Maus-Sensitivität im Spiel direkt auf den berechneten neuen Wert.",
            cod: "Hinweis für Call of Duty / Warzone: Da CoD sehr große Sensitivitätszahlen verwendet (z.B. standardmäßig 12.00), multipliziere diesen Wert mit dem Faktor. Du kannst auch die ADS-Sensitivität auf 'Relativ' stellen, um Zoom-Anpassungen zu optimieren."
        };

        const inputSens = parseFloat(document.getElementById('input-sens').value) || 1.0;
        const targetSens = inputSens * optimalMultiplier;
        
        const selectGame = document.getElementById('select-game');
        const gameId = selectGame.value;
        const gameName = selectGame.options[selectGame.selectedIndex].text;
        
        document.getElementById('game-target-name').innerText = gameName;
        document.getElementById('game-target-calc').innerText = targetSens.toFixed(3);
        
        const note = gameNotes[gameId] || "Multipliziere deine aktuelle Empfindlichkeit in diesem Spiel mit dem berechneten Faktor.";
        document.getElementById('game-target-note').innerText = note;
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
            const currentSens = parseFloat(profile.multiplier);
            
            if (Math.abs(run.multiplier - optimalSens) < 0.05) {
                bar.classList.add('optimal');
            } else if (Math.abs(run.multiplier - currentSens) < 0.05) {
                bar.classList.add('current');
            }

            barContainer.appendChild(valSpan);
            barContainer.appendChild(bar);
            chart.appendChild(barContainer);

            setTimeout(() => {
                bar.style.height = `${heightPct}%`;
            }, 50 * idx);

            const label = document.createElement('span');
            label.innerText = `${run.multiplier}x`;
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
                <td><span class="badge ${entry.mode === 'Kalibrierung' ? 'active' : ''}">${entry.mode}</span></td>
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
