import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { EPISODES, FRIENDS_PER_EPISODE, GROW_STEPS } from './journey'

/**
 * Developer cheat overlay for Feed the Monster, shown only when the URL
 * carries `?dev` (e.g. `#/feed-the-monster?dev`). It drives the scene through
 * the dev hooks on `window.__feedTheMonster` (installed by the same `?dev`
 * gate — see FeedTheMonsterScene.exposeTestApi):
 *
 *   • Hero level   — grow/shrink the current friend one step
 *   • Friends      — add/remove grown friends in the lineup
 *   • Episode      — jump to the next/previous theme
 *   • Regenerate   — re-deal the current round as a fresh task
 *   • Big bite     — dress the current round as a big bite on demand
 *   • Duo          — start a two-friend bonus round
 *   • Conveyor     — re-deal this round on the sushi belt
 *   • Thief / 🦋   — send a visitor in now (go and no-go)
 *   • Commission   — open the pixel pad ("draw me something")
 *   • Wipe drawn   — retire the drawn foods (the gallery keeps the art)
 *
 * Every ROUND MODE has a button here on purpose: each one is rare by design
 * (gated on skill, spacing and chance), so without a way to summon it an adult
 * cannot see it on the device at all.
 *
 * Not for the child: it's an adult debugging tool, so this uses plain text
 * (unlike every child-facing surface). The scene installs its hook
 * asynchronously (Phaser boot) and rounds auto-advance, so we poll to keep the
 * readouts live rather than assuming the handle is ready at mount.
 */

interface DevSnapshot {
  round: number
  taskKind: string | null
  episode: number
  episodeId: string
  friendsFed: number
  growthStep: number
  duoActive: boolean
  bigBite: boolean
  conveyorActive: boolean
  beltSkill: number
  thiefSkill: number
  visitor: string | null
  drawnFoods: number
  commission: string | null
}

function readSnapshot(): DevSnapshot | null {
  const api = window.__feedTheMonster
  if (!api) return null
  const s = api.state()
  return {
    round: s.round,
    taskKind: s.taskKind,
    episode: s.journey.episode,
    episodeId: s.episodeId,
    friendsFed: s.journey.friendsFed,
    growthStep: s.journey.growthStep,
    duoActive: s.duoActive,
    bigBite: s.bigBite,
    conveyorActive: s.conveyorActive,
    beltSkill: s.beltSkill,
    thiefSkill: s.thiefSkill,
    visitor: s.visitor ? `${s.visitor.kind}:${s.visitor.phase}` : null,
    drawnFoods: s.drawnFoodIds.length,
    commission: s.commission ? s.commission.color : null,
  }
}

export default function FeedDevPanel() {
  const [snap, setSnap] = useState<DevSnapshot | null>(readSnapshot)

  useEffect(() => {
    const id = window.setInterval(() => setSnap(readSnapshot()), 400)
    return () => window.clearInterval(id)
  }, [])

  const act = (call: (api: NonNullable<Window['__feedTheMonster']>) => void) => {
    const api = window.__feedTheMonster
    if (!api) return
    call(api)
    setSnap(readSnapshot()) // reflect instantly, don't wait for the next poll
  }

  const ready = snap !== null
  const themeCount = EPISODES.length
  const episodeLabel = ready ? `${snap.episode} · ${snap.episodeId}` : '—'

  return (
    <div style={styles.panel} aria-hidden>
      <div style={styles.title}>DEV</div>

      <Row
        label="Hero"
        value={ready ? `${snap.growthStep} / ${GROW_STEPS - 1}` : '—'}
        onMinus={() => act((a) => a.devHeroLevel(-1))}
        onPlus={() => act((a) => a.devHeroLevel(1))}
      />
      <Row
        label="Friends"
        value={ready ? `${snap.friendsFed} / ${FRIENDS_PER_EPISODE - 1}` : '—'}
        onMinus={() => act((a) => a.devFriends(-1))}
        onPlus={() => act((a) => a.devFriends(1))}
      />
      <Row
        label={`Episode (${themeCount})`}
        value={episodeLabel}
        onMinus={() => act((a) => a.devEpisode(-1))}
        onPlus={() => act((a) => a.devEpisode(1))}
      />

      <button type="button" style={styles.regen} onClick={() => act((a) => a.devRegenerate())}>
        ↻ Random task (any kind)
      </button>

      <div style={styles.chips}>
        {TASK_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            style={styles.chip}
            onClick={() => act((a) => a.forceKind(kind))}
          >
            {kind}
          </button>
        ))}
      </div>

      {/* One button per ROUND MODE. Each is rare by design, so this is the only
          way to see it on the device without grinding the axes that gate it. */}
      <div style={styles.modes}>
        <button type="button" style={styles.mode} onClick={() => act((a) => a.forceDuo())}>
          ✌ Duo
        </button>
        <button
          type="button"
          style={{
            ...styles.mode,
            background: snap?.conveyorActive ? '#4d96ff' : '#f4a259',
            color: '#fff',
          }}
          onClick={() => act((a) => a.forceConveyor())}
        >
          🍣 Belt
        </button>
        <button type="button" style={styles.mode} onClick={() => act((a) => a.forceKind('dish'))}>
          🍲 Cook
        </button>
        <button
          type="button"
          style={styles.mode}
          onClick={() => act((a) => a.forceKind('dish-ordered'))}
        >
          🍲 Order
        </button>
        <button
          type="button"
          style={styles.mode}
          onClick={() => act((a) => a.forceVisitor('thief'))}
        >
          🐦 Thief
        </button>
        <button
          type="button"
          style={styles.mode}
          onClick={() => act((a) => a.forceVisitor('butterfly'))}
        >
          🦋 No-go
        </button>
        <button type="button" style={styles.mode} onClick={() => act((a) => a.forceCommission())}>
          ✏️ Draw
        </button>
        <button type="button" style={styles.mode} onClick={() => act((a) => a.wipeDrawnFoods())}>
          🧹 Wipe
        </button>
      </div>

      <button
        type="button"
        style={{
          ...styles.duo,
          background: snap?.bigBite ? '#ffc233' : 'rgba(255, 255, 255, 0.14)',
          color: snap?.bigBite ? '#1a1622' : '#fff',
        }}
        onClick={() => act((a) => a.devBigBite(!snap?.bigBite))}
      >
        ★ Big bite {snap?.bigBite ? 'ON' : 'off'}
      </button>

      <div style={styles.readout}>
        {ready
          ? snap.commission !== null
            ? `commission · ${snap.commission}`
            : snap.duoActive
              ? `round ${snap.round} · DUO`
              : `round ${snap.round} · ${snap.taskKind ?? '—'}${snap.conveyorActive ? ' · BELT' : ''}`
          : 'waiting for scene…'}
      </div>
      {ready && (
        <div style={styles.readout}>
          belt {snap.beltSkill} · thief {snap.thiefSkill} · drawn {snap.drawnFoods}
          {snap.visitor !== null ? ` · ${snap.visitor}` : ''}
        </div>
      )}
    </div>
  )
}

// Every task kind, for the one-tap jump chips (bypasses the meter gate). The two
// kitchen kinds get their own buttons below — they are big enough beats to want
// naming, not a chip in a grid.
const TASK_KINDS = ['single', 'count', 'color', 'combo', 'dots', 'mix', 'not', 'pattern'] as const

function Row({
  label,
  value,
  onMinus,
  onPlus,
}: {
  label: string
  value: string
  onMinus: () => void
  onPlus: () => void
}) {
  return (
    <div style={styles.row}>
      <span style={styles.label}>{label}</span>
      <button type="button" style={styles.step} onClick={onMinus}>
        −
      </button>
      <span style={styles.value}>{value}</span>
      <button type="button" style={styles.step} onClick={onPlus}>
        +
      </button>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  panel: {
    position: 'fixed',
    top: 'max(12px, env(safe-area-inset-top))',
    right: 'max(12px, env(safe-area-inset-right))',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '10px 12px',
    borderRadius: 14,
    background: 'rgba(20, 18, 28, 0.86)',
    color: '#fff',
    font: '600 13px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace',
    boxShadow: '0 6px 18px rgba(0, 0, 0, 0.35)',
    userSelect: 'none',
    touchAction: 'manipulation',
  },
  title: {
    fontSize: 11,
    letterSpacing: 2,
    opacity: 0.6,
    textAlign: 'center',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    flex: 1,
    fontSize: 12,
    opacity: 0.85,
  },
  value: {
    minWidth: 68,
    textAlign: 'center',
    fontVariantNumeric: 'tabular-nums',
  },
  step: {
    width: 30,
    height: 30,
    flexShrink: 0,
    border: 'none',
    borderRadius: 8,
    background: 'rgba(255, 255, 255, 0.16)',
    color: '#fff',
    fontSize: 18,
    lineHeight: 1,
    cursor: 'pointer',
    touchAction: 'manipulation',
  },
  regen: {
    marginTop: 2,
    height: 32,
    border: 'none',
    borderRadius: 8,
    background: '#4d96ff',
    color: '#fff',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    touchAction: 'manipulation',
  },
  chips: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 4,
  },
  chip: {
    height: 26,
    border: 'none',
    borderRadius: 6,
    background: 'rgba(255, 255, 255, 0.14)',
    color: '#fff',
    fontSize: 10,
    fontWeight: 600,
    cursor: 'pointer',
    touchAction: 'manipulation',
  },
  modes: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 4,
  },
  mode: {
    height: 30,
    border: 'none',
    borderRadius: 8,
    background: 'rgba(255, 255, 255, 0.16)',
    color: '#fff',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    touchAction: 'manipulation',
  },
  duo: {
    height: 30,
    border: 'none',
    borderRadius: 8,
    background: '#f4a259',
    color: '#1a1622',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    touchAction: 'manipulation',
  },
  readout: {
    fontSize: 11,
    opacity: 0.6,
    textAlign: 'center',
  },
}
