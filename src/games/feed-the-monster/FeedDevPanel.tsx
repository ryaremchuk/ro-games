import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { COMMISSION_MIN_EPISODE, EPISODES, FRIENDS_PER_EPISODE, GROW_STEPS } from './journey'
import type { FeedTestState } from './testHook'

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
 *
 * A tap that cannot land SAYS SO (the ⛔ line). Every force returns a boolean and
 * this panel used to drop it on the floor, so a busy scene — a celebration mid-flight
 * — was indistinguishable from a broken overlay ("I press belt and after that no
 * button works"). The scene now stands a rare mode down instead of refusing, which
 * leaves exactly one honest refusal to report.
 */

interface DevSnapshot {
  round: number
  transitioning: boolean
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
  /** One line answering "why did the drawing ask (not) just fire?". */
  drawGate: string
}

function readSnapshot(): DevSnapshot | null {
  const api = window.__feedTheMonster
  if (!api) return null
  const s = api.state()
  return {
    round: s.round,
    transitioning: s.transitioning,
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
    commission: s.commission ? `${s.commission.color}:${s.commission.phase}` : null,
    drawGate: describeGate(s),
  }
}

/**
 * The trigger rule in one line. Ros could not tell when the drawing ask fires, and
 * the honest fix for that on the device is to print the live rule: what it would
 * ask for now, or which gate is holding it, plus the two inputs an adult would
 * otherwise have to guess (when it last fired, and whether the ask names a colour
 * yet).
 */
function describeGate(s: FeedTestState): string {
  const g = s.commissionGate
  const names = g.namesColor ? 'colour' : 'anything'
  const last = g.lastEpisode < 0 ? 'never' : `ep${g.lastEpisode}`
  const owned = g.ownedColors.length
  const verdict =
    g.dueColor !== null
      ? `DUE ${g.dueColor}`
      : g.blockedBy === 'episode'
        ? `wait: ep ≥ ${COMMISSION_MIN_EPISODE}`
        : g.blockedBy === 'already-this-episode'
          ? 'done this ep'
          : g.blockedBy === 'friend-in-progress'
            ? 'mid-friend'
            : 'no'
  return `${verdict} · asks ${names} · last ${last} · owns ${owned}/6`
}

export default function FeedDevPanel() {
  const [snap, setSnap] = useState<DevSnapshot | null>(readSnapshot)
  /**
   * Why the last tap did nothing, or null. Every force returns a boolean, and a
   * refusal used to be swallowed — which is what "the panel stops responding" was:
   * a legitimately busy game, indistinguishable from a broken overlay. Now a
   * refusal is SHOWN, so an adult knows to wait a beat instead of mashing. It
   * fades on its own (the poll below re-renders), so it always describes the tap
   * just made rather than one from a minute ago.
   */
  const [refused, setRefused] = useState<{ msg: string; at: number } | null>(null)
  /**
   * Wall-clock start of the celebration the scene is in, tracked by the poll below.
   * A celebration is the one state that legitimately refuses a tap — and a
   * celebration that never ends is the soft-lock class this game keeps having to
   * defend against, so a refusal can say WHICH of the two it is instead of leaving
   * an adult to guess. Wall-clock is the honest unit: the thing being caught is a
   * Phaser clock that has stopped advancing.
   */
  const heldSinceRef = useRef(performance.now())

  useEffect(() => {
    const id = window.setInterval(() => {
      const next = readSnapshot()
      setSnap(next)
      if (next === null || !next.transitioning) heldSinceRef.current = performance.now()
    }, 400)
    return () => window.clearInterval(id)
  }, [])

  const act = (call: (api: NonNullable<Window['__feedTheMonster']>) => boolean | void) => {
    const api = window.__feedTheMonster
    if (!api) {
      setRefused({ msg: 'no scene', at: performance.now() })
      return
    }
    const accepted = call(api) !== false
    const state = readSnapshot()
    const now = performance.now()
    setSnap(state) // reflect instantly, don't wait for the next poll
    setRefused(accepted ? null : { msg: busyReason(state, now - heldSinceRef.current), at: now })
  }

  const ready = snap !== null
  const refusal =
    refused !== null && performance.now() - refused.at < REFUSAL_SHOWN_MS ? refused.msg : null
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
      {/* The drawing ask is the rarest beat in the game (once per episode), so its
          gate gets its own line — otherwise "why has this never happened?" has no
          answer on the device. */}
      {ready && <div style={styles.readout}>✏️ {snap.drawGate}</div>}
      {/* A refused tap says so, out loud. Silence here was the whole bug report. */}
      {refusal !== null && <div style={styles.refused}>⛔ {refusal}</div>}
    </div>
  )
}

/**
 * What the scene is busy with, for a refused tap. The forces refuse for exactly
 * one reason (a celebration's tween chain must not be severed — see the scene's
 * devTakeStage), plus two states that are their own answer: no duo over a duo, no
 * second ask over an open one.
 */
function busyReason(snap: DevSnapshot | null, heldMs: number): string {
  if (snap === null) return 'no scene'
  if (snap.transitioning) {
    // Every celebration is over inside a few seconds; a longer one is a bug worth
    // naming on the device rather than a beat worth waiting out.
    const secs = Math.round(heldMs / 1000)
    return secs > 6 ? `celebrating for ${secs}s — STUCK?` : 'celebrating — wait a beat'
  }
  if (snap.commission !== null) return 'already asking'
  if (snap.duoActive) return 'duo already on stage'
  if (snap.round === 0) return 'first round not dealt yet'
  return 'not right now'
}

/** How long a refused tap stays on screen (a couple of polls past reading it). */
const REFUSAL_SHOWN_MS = 2_600

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
  refused: {
    fontSize: 11,
    fontWeight: 700,
    textAlign: 'center',
    color: '#ff8f6b',
  },
}
