/**
 * MediaHandler: Manages Audio/Video/Screen capture and playback for Electron
 */
class MediaHandler {
  constructor() {
    this.audioContext = null;
    this.mediaStream = null;
    this.audioWorkletNode = null;
    
    this.camStream = null;
    this.screenStream = null;
    this.videoInterval = null;
    
    this.nextStartTime = 0;
    this.scheduledSources = [];
    this.isRecording = false;

    // Compositing canvas
    this.compositeCanvas = document.createElement("canvas");
    this.compositeCanvas.width = 1280;
    this.compositeCanvas.height = 720;
    this.ctx = this.compositeCanvas.getContext("2d");

    // Offscreen videos for compositing
    this.camVideo = document.createElement("video");
    this.camVideo.autoplay = true;
    this.camVideo.playsinline = true;
    
    this.screenVideo = document.createElement("video");
    this.screenVideo.autoplay = true;
    this.screenVideo.playsinline = true;
  }

  async initializeAudio() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: 24000
      });
      await this.audioContext.audioWorklet.addModule('./pcm-processor.js');
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  async startAudio(onAudioData) {
    await this.initializeAudio();
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000 },
      });
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.audioWorkletNode = new AudioWorkletNode(this.audioContext, 'pcm-processor');
      this.audioWorkletNode.port.onmessage = (event) => {
        if (this.isRecording) {
          const downsampled = this.downsampleBuffer(event.data, this.audioContext.sampleRate, 16000);
          const pcm16 = this.convertFloat32ToInt16(downsampled);
          const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16)));
          onAudioData(base64);
        }
      };
      source.connect(this.audioWorkletNode);
      this.isRecording = true;
    } catch (e) {
      console.error('Error starting audio:', e);
      throw e;
    }
  }

  stopAudio() {
    this.isRecording = false;
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
  }

  async startCamera() {
    this.camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    this.camVideo.srcObject = this.camStream;
    
    const preview = document.getElementById('video-preview');
    const container = document.getElementById('video-preview-container');
    if (preview) preview.srcObject = this.camStream;
    if (container) container.classList.add('on');
    
    this.ensureCaptureInterval();
  }

  stopCamera() {
    if (this.camStream) {
      this.camStream.getTracks().forEach(t => t.stop());
      this.camStream = null;
      this.camVideo.srcObject = null;
    }
    
    const preview = document.getElementById('video-preview');
    const container = document.getElementById('video-preview-container');
    if (preview) preview.srcObject = null;
    if (container) container.classList.remove('on');
    
    this.checkIntervals();
  }

  async startScreen() {
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    this.screenVideo.srcObject = this.screenStream;
    this.ensureCaptureInterval();
  }

  stopScreen() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;
      this.screenVideo.srcObject = null;
    }
    this.checkIntervals();
  }

  ensureCaptureInterval() {
    if (!this.videoInterval) {
      this.videoInterval = setInterval(() => this.broadcastFrame(), 1000);
    }
  }

  checkIntervals() {
    if (!this.camStream && !this.screenStream && this.videoInterval) {
      clearInterval(this.videoInterval);
      this.videoInterval = null;
    }
  }

  setOnFrame(callback) {
    this.onFrameCallback = callback;
  }

  broadcastFrame() {
    if (!this.onFrameCallback) return;

    // Clear canvas
    this.ctx.fillStyle = "black";
    this.ctx.fillRect(0, 0, this.compositeCanvas.width, this.compositeCanvas.height);

    // If Screen is on, draw it as background
    if (this.screenStream) {
      this.ctx.drawImage(this.screenVideo, 0, 0, 1280, 720);
    }

    // If Camera is on, draw it as PiP (Picture-in-Picture)
    if (this.camStream) {
      const pipW = 320;
      const pipH = 240;
      const x = 1280 - pipW - 20;
      const y = 720 - pipH - 20;
      
      // Draw a border for the PiP
      this.ctx.strokeStyle = "#f5c736"; // ATLAS Accent
      this.ctx.lineWidth = 4;
      this.ctx.strokeRect(x, y, pipW, pipH);
      this.ctx.drawImage(this.camVideo, x, y, pipW, pipH);
    }

    if (this.camStream || this.screenStream) {
        const base64 = this.compositeCanvas.toDataURL("image/jpeg", 0.6).split(",")[1];
        this.onFrameCallback(base64);
    }
  }

  playAudioChunk(base64Data) {
    if (!this.audioContext) return;
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const pcmData = new Int16Array(bytes.buffer);
    const float32Data = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) float32Data[i] = pcmData[i] / 32768.0;
    const buffer = this.audioContext.createBuffer(1, float32Data.length, 24000);
    buffer.getChannelData(0).set(float32Data);
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);
    const now = this.audioContext.currentTime;
    this.nextStartTime = Math.max(now, this.nextStartTime);
    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
    this.scheduledSources.push(source);
  }

  downsampleBuffer(buffer, sampleRate, outSampleRate) {
    if (outSampleRate === sampleRate) return buffer;
    const ratio = sampleRate / outSampleRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0, offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0, count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = accum / count;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  convertFloat32ToInt16(buffer) {
    let l = buffer.length;
    const buf = new Int16Array(l);
    while (l--) buf[l] = Math.min(1, Math.max(-1, buffer[l])) * 0x7fff;
    return buf.buffer;
  }
}

window.MediaHandler = MediaHandler;