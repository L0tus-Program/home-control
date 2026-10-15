import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { realtimeActive, startRealtime, stopRealtime } from './realtime/service'

const isDev = !app.isPackaged
const PROFILE_NAME = 'home-control'

/**
 * Usa um único perfil de usuário por máquina, com o mesmo nome em
 * desenvolvimento e no instalador. Sem isso, o Electron usa pastas diferentes
 * para cada um e a conta conectada parece sumir ao alternar entre eles.
 */
function configureUserData(): void {
  app.setName(PROFILE_NAME)
  app.setPath('userData', join(app.getPath('appData'), PROFILE_NAME))
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

const captureMode = isDev && process.env.HOME_CONTROL_REALTIME_CAPTURE === '1'

if (captureMode) {
  // Diagnostico do tempo real: sem janela, grava e encerra. Nunca junto com o
  // app aberto: os dois disputariam a sessao Tuya e o client id da LG.
  if (!app.requestSingleInstanceLock()) {
    console.error('Feche o Home Control antes de rodar a captura de tempo real.')
    app.exit(1)
  }
  void app.whenReady().then(async () => {
    const seconds = Number(process.env.HOME_CONTROL_REALTIME_CAPTURE_SECONDS) || 60
    // Rede presa nao pode deixar um Electron invisivel rodando para sempre.
    const watchdog = setTimeout(() => { console.error('Captura excedeu o tempo.'); app.exit(1) }, (seconds + 120) * 1000)
    try {
      const { runRealtimeCapture } = await import('./realtime/capture')
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      await runRealtimeCapture(join(app.getPath('userData'), `realtime-capture-${stamp}.jsonl`), {
        durationMs: seconds * 1000,
        probe: process.env.HOME_CONTROL_REALTIME_PROBE === '1'
      })
    } catch (cause) {
      console.error(cause)
      process.exitCode = 1
    } finally {
      clearTimeout(watchdog)
      app.quit()
    }
  })
} else if (!app.requestSingleInstanceLock()) {
  // Uma instancia so: abrir de novo traz a janela existente para frente.
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
    startRealtime()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  // Fecha os canais MQTT antes de sair, sem segurar o encerramento.
  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting || !realtimeActive()) return
    quitting = true
    event.preventDefault()
    void stopRealtime().finally(() => app.quit())
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
