class VitaPcmProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        this.buffer = [];
        this.bufferLength = 0;

        // Target chunk size: about 100 ms at 16 kHz.
        this.targetSamples = 1600;
    }

    process(inputs) {
        const input = inputs[0]?.[0];

        if (!input || input.length === 0) {
            return true;
        }

        // Copy samples because AudioWorklet input buffers are reused.
        for (let i = 0; i < input.length; i += 1) {
            this.buffer.push(input[i]);
        }

        this.bufferLength += input.length;

        while (this.bufferLength >= this.targetSamples) {
            const segment = new Float32Array(this.targetSamples);

            for (let i = 0; i < this.targetSamples; i += 1) {
                segment[i] = this.buffer.shift();
            }

            this.bufferLength -= this.targetSamples;

            /*
             * Browser AudioContext is commonly 44.1 kHz or 48 kHz.
             * Convert the browser samples to 16 kHz mono for
             * Gemini Live Transcription.
             */
            const inputRate = sampleRate;
            const ratio = inputRate / 16000;
            const outputLength = Math.max(
                1,
                Math.round(segment.length / ratio),
            );

            const pcm16 = new Int16Array(outputLength);

            let rmsSum = 0;

            for (let i = 0; i < outputLength; i += 1) {
                const sourcePosition = i * ratio;
                const index = Math.floor(sourcePosition);
                const fraction = sourcePosition - index;

                const a =
                    segment[Math.min(index, segment.length - 1)] || 0;

                const b =
                    segment[Math.min(index + 1, segment.length - 1)] || a;

                // Linear interpolation.
                const value = a + (b - a) * fraction;

                rmsSum += value * value;

                const clipped = Math.max(-1, Math.min(1, value));

                pcm16[i] =
                    clipped < 0
                        ? clipped * 0x8000
                        : clipped * 0x7fff;
            }

            const rms = Math.sqrt(
                rmsSum / Math.max(1, outputLength),
            );

            this.port.postMessage(
                {
                    pcm16k: pcm16.buffer,
                    rms,
                },
                [pcm16.buffer],
            );
        }

        return true;
    }
}

registerProcessor(
    "vita-pcm-processor",
    VitaPcmProcessor,
);