import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { playTone } from '../../shared/audio'
import './DrawingGame.css'

const COLORS = [
  '#e53935',
  '#fb8c00',
  '#fdd835',
  '#43a047',
  '#1e88e5',
  '#8e24aa',
  '#6d4c41',
  '#000000',
]
const SIZES = [8, 20, 40]
const WHITE = '#ffffff'

interface Point {
  x: number
  y: number
}

export default function DrawingGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const drawing = useRef(false)
  const lastPoint = useRef<Point | null>(null)
  const lastMid = useRef<Point | null>(null)

  const [color, setColor] = useState<string>(COLORS[0])
  const [size, setSize] = useState<number>(SIZES[1])
  const [eraser, setEraser] = useState(false)

  // Keep the latest tool settings available to the imperative pointer handlers.
  const tool = useRef({ color, size, eraser })
  tool.current = { color, size, eraser }

  // Set up the canvas and keep it sized for a crisp, hi-DPI drawing surface.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctxRef.current = ctx

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const { clientWidth, clientHeight } = canvas

      // Preserve the current drawing across the resize.
      const snapshot = document.createElement('canvas')
      snapshot.width = canvas.width
      snapshot.height = canvas.height
      snapshot.getContext('2d')?.drawImage(canvas, 0, 0)

      canvas.width = Math.round(clientWidth * dpr)
      canvas.height = Math.round(clientHeight * dpr)

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = WHITE
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(snapshot, 0, 0)

      // Draw in CSS pixels; the transform scales to device pixels.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
    }

    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('orientationchange', resize)
    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('orientationchange', resize)
    }
  }, [])

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const strokeColor = () => (tool.current.eraser ? WHITE : tool.current.color)

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    const ctx = ctxRef.current
    if (!ctx) return
    canvasRef.current?.setPointerCapture(event.pointerId)

    drawing.current = true
    const point = pointFromEvent(event)
    lastPoint.current = point
    lastMid.current = point

    // A tap leaves a dot.
    ctx.beginPath()
    ctx.fillStyle = strokeColor()
    ctx.arc(point.x, point.y, tool.current.size / 2, 0, Math.PI * 2)
    ctx.fill()

    playTone(tool.current.eraser ? 240 : 520, 55, 'sine', 0.06)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    event.preventDefault()
    const ctx = ctxRef.current
    const last = lastPoint.current
    const mid = lastMid.current
    if (!ctx || !last || !mid) return

    const point = pointFromEvent(event)
    const newMid = { x: (last.x + point.x) / 2, y: (last.y + point.y) / 2 }

    // A quadratic curve through the previous raw point smooths fast strokes.
    ctx.strokeStyle = strokeColor()
    ctx.lineWidth = tool.current.size
    ctx.beginPath()
    ctx.moveTo(mid.x, mid.y)
    ctx.quadraticCurveTo(last.x, last.y, newMid.x, newMid.y)
    ctx.stroke()

    lastPoint.current = point
    lastMid.current = newMid
  }

  const endStroke = () => {
    drawing.current = false
    lastPoint.current = null
    lastMid.current = null
  }

  const clearCanvas = () => {
    const ctx = ctxRef.current
    const canvas = canvasRef.current
    if (!ctx || !canvas) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = WHITE
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
    playTone(660, 120, 'triangle', 0.1)
  }

  return (
    <div className="drawing">
      <canvas
        ref={canvasRef}
        className="drawing-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onPointerLeave={endStroke}
      />
      <div className="drawing-toolbar">
        <div className="drawing-colors">
          {COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={`swatch${!eraser && color === swatch ? ' is-active' : ''}`}
              style={{ backgroundColor: swatch }}
              onClick={() => {
                setColor(swatch)
                setEraser(false)
              }}
              aria-label={`Color ${swatch}`}
            />
          ))}
        </div>
        <div className="drawing-sizes">
          {SIZES.map((value) => (
            <button
              key={value}
              type="button"
              className={`size-button${!eraser && size === value ? ' is-active' : ''}`}
              onClick={() => {
                setSize(value)
                setEraser(false)
              }}
              aria-label={`Brush size ${value}`}
            >
              <span
                className="size-dot"
                style={{ width: value, height: value, background: color }}
              />
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`tool-button${eraser ? ' is-active' : ''}`}
          onClick={() => setEraser(true)}
          aria-label="Eraser"
        >
          🧽
        </button>
        <button
          type="button"
          className="tool-button"
          onClick={clearCanvas}
          aria-label="Clear everything"
        >
          🗑️
        </button>
      </div>
    </div>
  )
}
