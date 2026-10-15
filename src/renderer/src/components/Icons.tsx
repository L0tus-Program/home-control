/** Icones inline: nada de fonte externa, o CSP do app so permite 'self'. */

interface IconProps {
  size?: number
}

const base = (size: number): React.SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
})

export const PowerIcon = ({ size = 17 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M12 3v9" />
    <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
  </svg>
)

export const SettingsIcon = ({ size = 16 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </svg>
)

export const RefreshIcon = ({ size = 16 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M21 12a9 9 0 1 1-2.6-6.4" />
    <path d="M21 3v5h-5" />
  </svg>
)

export const MinimizeIcon = (): React.JSX.Element => (
  <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
    <rect x="0" y="5" width="11" height="1" fill="currentColor" />
  </svg>
)

export const MaximizeIcon = (): React.JSX.Element => (
  <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
    <rect x="0.5" y="0.5" width="10" height="10" fill="none" stroke="currentColor" />
  </svg>
)

export const CloseIcon = (): React.JSX.Element => (
  <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
    <path d="M0 0 L11 11 M11 0 L0 11" stroke="currentColor" strokeWidth="1.1" />
  </svg>
)

export const SnowflakeIcon = ({ size = 15 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M12 2v20M4.2 6.5l15.6 9M19.8 6.5l-15.6 9" />
  </svg>
)

export const EditIcon = ({ size = 15 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  </svg>
)

export const PlusIcon = ({ size = 15 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const RotateIcon = ({ size = 15 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 4v7h-7" />
  </svg>
)

export const TrashIcon = ({ size = 15 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
)
