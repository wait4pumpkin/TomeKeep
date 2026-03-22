import { app, BrowserWindow, nativeImage } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setupDatabase } from './db'
import { setupMetadata } from './metadata'
import { setupPricing } from './pricing'
import { resolvePreloadPath } from './preloadPath'
import { setupStores } from './stores'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(__dirname, '../public')

let win: BrowserWindow | null

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

// Resolve icon path — works in dev (../build/icon.png) and packaged (resources/build/icon.png)
function resolveIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'build', 'icon.png')
    : path.join(__dirname, '../build/icon.png')
}

function createWindow() {
  const iconPath = resolveIconPath()

  // On macOS, app.dock.setIcon() is needed to change the dock icon at runtime
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(iconPath))
  }

  win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: iconPath,
    webPreferences: {
      preload: resolvePreloadPath(__dirname),
    },
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(process.env.DIST as string, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(async () => {
  await setupDatabase()
  setupMetadata()
  setupStores()
  setupPricing()
  createWindow()
})
