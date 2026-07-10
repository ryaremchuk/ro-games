import { useEffect, useState } from 'react'

/**
 * Hidden diagnostics page (#/viewport-debug) for chasing iOS viewport bugs on
 * a real device — not registered in the game registry, adults only. Shows
 * every viewport metric plus colored edge markers so a screenshot tells us
 * exactly which "bottom" each unit reaches:
 *   green = bottom of #root (app shell), blue = 100dvh, red = 100lvh,
 *   the page background (yellow) = document/ICB itself.
 * Any white strip BELOW the red line is outside the webview entirely.
 */
export default function ViewportDebug() {
  const [, setTick] = useState(0)

  useEffect(() => {
    const bump = () => setTick((t) => t + 1)
    window.addEventListener('resize', bump)
    window.addEventListener('orientationchange', bump)
    window.visualViewport?.addEventListener('resize', bump)
    window.visualViewport?.addEventListener('scroll', bump)
    const id = window.setInterval(bump, 1000)
    return () => {
      window.removeEventListener('resize', bump)
      window.removeEventListener('orientationchange', bump)
      window.visualViewport?.removeEventListener('resize', bump)
      window.visualViewport?.removeEventListener('scroll', bump)
      window.clearInterval(id)
    }
  }, [])

  const vv = window.visualViewport
  const root = document.getElementById('root')
  const probe = (property: string): string => {
    const el = document.createElement('div')
    el.style.position = 'fixed'
    el.style.visibility = 'hidden'
    el.style.height = property
    document.body.appendChild(el)
    const px = el.getBoundingClientRect().height.toFixed(1)
    el.remove()
    return px
  }
  const env = (name: string): string => {
    const el = document.createElement('div')
    el.style.position = 'fixed'
    el.style.visibility = 'hidden'
    el.style.height = `env(${name}, -1px)`
    document.body.appendChild(el)
    const px = el.getBoundingClientRect().height.toFixed(1)
    el.remove()
    return px
  }

  const rows: Array<[string, string]> = [
    ['screen.width × height', `${screen.width} × ${screen.height}`],
    ['window.inner W × H', `${window.innerWidth} × ${window.innerHeight}`],
    ['visualViewport W × H', vv ? `${vv.width.toFixed(1)} × ${vv.height.toFixed(1)}` : 'n/a'],
    ['visualViewport offsetTop', vv ? vv.offsetTop.toFixed(1) : 'n/a'],
    ['#root clientW × H', root ? `${root.clientWidth} × ${root.clientHeight}` : 'n/a'],
    ['100svh / 100dvh / 100lvh', `${probe('100svh')} / ${probe('100dvh')} / ${probe('100lvh')}`],
    ['100vh', probe('100vh')],
    ['safe-area top / bottom', `${env('safe-area-inset-top')} / ${env('safe-area-inset-bottom')}`],
    ['devicePixelRatio', String(window.devicePixelRatio)],
    ['standalone display-mode', String(window.matchMedia('(display-mode: standalone)').matches)],
  ]

  const marker = (height: string, color: string, label: string, offset: number) => (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height,
        pointerEvents: 'none',
        borderBottom: `4px solid ${color}`,
        boxSizing: 'border-box',
      }}
    >
      <span
        style={{
          position: 'absolute',
          bottom: 4,
          left: 8 + offset,
          color,
          font: 'bold 12px monospace',
          background: 'rgba(255,255,255,0.85)',
          padding: '1px 4px',
        }}
      >
        {label}
      </span>
    </div>
  )

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: '#fff3bf',
        color: '#1a1a1a',
        font: '13px/1.6 monospace',
        padding: '60px 16px 16px',
        // The page itself paints the ICB yellow; touches log a dot so the
        // "can I draw at the very bottom?" question is answerable here too.
        touchAction: 'none',
      }}
      onPointerDown={(e) => {
        const dot = document.createElement('div')
        dot.style.cssText = `position:fixed;left:${e.clientX - 6}px;top:${e.clientY - 6}px;width:12px;height:12px;border-radius:50%;background:#e8590c;z-index:99`
        e.currentTarget.appendChild(dot)
      }}
    >
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td style={{ paddingRight: 12, opacity: 0.7 }}>{k}</td>
              <td style={{ fontWeight: 700 }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {marker('100%', '#2f9e44', '100% (#root/ICB)', 0)}
      {marker('100dvh', '#1971c2', '100dvh', 140)}
      {marker('100lvh', '#e03131', '100lvh', 230)}
    </div>
  )
}
