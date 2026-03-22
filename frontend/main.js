const { app, BrowserWindow, ipcMain, net } = require('electron/main')
const path = require('path')
const http = require('http')

let mainWindow;

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
  // mainWindow.webContents.openDevTools()
}

// Client: Sending API calls
ipcMain.handle('ping', () => 'pong')
// ... (api-request handler stays same)

// Server: Receiving API calls
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', () => {
    // Send the incoming request to the renderer
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

// Start server on port 3000 (or any port you prefer)
server.listen(3000, () => {
  console.log('API Server listening on port 3000');
});

ipcMain.handle('api-request', async (event, options) => {
  const { url, method = 'GET', headers = {}, body } = options;
  
  return new Promise((resolve, reject) => {
    const request = net.request({
      method,
      url,
      headers
    });

    request.on('response', (response) => {
      let data = '';
      response.on('data', (chunk) => {
        data += chunk.toString();
      });
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          data: data
        });
      });
    });

    request.on('error', (error) => {
      reject(error);
    });

    if (body) {
      request.write(body);
    }
    request.end();
  });
});

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})