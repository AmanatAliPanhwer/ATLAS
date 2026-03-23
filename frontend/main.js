const { app, BrowserWindow, ipcMain, net, desktopCapturer, session } = require('electron/main')
const path = require('path')
const http = require('http')

let mainWindow;
let screenCaptureInterval = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  mainWindow.loadFile('index.html')
}

ipcMain.handle('ping', () => 'pong')

ipcMain.handle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
  return sources.map(source => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
  }));
});

// Capture screen frames in main process and push to renderer
ipcMain.handle('start-screen-capture', async () => {
  if (screenCaptureInterval) return; // already running

  screenCaptureInterval = setInterval(async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 854, height: 480 }  // smaller = faster
      });
      if (sources.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
        // toJPEG returns a Buffer — much smaller and faster than PNG toDataURL
        const jpegBuffer = sources[0].thumbnail.toJPEG(50);
        const base64 = jpegBuffer.toString('base64');
        mainWindow.webContents.send('screen-frame', base64);
      }
    } catch (e) {
      console.error('Screen capture frame error:', e);
    }
  }, 500); // 2fps — enough for Gemini, not hammering IPC
});

ipcMain.handle('stop-screen-capture', () => {
  if (screenCaptureInterval) {
    clearInterval(screenCaptureInterval);
    screenCaptureInterval = null;
  }
});

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', () => {
    if (mainWindow) {
      mainWindow.webContents.send('api-received', {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: body
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'received' }));
  });
});

server.listen(3000, () => console.log('API Server listening on port 3000'));

ipcMain.handle('api-request', async (event, options) => {
  const { url, method = 'GET', headers = {}, body } = options;
  return new Promise((resolve, reject) => {
    const request = net.request({ method, url, headers });
    request.on('response', (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk.toString(); });
      response.on('end', () => resolve({ statusCode: response.statusCode, headers: response.headers, data }));
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
});

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})