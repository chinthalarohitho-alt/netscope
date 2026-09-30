// Electron shell for the network inspector: runs the logcat reader in-process
// and shows the same page in a native window.
const { app, BrowserWindow, nativeTheme, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const inspector = require('./server');

// Apps launched from Finder don't inherit the shell PATH, so look for adb in the usual places.
function findAdb() {
  const candidates = [
    process.env.ADB,
    process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools/adb'),
    '/opt/homebrew/share/android-commandlinetools/platform-tools/adb',
    path.join(os.homedir(), 'Library/Android/sdk/platform-tools/adb'),
    '/opt/homebrew/bin/adb',
    '/usr/local/bin/adb',
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || 'adb';
}

if (!app.requestSingleInstanceLock()) app.quit();

// Keep running on unexpected errors, and leave a trail in ~/Library/Logs/Netscope/main.log.
function logCrash(kind, err) {
  try {
    const dir = path.join(os.homedir(), 'Library/Logs/Netscope');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'main.log'), `${new Date().toISOString()} ${kind}: ${err?.stack || err}\n`);
  } catch {}
}
process.on('uncaughtException', (err) => logCrash('uncaught', err));
process.on('unhandledRejection', (err) => logCrash('unhandled', err));

let win;

async function createWindow() {
  // A fixed port keeps the page's origin stable, so saved UI state (panel width) survives relaunches.
  const adb = findAdb();
  const dataDir = app.getPath('userData');
  const port = await inspector.start({ port: 9417, adb, dataDir }).catch(() => inspector.start({ port: 0, adb, dataDir }));
  win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 720,
    minHeight: 420,
    title: 'Netscope',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0d12' : '#f5f6f8',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(`http://127.0.0.1:${port}/`);
  // If the page itself crashes, reload it instead of leaving a blank window.
  win.webContents.on('render-process-gone', (_e, details) => {
    logCrash('renderer', details.reason);
    if (details.reason !== 'clean-exit' && win && !win.isDestroyed()) setTimeout(() => win.reload(), 500);
  });
  win.on('closed', () => {
    win = null;
  });
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(createWindow);

// Closing the window quits the app: the reader is useless without a window.
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => inspector.stop());
