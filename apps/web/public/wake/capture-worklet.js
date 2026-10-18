/*
 * Capital Q - "Hey Q" microphone capture (D1/D2, ADR 0058).
 *
 * Runs on the audio thread. It downmixes to mono, resamples to 16 kHz and
 * posts one number per 32 ms frame: the frame's loudness (RMS). No audio
 * leaves this worklet; the page's voice-activity gate decides from these
 * numbers alone whether the wake-word detector may listen at all.
 * Plain JavaScript because an AudioWorklet module is fetched by URL.
 */
/* global registerProcessor, AudioWorkletProcessor, sampleRate */

const TARGET_RATE = 16000;
const FRAME = 512; // 32 ms at 16 kHz

class WakeCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / TARGET_RATE;
    this.position = 0;
    this.sum = 0;
    this.count = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    // The node is pulled by a silent connection to the destination: keep it
    // silent.
    if (output) for (const channel of output) channel.fill(0);
    if (!input || input.length === 0) return true;
    const length = input[0].length;
    const channels = input.length;
    // Linear-interpolation resampling of the mono mix to 16 kHz.
    while (this.position < length) {
      const index = Math.floor(this.position);
      const fraction = this.position - index;
      let a = 0;
      let b = 0;
      for (let c = 0; c < channels; c += 1) {
        a += input[c][index];
        // The block's last sample has no neighbour here: hold it.
        b += input[c][Math.min(index + 1, length - 1)];
      }
      const sample = (a + (b - a) * fraction) / channels;
      this.sum += sample * sample;
      this.count += 1;
      if (this.count === FRAME) {
        this.port.postMessage(Math.sqrt(this.sum / FRAME));
        this.sum = 0;
        this.count = 0;
      }
      this.position += this.step;
    }
    this.position -= length;
    return true;
  }
}

registerProcessor("cq-wake-capture", WakeCapture);
