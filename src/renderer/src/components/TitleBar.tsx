import { CloseIcon, MaximizeIcon, MinimizeIcon } from './Icons'

export function TitleBar(): React.JSX.Element {
  return (
    <div className="titlebar">
      <div className="titlebar__brand">
        <span className="titlebar__dot" />
        Home Control
      </div>
      <div className="titlebar__controls">
        <button type="button" aria-label="Minimizar" onClick={() => window.home.window.minimize()}>
          <MinimizeIcon />
        </button>
        <button type="button" aria-label="Maximizar" onClick={() => window.home.window.maximize()}>
          <MaximizeIcon />
        </button>
        <button type="button" aria-label="Fechar" onClick={() => window.home.window.close()}>
          <CloseIcon />
        </button>
      </div>
    </div>
  )
}
