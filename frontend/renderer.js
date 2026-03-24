const information = document.getElementById('info')
const nodeVersion = document.getElementById('node-version')
const chromeVersion = document.getElementById('chrome-version')
const electronVersion = document.getElementById('electron-version')


if (nodeVersion) nodeVersion.innerText = window.electronAPI.node()
if (chromeVersion) chromeVersion.innerText = window.electronAPI.chrome()
if (electronVersion) electronVersion.innerText = window.electronAPI.electron()

const func = async () => {
    const response = await window.electronAPI.ping()
    const element = document.getElementById('ping-response')
    if (element) element.innerText = response
}

const btn = document.getElementById('btn')
if (btn) btn.addEventListener('click', func)

const userInput = document.getElementById('user-input');
const micBtn = document.getElementById('mic-btn');
const camBtn = document.getElementById('cam-btn');
const screenBtn = document.getElementById('screen-btn');
const chatHistory = document.getElementById('chat-history');

let activeMsgs = { user: null, model: null };

const addChatMessage = (role, text, isStreaming = false) => {
    if (!chatHistory) return;

    // If we're streaming and already have an active box for this role, update it
    if (isStreaming && activeMsgs[role]) {
        const textSpan = activeMsgs[role].querySelector('.text-content');
        if (textSpan) {
            // APPEND the new text chunk instead of replacing it
            textSpan.innerText += text; 
        }
    } else {
        // Create a NEW message box
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-msg ${role}`;
        msgDiv.innerHTML = `
            <span class="role">${role === 'user' ? 'YOU' : 'ATLAS'}</span>
            <span class="text-content">${text}</span>
        `;
        chatHistory.appendChild(msgDiv);
        
        // If this is the start of a stream, save it as the active one
        if (isStreaming) {
            activeMsgs[role] = msgDiv;
        } else {
            activeMsgs[role] = null;
        }
    }

    chatHistory.scrollTop = chatHistory.scrollHeight;
    
    while (chatHistory.children.length > 30) {
        chatHistory.removeChild(chatHistory.firstChild);
    }
};

// Initialize Gemini Client and Media Handler
const mediaHandler = new MediaHandler();

// Set up the onFrame callback for composited video
mediaHandler.setOnFrame((frame) => {
    if (geminiClient.isConnected()) geminiClient.sendVideo(frame);
});

const handleVideo = async (btn, mode) => {
    btn.classList.toggle('active');
    const isActive = btn.classList.contains('active');
    
    try {
        if (isActive) {
            if (mode === 'cam') await mediaHandler.startCamera();
            else await mediaHandler.startScreen();
            console.log(`${mode === 'cam' ? 'Camera' : 'Screen share'} started`);
        } else {
            if (mode === 'cam') mediaHandler.stopCamera();
            else mediaHandler.stopScreen();
            console.log(`${mode === 'cam' ? 'Camera' : 'Screen share'} stopped`);
        }
    } catch (e) {
        btn.classList.remove('active');
        console.error(`Failed to start ${mode}:`, e);
    }
};

if (camBtn) camBtn.onclick = () => handleVideo(camBtn, 'cam');
if (screenBtn) screenBtn.onclick = () => handleVideo(screenBtn, 'screen');

const geminiClient = new GeminiClient({
    wsUrl: `ws://localhost:8000/ws`,
    onOpen: () => {
        console.log('Connected to Gemini Live API (Python Backend)');
        updateConnectionStatus(true);
    },
    onMessage: (event) => {
        const response = JSON.parse(event.data);
        
        // 1. Handle Turn Completion or Interruption
        if (response.serverContent?.turnComplete || response.serverContent?.interrupted) {
            activeMsgs.user = null;
            activeMsgs.model = null;
        }

        // 2. Handle audio and text data from model
        if (response.serverContent?.modelTurn?.parts) {
            response.serverContent.modelTurn.parts.forEach(part => {
                if (part.inlineData?.mimeType?.includes('audio') && part.inlineData.data) {
                    mediaHandler.playAudioChunk(part.inlineData.data);
                    if (window.setState) window.setState('speaking');
                }
                if (part.text) {
                    addChatMessage('model', part.text, true);
                    
                    // 1. Check for single image pattern [IMAGE: URL]
                    const imgMatch = part.text.match(/\[IMAGE:\s*(https?:\/\/[^\]\s,]+)\]/i);
                    if (imgMatch && imgMatch[1]) {
                        showImage(imgMatch[1]);
                    }

                    // 2. Check for multiple images pattern [IMAGES: JSON_ARRAY_OR_OBJ]
                    const imgsMatch = part.text.match(/\[IMAGES:\s*(\{.*\})\]/i) || part.text.match(/\[IMAGES:\s*(\[.*\])\]/i);
                    if (imgsMatch && imgsMatch[1]) {
                        try {
                            const data = JSON.parse(imgsMatch[1]);
                            showImage(data);
                        } catch (e) {
                            console.error('Failed to parse IMAGES JSON:', e);
                        }
                    }
                }

            });

        }

        // 3. Handle live Transcriptions from Python
        if (response.serverContent?.outputTranscription?.text) {
             addChatMessage('model', response.serverContent.outputTranscription.text, true);
        }
        
        if (response.serverContent?.inputTranscription?.text) {
             addChatMessage('user', response.serverContent.inputTranscription.text, true);
        }
    },
    onClose: () => {
        console.log('Gemini Live API Connection Closed');
        if (window.setState) window.setState('idle');
        updateConnectionStatus(false);
    },
    onError: (err) => {
        console.error('Gemini Live API Error:', err);
        updateConnectionStatus(false);
    }
});

// Connection Status Management
const connPill = document.getElementById('connection-pill');
const connText = document.getElementById('connection-text');

function updateConnectionStatus(isConnected) {
    if (!connPill || !connText) return;
    
    if (isConnected) {
        connPill.classList.remove('disconnected');
        connPill.classList.add('connected');
        connText.innerText = 'CONNECTION STABILIZED';
    } else {
        connPill.classList.remove('connected');
        connPill.classList.add('disconnected');
        connText.innerText = 'DISCONNECTED - RETRYING...';
    }
}

// Initial status
updateConnectionStatus(false);


/**
 * Application Core Logic
 */



// Connect to the proxy server
geminiClient.connect();

// Reconnection loop every 5 seconds
setInterval(() => {
    if (!geminiClient.isConnected()) {
        console.log('Attempting to reconnect...');
        geminiClient.connect();
    }
}, 5000);

if (userInput) {
  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && userInput.value.trim() !== '') {
      const text = userInput.value;
      console.log('Sending message:', text);
      
      if (geminiClient.isConnected()) {
          geminiClient.sendText(text);
          addChatMessage('user', text);
          if (window.setState) window.setState('thinking');
      }
      
      userInput.value = '';
    }
  });
}

if (micBtn) {
  micBtn.addEventListener('click', async () => {
    micBtn.classList.toggle('active');
    const isActive = micBtn.classList.contains('active');
    
    if (isActive) {
        console.log('Microphone: ON');
        if (window.setState) window.setState('listening');
        await mediaHandler.startAudio((base64Audio) => {
            if (geminiClient.isConnected()) {
                geminiClient.sendAudio(base64Audio);
            }
        });
    } else {
        console.log('Microphone: OFF');
        mediaHandler.stopAudio();
        if (window.setState) window.setState('idle');
    }
  });
}

// Example of receiving an API call (Server mode):
window.electronAPI.onApiReceived((data) => {
    console.log('Incoming API call received:', data);
    // Control ATLAS via external API calls
    if (data.url == '/idle') { if (window.setState) window.setState('idle') }
    if (data.url === '/thinking') { if (window.setState) window.setState('thinking') }
    if (data.url === '/speaking') { if (window.setState) window.setState('speaking') }
    if (data.url === '/listening') { if (window.setState) window.setState('listening') }
    
    // Image widget control via API
    if (data.url === '/show-image') {
        console.log('API call to show image with params:', data.params);
        body = JSON.parse(data.body)
        if (body.params) {
            // Check if it's a simple URL or a complex object
            if (body.params.url || body.params.images || Array.isArray(body.params)) {
                showImage(body.params);
            }
        }
    }

    if (data.url === '/hide-image') {
        hideImage();
    }
});