import { Html } from '@react-three/drei'
import type { Device } from '../../../../../shared/types'

interface Props {
  device: Device
  position: [number, number, number]
  active: boolean
}

export function DeviceTooltip({ device, position, active }: Props): React.JSX.Element | null {
  if (!active) return null
  const isOn = device.state.power && device.state.online !== false
  const status =
    device.driverId === 'tuya' && !device.state.online
      ? 'Offline'
      : isOn
        ? device.kind === 'air-conditioner'
          ? `${Math.round(device.state.temperature ?? 24)}°C · ${device.state.mode ?? 'cool'}`
          : `${Math.round(device.state.brightness ?? 100)}%`
        : 'Desligado'

  return (
    <Html position={position} center distanceFactor={12} zIndexRange={[100, 200]}>
      <div
        style={{
          padding: '8px 12px',
          borderRadius: '14px',
          background: 'rgba(8, 12, 18, 0.92)',
          border: '1px solid rgba(124, 140, 255, 0.35)',
          color: '#fff',
          fontSize: '12px',
          fontFamily: 'Inter, system-ui, sans-serif',
          whiteSpace: 'nowrap',
          boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
          backdropFilter: 'blur(12px)',
          transform: 'translateY(-12px)',
          pointerEvents: 'none'
        }}
      >
        <strong style={{ display: 'block', fontWeight: 600, marginBottom: '2px' }}>{device.name}</strong>
        <span style={{ color: 'rgba(255,255,255,0.65)' }}>{status}</span>
      </div>
    </Html>
  )
}
