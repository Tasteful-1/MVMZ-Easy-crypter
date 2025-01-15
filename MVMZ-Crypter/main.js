const { app, BrowserWindow, ipcMain} = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// GPU 가속 비활성화
app.disableHardwareAcceleration();

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow;
let pythonProcess;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1024,
        height: 744,
        resizable: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, 'preload.js'),
          sandbox: true,
		  devTools: false
        },
        backgroundColor: '#ffffff',
        show: false,
        autoHideMenuBar: true
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

	mainWindow.setMenu(null);
	mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if ((input.control || input.meta) && input.key.toLowerCase() === 'i') {
            event.preventDefault();
        }
    });
}

function startPythonProcess() {
  const scriptPath = isDev
    ? path.join(__dirname, 'backend/api.py')
    : path.join(process.resourcesPath, 'backend/api.py');

  pythonProcess = spawn('python', [scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Python 표준 출력 처리
  pythonProcess.stdout.on('data', (data) => {
    try {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        if (!line.trim()) return;

        if (line.startsWith('{"type":')) {
          const message = JSON.parse(line);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('python-message', message);
          }
        }
      });
    } catch (e) {
      console.error('Failed to parse Python output:', e);
    }
  });

  // Python 에러 출력 처리
  pythonProcess.stderr.on('data', (data) => {
    console.error(`Python Error: ${data}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('python-error', data.toString());
    }
  });
}

// IPC 통신 처리 부분 수정
ipcMain.handle('python-command', async (event, command) => {
	if (!pythonProcess) {
	  throw new Error('Python process not running');
	}

	return new Promise((resolve, reject) => {
	  let responseData = '';

	  const messageHandler = (data) => {
		try {
		  const lines = data.toString().split('\n');
		  lines.forEach(line => {
			if (!line.trim()) return;

			if (line.startsWith('{"type":')) {
			  const message = JSON.parse(line);
			  if (message.type === 'complete') {
				cleanup();
				resolve(message.data);

				if (mainWindow && !mainWindow.isDestroyed()) {
				  mainWindow.webContents.send('python-message', message);
				}
			  }
			} else {
			  responseData += line + '\n';
			}
		  });
		} catch (e) {
		  console.error('Failed to parse Python response:', e);
		}
	  };

	  const errorHandler = (data) => {
		reject(new Error(data.toString()));
	  };

	  const cleanup = () => {
		pythonProcess.stdout.removeListener('data', messageHandler);
		pythonProcess.stderr.removeListener('data', errorHandler);
	  };

	  pythonProcess.stdout.on('data', messageHandler);
	  pythonProcess.stderr.on('data', errorHandler);

	  pythonProcess.stdin.write(JSON.stringify(command) + '\n');

	  // 타임아웃 시간을 30초로 연장
	  setTimeout(() => {
		cleanup();
		reject(new Error('Command timed out'));
	  }, 300000);  // 300초
	});
  });

// 앱 생명주기 이벤트 처리
app.whenReady().then(() => {
  createWindow();
  startPythonProcess();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (pythonProcess) {
      pythonProcess.kill();
    }
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  if (pythonProcess) {
    pythonProcess.kill();
  }
});