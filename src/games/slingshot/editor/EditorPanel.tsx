import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { getEditorApi, subscribeEditor } from './bridge'
import type { AddKind, EditorSnapshot } from './bridge'

/**
 * DOM overlay for the hidden slingshot level editor (`#/slingshot?edit`).
 * Adult-facing tool — plain-text buttons are fine here (the child-facing
 * "no text" rule applies to the games, not this tuning panel). All state
 * lives in the Phaser scene; this panel only sends commands over the bridge
 * and re-renders from coarse snapshots (never per frame).
 */

const panelStyle: CSSProperties = {
  position: 'fixed',
  top: 8,
  right: 8,
  zIndex: 40,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  width: 190,
  maxHeight: 'calc(100dvh - 16px)',
  overflowY: 'auto',
  padding: 10,
  borderRadius: 12,
  background: 'rgba(20, 19, 38, 0.85)',
  color: '#fff',
  font: '12px system-ui, sans-serif',
  touchAction: 'auto',
}

const rowStyle: CSSProperties = { display: 'flex', gap: 4, flexWrap: 'wrap' }

const buttonStyle: CSSProperties = {
  font: '12px system-ui, sans-serif',
  padding: '5px 7px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.25)',
  background: 'rgba(255,255,255,0.12)',
  color: '#fff',
  cursor: 'pointer',
}

function Btn({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...buttonStyle,
        opacity: disabled ? 0.4 : 1,
        background: active ? 'rgba(107, 203, 119, 0.45)' : buttonStyle.background,
      }}
    >
      {children}
    </button>
  )
}

const ADD_BUTTONS: { kind: AddKind; label: string; icon: string }[] = [
  { kind: 'wood', label: 'Add wood block', icon: '🟫' },
  { kind: 'stone', label: 'Add stone block', icon: '🪨' },
  { kind: 'ice', label: 'Add ice block', icon: '🧊' },
  { kind: 'piggy', label: 'Add piggy', icon: '🐷' },
  { kind: 'ball', label: 'Add ball', icon: '⚽' },
  { kind: 'trampoline', label: 'Add trampoline', icon: '🍄' },
  { kind: 'seesaw', label: 'Add seesaw', icon: '⚖️' },
]

export default function EditorPanel() {
  const [snap, setSnap] = useState<EditorSnapshot | null>(null)
  const [json, setJson] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const jsonFocused = useRef(false)

  useEffect(() => {
    const apply = (next: EditorSnapshot) => {
      setSnap(next)
      // Keep the JSON box in sync with the draft — unless the user is editing it.
      if (!jsonFocused.current) {
        setJson(getEditorApi()?.exportJson() ?? '')
        setImportError(null)
      }
    }
    const unsubscribe = subscribeEditor(apply)
    const api = getEditorApi()
    if (api) apply(api.snapshot())
    return unsubscribe
  }, [])

  const api = getEditorApi()
  if (!snap || !api) {
    return (
      <div style={panelStyle} aria-label="Level editor loading">
        🛠 editor…
      </div>
    )
  }

  const editing = snap.mode === 'edit'

  const copyJson = async () => {
    const text = api.exportJson()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked (permissions): the textarea below has the same JSON.
    }
  }

  const applyJson = () => {
    const error = api.importJson(json)
    setImportError(error)
  }

  return (
    <div style={panelStyle} aria-label="Level editor">
      <div style={{ ...rowStyle, alignItems: 'center' }}>
        <strong style={{ marginRight: 'auto' }}>🛠 Level {snap.level}</strong>
        <Btn
          label="Previous level"
          onClick={() => api.regenerate(snap.level - 1)}
          disabled={snap.level <= 1}
        >
          −
        </Btn>
        <Btn label="Next level" onClick={() => api.regenerate(snap.level + 1)}>
          +
        </Btn>
        <Btn label="Reset level to generated" onClick={() => api.regenerate(snap.level)}>
          ↺
        </Btn>
      </div>

      <div style={rowStyle}>
        <Btn label="Edit mode" onClick={() => api.setMode('edit')} active={editing}>
          ✏️ Edit
        </Btn>
        <Btn label="Play test" onClick={() => api.setMode('play')} active={!editing}>
          ▶ Play
        </Btn>
      </div>

      <div style={rowStyle}>
        {ADD_BUTTONS.map((b) => (
          <Btn key={b.kind} label={b.label} onClick={() => api.add(b.kind)} disabled={!editing}>
            {b.icon}
          </Btn>
        ))}
      </div>

      <div style={rowStyle}>
        <Btn
          label="Rotate left 15 degrees"
          onClick={() => api.rotateSelected(-15)}
          disabled={!editing || snap.selection !== 'block'}
        >
          ⟲
        </Btn>
        <Btn
          label="Rotate right 15 degrees"
          onClick={() => api.rotateSelected(15)}
          disabled={!editing || snap.selection !== 'block'}
        >
          ⟳
        </Btn>
        <Btn
          label="Delete selected"
          onClick={() => api.deleteSelected()}
          disabled={!editing || snap.selection === null}
        >
          🗑
        </Btn>
        <span style={{ alignSelf: 'center', opacity: 0.8 }}>
          {snap.selection ? `· ${snap.selection}` : '· tap to select'}
        </span>
      </div>

      <div aria-label="Level status" style={{ opacity: 0.9 }}>
        🧱{snap.blocks} 🐷{snap.piggies} ⚙️{snap.props}{' '}
        {snap.reachable ? '🎯' : '⚠️ no reachable piggy'}
      </div>

      <div style={rowStyle}>
        <Btn label="Copy level JSON" onClick={copyJson}>
          {copied ? '✅ Copied' : '📋 Copy JSON'}
        </Btn>
        <Btn label="Apply JSON" onClick={applyJson}>
          ⤵ Apply
        </Btn>
      </div>
      {importError && (
        <div role="alert" style={{ color: '#ff8fab' }}>
          {importError}
        </div>
      )}
      <textarea
        aria-label="Level JSON"
        value={json}
        spellCheck={false}
        onChange={(e) => setJson(e.target.value)}
        onFocus={() => {
          jsonFocused.current = true
        }}
        onBlur={() => {
          jsonFocused.current = false
        }}
        style={{
          width: '100%',
          height: 140,
          resize: 'vertical',
          font: '10px ui-monospace, monospace',
          color: '#d8f3dc',
          background: 'rgba(0,0,0,0.45)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 8,
          userSelect: 'text',
          WebkitUserSelect: 'text',
        }}
      />
    </div>
  )
}
