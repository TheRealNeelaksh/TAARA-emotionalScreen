const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');

let width, height;

function setStatus(text, type) {
    statusEl.innerText = text.toUpperCase();
    statusEl.className = '';
    if (type) statusEl.classList.add(`status-${type}`);
}


// --- Configuration ---
const EYE_RADIUS = 30;
const EYE_SPACING = 140; // Distance between centers
const LINE_WIDTH = 4;
const LINE_MAX_CURVE = 20; // Max pixels the line curves up/down

// WebSocket Config
const WS_URL = "ws://localhost:8000/ws";
const RECONNECT_DELAY = 3000;

// Blink Config
const BLINK_DURATION = 150;
const MIN_BLINK_INTERVAL = 2000;
const MAX_BLINK_INTERVAL = 6000;

// Gaze Config
const MAX_GAZE_OFFSET = 15; // Max pixels eyes can wander
const GAZE_CHANGE_CHANCE = 0.01; // Per frame chance to change gaze target
const GAZE_SMOOTHING = 0.05; // Lerp factor for gaze

// Emotion Config
const EMOTION_DECAY = 0.001; // Per frame decay to neutral
const EMOTION_SMOOTHING = 0.05; // Lerp factor for emotion changes

// --- State ---
let state = {
    // Blinking
    blink: {
        isBlinking: false,
        startTime: 0,
        nextBlinkTime: 0
    },
    // Emotion (-1 to 1)
    emotion: {
        currentValence: 0,
        targetValence: 0,
        currentArousal: 0,
        targetArousal: 0
    },
    // Gaze (Offset from center)
    gaze: {
        currentX: 0,
        currentY: 0,
        targetX: 0,
        targetY: 0
    }
};

// --- Helpers ---
function lerp(start, end, factor) {
    return start + (end - start) * factor;
}

function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
}

// --- Audio State ---
let audioContext;
let audioWorkletNode;
let inputMixer; // Mixes Mic and TTS for the visual engine
let audioState = {
    volume: 0, // Smoothed RMS
    zcr: 0
};
// Recorder State
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let silenceStart = 0;
let SILENCE_THRESHOLD = 0.03; // Threshold to stop recording
let SILENCE_DURATION = 1500; // ms of silence before sending

// Blink Sound
const blinkSound = new Audio('src/voices/blink/blink.wav');

async function initAudio() {
    if (audioContext) return;

    try {
        audioContext = new AudioContext();
        await audioContext.audioWorklet.addModule('audio-processor.js');

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const micSource = audioContext.createMediaStreamSource(stream);

        audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-processor');

        // Create Mixer
        inputMixer = audioContext.createGain();

        // Connect Mic -> Mixer -> Worklet
        micSource.connect(inputMixer);
        inputMixer.connect(audioWorkletNode);

        // Initialize Recorder
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };
        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
            if (socket && socket.readyState === WebSocket.OPEN) {
                console.log("Sending Audio Blob...", audioBlob.size);
                setStatus("Sending Audio...", "processing");
                socket.send(audioBlob);
            }
            audioChunks = [];
        };

        audioWorkletNode.port.onmessage = (event) => {
            const { rms, zcr } = event.data;

            // Fast attack, slow release smoothing for volume
            if (rms > audioState.volume) {
                audioState.volume = lerp(audioState.volume, rms, 0.3); // Attack
            } else {
                audioState.volume = lerp(audioState.volume, rms, 0.05); // Release
            }

            audioState.zcr = zcr;

            // Map Audio to Emotion
            // Volume -> Target Arousal
            const arousalTarget = Math.min(1.0, audioState.volume * 5.0);
            if (arousalTarget > 0.1) {
                state.emotion.targetArousal = Math.max(state.emotion.targetArousal, arousalTarget);
                // Activity = slight positive valence (interested)
                state.emotion.targetValence = lerp(state.emotion.targetValence, 0.2, 0.05);
            }

            // --- VAD Logic ---
            // Debugging
            // if (Math.random() < 0.05) console.log("RMS:", rms, "Rec:", isRecording);

            if (rms > SILENCE_THRESHOLD) {
                // ACTIVE
                silenceStart = performance.now(); // Reset silence timer

                // Trigger Recording if loud enough (slightly higher threshold to start)
                if (!isRecording && rms > SILENCE_THRESHOLD * 2) {
                    isRecording = true;
                    audioChunks = [];
                    mediaRecorder.start();
                    setStatus("Listening", "listening"); // Active UI update
                    highlightStep('listening');
                    console.log("STARTED RECORDING (RMS:", rms.toFixed(4), ")");
                }
            } else {
                // SILENT
                if (isRecording) {
                    const silenceDuration = performance.now() - silenceStart;
                    if (silenceDuration > SILENCE_DURATION) {
                        // Stop Recording
                        isRecording = false;
                        mediaRecorder.stop();
                        setStatus("Processing...", "processing");
                        highlightStep('transcribing');
                        console.log("STOPPED RECORDING (Silence:", silenceDuration.toFixed(0), "ms)");
                    }
                }
            }
        };

        // source.connect(audioWorkletNode); // Removed, using mixer now
        console.log("Audio initialized");

        // Remove click handler
        window.removeEventListener('click', initAudio);
        setStatus("Listening", "listening");

        // Visual feedback
        state.emotion.targetArousal = 1.0;
        setTimeout(() => state.emotion.targetArousal = 0, 300);

    } catch (e) {
        console.error("Audio init failed", e);
    }
}


// --- WebSocket ---
let socket;

function connectWS() {
    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
        console.log("WebSocket connected");
        updateDebugStatus('backend-status', 'green');
        setStatus("Connected to Baymax Core");
    };

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log("WS Recv:", data);

            // Handle Flow Status
            // Handle Flow Status
            if (data.status) {
                if (data.status === 'generating_audio') {
                    highlightStep('processing');
                    if (data.response_text) {
                        showSubtitle(data.response_text, false);
                    }
                } else if (data.status === 'speaking') {
                    highlightStep('speaking');
                } else {
                    highlightStep(data.status);
                }
            }

            if (data.delta_valence !== undefined) {
                // Apply deltas
                state.emotion.targetValence = Math.max(-1, Math.min(1, state.emotion.targetValence + data.delta_valence));
            }
            if (data.delta_arousal !== undefined) {
                state.emotion.targetArousal = Math.max(0, Math.min(1, state.emotion.targetArousal + data.delta_arousal));
            }

            // Subtitles
            if (data.user_text) {
                showSubtitle(data.user_text, true); // True = User
            }
            if (data.response_text) {
                console.log("Baymax Says:", data.response_text);
                showSubtitle(data.response_text, false); // False = Baymax
            }

            if (data.audio) {
                playAudioResponse(data.audio);
            }

        } catch (e) {
            console.error("WS Parse Error", e);
        }
    };

    socket.onclose = () => {
        console.log("WebSocket closed, reconnecting...");
        updateDebugStatus('backend-status', 'red');
        setTimeout(connectWS, RECONNECT_DELAY);
    };

    socket.onerror = (err) => {
        console.error("WebSocket error", err);
        updateDebugStatus('backend-status', 'yellow');
        socket.close(); // Trigger reconnect
    };
}
// Start connection immediately
connectWS();

// --- Logic ---
function scheduleNextBlink(currentTime) {
    // Arousal could decrease blink interval (more alert)
    const arousalFactor = 1 - (state.emotion.currentArousal * 0.5); // 0.5 to 1.0 multiplier
    const delay = (Math.random() * (MAX_BLINK_INTERVAL - MIN_BLINK_INTERVAL) + MIN_BLINK_INTERVAL) * arousalFactor;
    state.blink.nextBlinkTime = currentTime + delay;
}

function updateEmotion() {
    // Slowly decay targets to neutral
    if (state.emotion.targetValence > 0) state.emotion.targetValence = Math.max(0, state.emotion.targetValence - EMOTION_DECAY);
    if (state.emotion.targetValence < 0) state.emotion.targetValence = Math.min(0, state.emotion.targetValence + EMOTION_DECAY);
    if (state.emotion.targetArousal > 0) state.emotion.targetArousal = Math.max(0, state.emotion.targetArousal - EMOTION_DECAY);

    // Smoothly interpolate current emotion to target
    state.emotion.currentValence = lerp(state.emotion.currentValence, state.emotion.targetValence, EMOTION_SMOOTHING);
    state.emotion.currentArousal = lerp(state.emotion.currentArousal, state.emotion.targetArousal, EMOTION_SMOOTHING);
}

function updateGaze() {
    // Randomly pick a new target
    if (Math.random() < GAZE_CHANGE_CHANCE) {
        // Biased slightly towards center
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * MAX_GAZE_OFFSET;
        state.gaze.targetX = Math.cos(angle) * dist;
        state.gaze.targetY = Math.sin(angle) * dist;
    }

    state.gaze.currentX = lerp(state.gaze.currentX, state.gaze.targetX, GAZE_SMOOTHING);
    state.gaze.currentY = lerp(state.gaze.currentY, state.gaze.targetY, GAZE_SMOOTHING);
}

function update(time) {
    // 1. Blinking
    if (state.blink.nextBlinkTime === 0) scheduleNextBlink(time);

    if (!state.blink.isBlinking && time >= state.blink.nextBlinkTime) {
        state.blink.isBlinking = true;
        state.blink.startTime = time;
        // Play sound
        blinkSound.currentTime = 0;
        blinkSound.volume = 0.2; // Low volume
        blinkSound.play().catch(e => { }); // Catch error if not interacted
    }

    let eyeScaleY = 1.0;

    // Arousal can widen eyes slightly (rest scale > 1) or narrow (squint < 1)
    // Let's say high arousal = slightly wider eyes normally
    const baseScale = 1.0 + (state.emotion.currentArousal * 0.1);

    if (state.blink.isBlinking) {
        const elapsed = time - state.blink.startTime;
        const duration = BLINK_DURATION; // Could scale with arousal too

        if (elapsed >= duration) {
            state.blink.isBlinking = false;
            scheduleNextBlink(time);
            eyeScaleY = baseScale;
        } else {
            const progress = elapsed / duration;
            if (progress < 0.5) {
                // Close
                eyeScaleY = lerp(baseScale, 0.1, progress * 2);
            } else {
                // Open
                eyeScaleY = lerp(0.1, baseScale, (progress - 0.5) * 2);
            }
        }
    } else {
        eyeScaleY = baseScale;
    }

    // 2. Emotion & Gaze
    updateEmotion();
    updateEmotion();
    updateGaze();

    // Audio volume affects mouth curve slightly (talking simulation?)
    if (audioState.volume > 0.1) {
        // Optional: Add subtle mouth movement here if desired
    }

    draw(eyeScaleY);
    requestAnimationFrame(update);
}


function playAudioResponse(base64Audio) {
    if (!audioContext) return;

    try {
        const binaryString = window.atob(base64Audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        audioContext.decodeAudioData(bytes.buffer, (buffer) => {
            const source = audioContext.createBufferSource();
            source.buffer = buffer;

            // 1. Connect to Speakers (Hear it)
            source.connect(audioContext.destination);

            // 2. Connect to Visual Engine (See it)
            // Use a specific gain to prevent it from being too overwhelming visually
            const visualGain = audioContext.createGain();
            visualGain.gain.value = 0.8;
            source.connect(visualGain);
            if (inputMixer) {
                visualGain.connect(inputMixer);
            }

            source.start(0);
        });
    } catch (e) {
        console.error("Audio Playback Error:", e);
    }
}

function draw(eyeScaleY) {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;

    // Apply specific emotion effects
    // Valence:
    // +1 (Happy): Eyes move up slightly, Line curves up
    // -1 (Sad): Eyes move down slightly, Line curves down
    const valenceYOffset = state.emotion.currentValence * -10; // -10px for happy, +10px for sad

    // Gaze affects everything
    const offsetX = state.gaze.currentX;
    const offsetY = state.gaze.currentY + valenceYOffset;

    const leftEyeX = centerX - EYE_SPACING / 2 + offsetX;
    const rightEyeX = centerX + EYE_SPACING / 2 + offsetX;
    const eyesY = centerY + offsetY;

    // --- Draw Line ---
    // The line connects the inner edges? Or centers? 
    // Baymax: simple straight line.
    // Emotion: Curved line (quadratic bezier).

    // Calculate control point for curve
    // Valence controls the curve intensity.
    // Line endpoints should anchor near the eyes.

    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.beginPath();

    // Start/End points: Centers of eyes
    // To make it look "under" the eyes or connecting them?
    // Let's connect the centers, but draw behind eyes.

    const lineY = eyesY;
    const midX = centerX + offsetX;

    // Curve amount
    const curveY = state.emotion.currentValence * LINE_MAX_CURVE;

    ctx.moveTo(leftEyeX, lineY);
    // Quadratic Curve: CP at (midX, lineY + curveY)
    // Note: Canvas Y consumes downwards. 
    // Smile: Curve needs to be "down" in pixels (higher Y value) to look like a U shape? 
    // Wait, typical smile is U shape.
    // ctx.quadraticCurveTo(ControlX, ControlY, EndX, EndY)

    // If valence is +1 (Happy), we want a U shape (Smile). Control point Y should be GREATER than start/end Y.
    // So curveY should be positive.

    ctx.quadraticCurveTo(midX, lineY + curveY, rightEyeX, lineY);
    ctx.stroke();


    // --- Draw Eyes ---
    ctx.fillStyle = '#FFFFFF';

    // Left
    ctx.save();
    ctx.translate(leftEyeX, eyesY);
    ctx.scale(1, eyeScaleY);
    ctx.beginPath();
    ctx.arc(0, 0, EYE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Right
    ctx.save();
    ctx.translate(rightEyeX, eyesY);
    ctx.scale(1, eyeScaleY);
    ctx.beginPath();
    ctx.arc(0, 0, EYE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// --- Exposure for debugging/testing ---
window.setEmotion = (valence, arousal) => {
    state.emotion.targetValence = valence;
    state.emotion.targetArousal = arousal;
};

// Helper for user to chat
window.say = (text) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
        setStatus("Processing...", "processing");
        socket.send(text);
    } else {
        console.warn("Socket not open");
    }
};

// --- Debug UI & Controls ---
function updateDebugStatus(id, color) {
    const el = document.getElementById(id);
    if (el) {
        el.className = `status-dot ${color}`;
    }
}

function highlightStep(stepName) {
    // Reset all
    document.querySelectorAll('.flow-steps .step').forEach(el => el.classList.remove('active'));

    // Map status from backend to ID
    // transcribing -> step-transcribing
    // llm_processing -> step-processing
    // generating_audio -> step-processing (or keep highlighted)
    // speaking -> step-speaking
    // listening -> step-listening

    let targetId = '';
    if (stepName === 'listening') targetId = 'step-listening';
    if (stepName === 'transcribing') targetId = 'step-transcribing';
    if (stepName === 'llm_processing') targetId = 'step-processing';
    if (stepName === 'generating_audio') targetId = 'step-processing'; // Still processing
    if (stepName === 'speaking') targetId = 'step-speaking';

    if (targetId) {
        const el = document.getElementById(targetId);
        if (el) el.classList.add('active');
    }
}

function showSubtitle(text, isUser) {
    const el = document.getElementById('subtitles');
    if (!el) return;

    el.innerText = text;
    el.style.opacity = '1';
    el.style.color = isUser ? '#aaa' : '#fff'; // User grey, Baymax bright

    // Auto hide after some time if it's user text? keep until next interaction?
    // Let's keep it visible for a bit.
    if (window.subtitleTimeout) clearTimeout(window.subtitleTimeout);
    window.subtitleTimeout = setTimeout(() => {
        el.style.opacity = '0';
    }, 5000 + (text.length * 50));
}


// --- Initialization ---
const micToggle = document.getElementById('mic-toggle');
const micLabel = document.getElementById('mic-label');

micToggle.addEventListener('change', async (e) => {
    if (e.target.checked) {
        // Turn ON
        await initAudio();
        micLabel.innerText = "Mic On";
        highlightStep('listening');
    } else {
        // Turn OFF
        // Ideally we should stop the mediaStream tracks here to truly mute
        // For now, initAudio sets isRecording=false on silence, but we might want manual control.
        // We'll rely on the existing logic which toggles listening based on voice activity, 
        // but maybe we should disable inputMixer?
        micLabel.innerText = "Mic Off";
        // To be safe, reload or just stop processing? 
        // Let's just update label for now, as initAudio is idempotent-ish or hard to 'un-init' without reload.
        // A simple way is to limit `mediaRecorder` starting only if checked.
        // But initAudio() does a lot of setup. 
    }
});

// Update initAudio to respect switch
// We need to inject a check inside the existing audio loop
// Or just let initAudio be called ONCE, and the toggle controls the "isAllowedToRecord" flag.

let isMicEnabled = false;
micToggle.addEventListener('change', (e) => {
    isMicEnabled = e.target.checked;
    micLabel.innerText = isMicEnabled ? "Mic On" : "Mic Off";
    if (isMicEnabled && !audioContext) {
        initAudio();
    }
});

// Start Polls
setInterval(async () => {
    try {
        const res = await fetch('http://localhost:8000/llm-status');
        const data = await res.json();
        if (data.status === 'connected') updateDebugStatus('llm-status', 'green');
        else updateDebugStatus('llm-status', 'red');
    } catch (e) {
        console.warn("Poll Error", e);
        updateDebugStatus('llm-status', 'red');
    }
}, 5000);

// Init
resize();
requestAnimationFrame(update);

