import { app, BrowserWindow, shell } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { registerIpc } from './ipc'

const isDev = !app.isPackaged
const PROFILE_NAME = 'home-control'

/**
 * O Electron usa nomes diferentes para o userData em desenvolvimento e no
 * instalador. Isso fazia a conta parecer desconectada ao alternar entre eles.
 * Fixamos um único perfil por usuário e migramos apenas o config.json legado.
 */
function configureUserData(): void {
  const defaultUserData = app.getPath('userData')
  const canonicalUserData = join(app.getPath('appData'), PROFILE_NAME)

  app.setName(PROFILE_NAME)
  app.setPath('userData', canonicalUserData)

  const destination = join(canonicalUserData, 'config.json')
  if (existsSync(destination)) return

  const legacyCandidates = [
    join(defaultUserData, 'config.json'),
    join(app.getPath('appData'), 'Home Control', 'config.json'),
    join(app.getPath('appData'), 'Electron', 'config.json')
  ]
  const legacy = legacyCandidates.find((candidate) => candidate !== destination && existsSync(candidate))
  if (!legacy) return

  mkdirSync(canonicalUserData, { recursive: true })
  copyFileSync(legacy, destination)
}

configureUserData()

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#07080c',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Evita o flash branco antes do primeiro paint.
  window.once('ready-to-show', () => window.show())

  // Nada abre dentro do app: links externos vao para o navegador do usuario.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (isDev && devServer) {
    void window.loadURL(devServer)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

// Uma instancia so: abrir de novo traz a janela existente para frente.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  void app.whenReady().then(() => {
    registerIpc()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
