/**
 * GeminiClient: Handles WebSocket communication with Python Backend
 */
class GeminiClient {
  constructor(config) {
    this.websocket = null;
    this.onOpen = config.onOpen;
    this.onMessage = config.onMessage;
    this.onClose = config.onClose;
    this.onError = config.onError;
    this.wsUrl = config.wsUrl || `ws://localhost:8000/ws`;
  }

  connect() {
    this.websocket = new WebSocket(this.wsUrl);
    this.websocket.binaryType = "arraybuffer";

    this.websocket.onopen = () => {
      if (this.onOpen) this.onOpen();
    };

    this.websocket.onmessage = (event) => {
      if (this.onMessage) this.onMessage(event);
    };

    this.websocket.onclose = (event) => {
      if (this.onClose) this.onClose(event);
    };

    this.websocket.onerror = (event) => {
      if (this.onError) this.onError(event);
    };
  }

  send(data) {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(data);
    }
  }

  /**
   * For the Python SDK examples, it usually expects:
   * JSON strings for text commands or structured data.
   * Or direct binary chunks for audio.
   */

  sendAudio(base64Data) {
    // Protocol for the Python example usually expects the base64 string 
    // or the raw binary if binaryType is 'arraybuffer'.
    // Sending as JSON to match gemini-live-genai-python-sdk/frontend/gemini-client.js
    this.send(JSON.stringify({
      type: "audio",
      data: base64Data
    }));
  }

  sendText(text) {
    this.send(JSON.stringify({
      type: "text",
      text: text
    }));
  }

  sendVideo(base64Data) {
    this.send(JSON.stringify({
      type: "video",
      data: base64Data
    }));
  }

  disconnect() {
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
  }

  isConnected() {
    return this.websocket && this.websocket.readyState === WebSocket.OPEN;
  }
}

window.GeminiClient = GeminiClient;