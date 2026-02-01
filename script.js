const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let width, height;

// Configuration
// Adjust these to match the "Baymax" proportions
const EYE_RADIUS = 30; 
const EYE_SPACING = 140; // Distance between centers
const LINE_WIDTH = 4;
const BLINK_DURATION = 150; // ms
const MIN_BLINK_INTERVAL = 2000;
const MAX_BLINK_INTERVAL = 6000;

let blinkState = {
    isBlinking: false,
    startTime: 0,
    nextBlinkTime: 0
};

function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    draw(1.0); // Redraw immediately on resize
}

function scheduleNextBlink(currentTime) {
    const delay = Math.random() * (MAX_BLINK_INTERVAL - MIN_BLINK_INTERVAL) + MIN_BLINK_INTERVAL;
    blinkState.nextBlinkTime = currentTime + delay;
}

function update(time) {
    if (blinkState.nextBlinkTime === 0) {
        scheduleNextBlink(time);
    }

    if (!blinkState.isBlinking && time >= blinkState.nextBlinkTime) {
        blinkState.isBlinking = true;
        blinkState.startTime = time;
    }

    let eyeScaleY = 1.0;

    if (blinkState.isBlinking) {
        const elapsed = time - blinkState.startTime;
        if (elapsed >= BLINK_DURATION) {
            blinkState.isBlinking = false;
            scheduleNextBlink(time);
            eyeScaleY = 1.0;
        } else {
            // Simple ease-in-out or linear blink
            // Full close at 50%
            const progress = elapsed / BLINK_DURATION;
            if (progress < 0.5) {
                // Closing: 1.0 -> 0.1
                eyeScaleY = 1.0 - (progress * 2 * 0.9);
            } else {
                // Opening: 0.1 -> 1.0
                eyeScaleY = 0.1 + ((progress - 0.5) * 2 * 0.9);
            }
        }
    }
    
    draw(eyeScaleY);
    requestAnimationFrame(update);
}

function draw(eyeScaleY) {
    // Clear
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;

    // Draw Line (behind eyes, technically connecting centers)
    // Baymax line connects the inner edges or centers? 
    // Usually it looks like a line connecting the centers.
    ctx.beginPath();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = 'round';
    
    // Line from center of left eye to center of right eye
    // But we might want it to not overlap the eyes if fill is transparent? 
    // Eyes are solid white, so line under is fine.
    
    ctx.moveTo(centerX - EYE_SPACING / 2, centerY);
    ctx.lineTo(centerX + EYE_SPACING / 2, centerY);
    ctx.stroke();

    // Draw Eyes
    ctx.fillStyle = '#FFFFFF';

    // Left Eye
    ctx.save();
    ctx.translate(centerX - EYE_SPACING / 2, centerY);
    ctx.scale(1, eyeScaleY);
    ctx.beginPath();
    ctx.arc(0, 0, EYE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Right Eye
    ctx.save();
    ctx.translate(centerX + EYE_SPACING / 2, centerY);
    ctx.scale(1, eyeScaleY);
    ctx.beginPath();
    ctx.arc(0, 0, EYE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

window.addEventListener('resize', resize);
resize();
requestAnimationFrame(update);
