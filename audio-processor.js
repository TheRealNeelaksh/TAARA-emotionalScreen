class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.FRAME_SIZE = 2048; // Process in chunks
        this.buffer = new Float32Array(this.FRAME_SIZE);
        this.bufferIndex = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || input.length === 0) return true;

        const channelData = input[0];

        // Compute RMS (Volume) for this block
        // channelData is usually 128 samples (Web Audio default render quantum)

        // We can either process every 128 samples (very fast updates) or accumulate.
        // 128 samples @ 44.1kHz is ~3ms. 
        // Sending message every 3ms might be too much for main thread if not careful.
        // Let's send every 4th block (approx 12ms) or just send every block but main thread throttles.
        // Actually, distinct updates are good. Let's send every block but optimize calculations.

        let sumSquares = 0;
        let zeroCrossings = 0;
        let lastSample = 0;

        for (let i = 0; i < channelData.length; i++) {
            const sample = channelData[i];
            sumSquares += sample * sample;

            // ZCR
            if (lastSample >= 0 && sample < 0 || lastSample < 0 && sample >= 0) {
                zeroCrossings++;
            }
            lastSample = sample;
        }

        const rms = Math.sqrt(sumSquares / channelData.length);

        // Post back to main thread
        // Only post if there's *some* sound to avoid flooding idle state
        if (rms > 0.001) {
            this.port.postMessage({
                rms: rms,
                zcr: zeroCrossings / channelData.length // Normalized ZCR
            });
        }

        return true; // Keep processor alive
    }
}

registerProcessor('audio-processor', AudioProcessor);
