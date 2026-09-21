// No output samples are written: the destination connection only keeps this
// graph processing. Raw input is sent to the owning tab, never to speakers.
class RobotVoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = new Float32Array(2048);
    this.cursor = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (channels?.length && channels[0]?.length) {
      for (let i = 0; i < channels[0].length; i++) {
        let mono = 0;
        for (const channel of channels) mono += channel[i] / channels.length;
        this.pending[this.cursor++] = mono;
        if (this.cursor === this.pending.length) {
          this.port.postMessage(this.pending, [this.pending.buffer]);
          this.pending = new Float32Array(2048);
          this.cursor = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("robot-voice-capture", RobotVoiceCaptureProcessor);
