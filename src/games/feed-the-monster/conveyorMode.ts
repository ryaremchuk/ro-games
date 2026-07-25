/**
 * The CONVEYOR round mode — the belt on screen. Every rule it obeys is decided
 * in belt.ts (pure, tested); this file only draws the loop and enforces the
 * freeze rules.
 *
 * Follows the duoMode.ts template: a self-contained widget the scene delegates
 * to, so the polished still-tray flow is left completely untouched. It owns the
 * belt strip, the rollers, the kitchen hatch and one plate per dish, and it
 * REUSES the tray for the dishes themselves (`tray.makeFood`) — the drag
 * mechanics, the magnetic snap toward the mouth and the feed handoff are already
 * correct and shared, and a belt dish must behave exactly like a plate food the
 * moment it is picked up.
 *
 * The freeze rules, in order of how much frustration each one prevents:
 *  1. Touching a dish LIFTS IT OFF the belt — from pointerdown it stops moving.
 *  2. The belt eases to a stop while a dish is held, and resumes on release. So
 *     the child can look up at the bubble, think, and aim without the stream
 *     escaping. It reads as "the waiter pauses the belt for you".
 *  3. A returned dish rejoins the belt at its own lane — which, because the belt
 *     was paused the whole time it was held, is exactly where it left. No gap can
 *     appear and no dish can vanish.
 *  4. The belt never moves during a spit-back reaction, a celebration or a
 *     transition.
 */

import Phaser from 'phaser'
import { playTone } from '../../shared/audio'
import { wantsFood } from './logic'
import type { Round } from './logic'
import {
  FIRST_VISIBLE_SLOT,
  isSlotVisible,
  laneCount,
  laneSlot,
  msUntilReachable,
  needsRescue,
  nextDishFood,
  pickWantedFood,
  rescueLane,
  slotPitchX,
  stepMs,
} from './belt'
import type { BeltDials, BeltLaneSnapshot } from './belt'
import { artKey } from './art'
import * as layout from './layout'
import type { ConveyorState } from './testHook'
import type FeedTheMonsterScene from './FeedTheMonsterScene'

/** How long the belt takes to ease to a stop / back up to speed. */
const EASE_MS = 320
/**
 * Pause held after the finger lifts, so a dish arcing back to its lane
 * (Tray.returnToTray, ~450 ms) lands before the lane moves out from under it.
 */
const RESUME_DELAY_MS = 460
/** Plate under a dish, as a fraction of the pitch. */
const PLATE_W_MUL = 0.78
/** Tread scroll per pitch travelled, in texture px — pure decoration. */
const TREAD_SCROLL = 48

interface Lane {
  /** What rides this lane; null is a gap (an eaten dish leaves one behind). */
  foodId: string | null
  food: Phaser.GameObjects.Image | null
  plate: Phaser.GameObjects.Image
  /** Slot the lane held on the previous frame, to detect the hatch wrap. */
  lastSlot: number
  /** Was this lane's dish wanted while it rode the visible span un-taken? */
  passedWanted: boolean
}

export class ConveyorMode {
  /** True while a belt round is on stage (the scene serves food through here). */
  active = false

  private readonly scene: FeedTheMonsterScene
  private lanes: Lane[] = []
  /** Position along the loop in pitches; grows forever, read modulo laneCount. */
  private offset = 0
  /** 1 = full speed, 0 = stopped. Eased, never snapped (see EASE_MS). */
  private speed = { scale: 1 }
  private speedTween?: Phaser.Tweens.Tween
  private dials: BeltDials = { traverseMs: 18_000, maxWaitMs: 4_000, wantedEvery: 3 }
  private belt?: Phaser.GameObjects.TileSprite
  private rollers: Phaser.GameObjects.Image[] = []
  private hatch?: Phaser.GameObjects.Image
  /** The dish in the child's hand right now (lifted off the belt). */
  private held: Phaser.GameObjects.Image | null = null
  /** Wanted dishes that rode past un-taken — the belt meter's signal. */
  private missedPasses = 0

  constructor(scene: FeedTheMonsterScene) {
    this.scene = scene
  }

  private px(css: number): number {
    return css * this.scene.dpr
  }

  /** Wanted dishes that rode the visible span un-taken this round. */
  get misses(): number {
    return this.missedPasses
  }

  // ─── Start / serve ─────────────────────────────────────────────────────────

  /**
   * Stand the belt up for this round and load it. The bubble, the ghosting, the
   * spit-back, the growth — everything about the ROUND is unchanged; only the
   * source of the food differs.
   */
  serve(round: Round, dials: BeltDials): void {
    this.active = true
    this.dials = dials
    this.offset = 0
    this.missedPasses = 0
    this.held = null
    this.speed.scale = 1

    const m = this.scene.metrics()
    const visible = layout.visibleDishCount(m)
    const total = laneCount(visible)

    this.buildBelt()
    // The still plate row stands down; the belt carries its own plates.
    for (const plate of this.scene.tray.plates) plate.setVisible(false)
    this.scene.tray.clearFoods()
    // A belt dish's home is wherever its lane has ridden to — that is what makes
    // "arc back home" put it back ON the belt instead of onto a hidden plate.
    this.scene.tray.homeProvider = (img) => this.laneHome(img)

    // Seed the visible lanes straight from the round's tray composition, so the
    // very first thing the child sees already contains something they can feed;
    // the hidden lanes are scheduled, which starts the anti-drought machinery.
    this.lanes = []
    for (let i = 0; i < total; i++) {
      const plate = this.scene.add.image(0, 0, 'ftm-plate').setDepth(4)
      const lane: Lane = { foodId: null, food: null, plate, lastSlot: 0, passedWanted: false }
      this.lanes.push(lane)
      const slot = laneSlot(i, this.offset, total)
      const seeded = isSlotVisible(slot, total)
        ? round.tray[Math.floor(slot - FIRST_VISIBLE_SLOT) % round.tray.length]
        : this.scheduleFood(i)
      this.fillLane(i, seeded)
      lane.lastSlot = slot
    }
    this.place()
    // Release has to be a SCENE-level listener, not a per-dish one: a dish
    // dragged to the mouth comes up nowhere near its own sprite, so a
    // GameObject `pointerup` would never fire and the belt would stay frozen.
    this.scene.input.on('pointerup', this.release)
    this.scene.input.on('pointerupoutside', this.release)
    playTone(392, 90, 'triangle', 0.07)
    this.scene.time.delayedCall(120, () => playTone(523, 120, 'triangle', 0.07))
  }

  /** Tear the belt down and hand the still plate row back. */
  stop(): void {
    if (!this.active) return
    this.active = false
    this.scene.input.off('pointerup', this.release)
    this.scene.input.off('pointerupoutside', this.release)
    this.speedTween?.remove()
    this.speedTween = undefined
    this.held = null
    for (const lane of this.lanes) {
      this.scene.tweens.killTweensOf(lane.plate)
      lane.plate.destroy()
    }
    this.lanes = []
    this.belt?.destroy()
    this.belt = undefined
    for (const roller of this.rollers) roller.destroy()
    this.rollers = []
    this.hatch?.destroy()
    this.hatch = undefined
    this.scene.tray.homeProvider = null
    for (const plate of this.scene.tray.plates) plate.setVisible(true)
  }

  private buildBelt(): void {
    const m = this.scene.metrics()
    const tint = this.scene.episode.palette.table
    const h = layout.beltHeight(m)
    const y = layout.beltBandY(m)

    // A tileSprite so the tread genuinely scrolls with the belt; the strip
    // texture is authored to tile seamlessly left↔right (see textures.ts).
    const stripKey = this.scene.hasArt('belt-strip') ? artKey('belt-strip') : 'ftm-belt'
    this.belt = this.scene.add
      .tileSprite(m.w / 2, y, m.w, h, stripKey)
      .setDepth(3)
      .setTint(tint)

    // Rollers at the belt's two ends, inset by half their own width so the drum
    // is fully visible rather than half off screen.
    const rollerKey = this.scene.hasArt('belt-roller') ? artKey('belt-roller') : 'ftm-belt-roller'
    const rollerW = h * 0.92
    for (const side of [-1, 1] as const) {
      const roller = this.scene.add
        .image(side < 0 ? rollerW / 2 : m.w - rollerW / 2, y, rollerKey)
        .setDisplaySize(rollerW, rollerW)
        .setDepth(3)
        .setTint(tint)
      roller.setFlipX(side > 0)
      this.rollers.push(roller)
    }

    // The hatch dishes emerge from, at the belt's entry edge (the belt runs
    // left → right), drawn ABOVE the dishes so a dish slides out from behind it.
    // Anchored by its LEFT edge at x = 0: a centred hatch put half the doorway
    // off screen, which read as a brown box rather than a kitchen.
    const hatchKey = this.scene.hasArt('hatch') ? artKey('hatch') : 'ftm-hatch'
    const hatchW = h * 1.5
    this.hatch = this.scene.add
      .image(0, y - h * 0.42, hatchKey)
      .setOrigin(0, 1)
      .setDisplaySize(hatchW, h * 2.1)
      .setDepth(6)
      .setTint(tint)
  }

  // ─── Lanes ─────────────────────────────────────────────────────────────────

  /** Everything the pure scheduler needs to know about the OTHER lanes. */
  private snapshot(exclude: number): BeltLaneSnapshot[] {
    const total = this.lanes.length
    return this.lanes
      .map((lane, i) => ({ slot: laneSlot(i, this.offset, total), foodId: lane.foodId }))
      .filter((_, i) => i !== exclude)
  }

  private wanted = (foodId: string): boolean => {
    const round = this.scene.round
    return round ? wantsFood(round.request, this.scene.eaten, foodId) : false
  }

  /** Ask belt.ts what the next dish out of the hatch carries. */
  private scheduleFood(laneIndex: number): string {
    const round = this.scene.round
    const pool = round ? [...new Set(round.tray)] : []
    if (pool.length === 0) return ''
    return nextDishFood(
      {
        others: this.snapshot(laneIndex),
        lanes: this.lanes.length || laneCount(layout.visibleDishCount(this.scene.metrics())),
        step: stepMs(this.dials.traverseMs, layout.visibleDishCount(this.scene.metrics())),
        maxWaitMs: this.dials.maxWaitMs,
        wantedEvery: this.dials.wantedEvery,
        pool,
        wanted: this.wanted,
      },
      Math.random,
    )
  }

  private fillLane(index: number, foodId: string): void {
    const lane = this.lanes[index]
    if (!lane || foodId === '') return
    lane.foodId = foodId
    lane.passedWanted = false
    const at = this.dishPos(laneSlot(index, this.offset, this.lanes.length))
    lane.food = this.scene.tray.makeFood(foodId, at.x, at.y, index)
    lane.food.setData('lane', index)
    // Freeze rule 1+2: from pointerDOWN (not from the drag threshold) the dish is
    // in the child's hand and the belt pauses. Waiting for `dragstart` would let
    // the stream slide on under a finger that has already committed.
    lane.food.on('pointerdown', () => this.hold(lane.food!))
  }

  /** A lane's current dish position (the plate and the food share it). */
  private dishPos(slot: number): layout.XY {
    return layout.beltDishPos(this.scene.metrics(), slotPitchX(slot))
  }

  /** Where a held/returning dish belongs — its lane, wherever the belt has it. */
  private laneHome(img: Phaser.GameObjects.Image): layout.XY {
    const index = img.getData('lane') as number | undefined
    if (index === undefined || !this.lanes[index]) {
      return layout.beltDishPos(this.scene.metrics(), 0.5)
    }
    return this.dishPos(laneSlot(index, this.offset, this.lanes.length))
  }

  // ─── Freeze rules ──────────────────────────────────────────────────────────

  private hold(img: Phaser.GameObjects.Image): void {
    if (this.held) return
    this.held = img
    this.easeSpeed(0)
  }

  /**
   * The finger came up. Resumption waits out the arc-home tween: a dish flying
   * back to a lane that has already slid on would land visibly behind itself.
   */
  private release = (): void => {
    if (!this.held) return
    this.held = null
    this.scene.time.delayedCall(RESUME_DELAY_MS, () => {
      if (this.active && this.held === null) this.easeSpeed(1)
    })
  }

  private easeSpeed(to: number): void {
    this.speedTween?.remove()
    this.speedTween = this.scene.tweens.add({
      targets: this.speed,
      scale: to,
      duration: EASE_MS,
      ease: 'Sine.easeInOut',
    })
  }

  /** A dish left the belt for good (eaten): its lane becomes a gap. */
  noteEaten(img: Phaser.GameObjects.Image): void {
    const index = img.getData('lane') as number | undefined
    if (index === undefined) return
    const lane = this.lanes[index]
    if (!lane || lane.food !== img) return
    lane.foodId = null
    lane.food = null
    lane.passedWanted = false
    if (this.held === img) this.release()
  }

  // ─── Per-frame ─────────────────────────────────────────────────────────────

  /** Advance the loop and reposition everything. Frozen during celebrations. */
  update(deltaMs: number): void {
    if (!this.active || this.lanes.length === 0) return
    const m = this.scene.metrics()
    const visible = layout.visibleDishCount(m)
    const total = this.lanes.length
    // Freeze rule 4: nothing moves during a spit-back, a celebration or a
    // transition — the child's attention is owed to the reaction, not the belt.
    const moving = !this.scene.transitioning && this.held === null
    if (moving) {
      const step = stepMs(this.dials.traverseMs, visible)
      this.offset += (deltaMs / step) * this.speed.scale
      if (this.belt) this.belt.tilePositionX += (deltaMs / step) * TREAD_SCROLL * this.speed.scale
    }

    for (let i = 0; i < total; i++) {
      const lane = this.lanes[i]
      const slot = laneSlot(i, this.offset, total)
      // The wrap past the hatch is the spawn decision: a lane that has come all
      // the way round gets a fresh dish (or fills the gap an eaten one left).
      if (slot < lane.lastSlot) {
        if (lane.passedWanted) this.missedPasses++
        if (lane.food) {
          this.scene.tray.removeFood(lane.food)
          lane.food = null
          lane.foodId = null
        }
        this.fillLane(i, this.scheduleFood(i))
      }
      lane.lastSlot = slot
      // A MISS is a wanted dish that rode the WHOLE visible span un-taken, so it
      // only becomes one after being seen near the hatch end. Marking it anywhere
      // on the belt counted the initial seeding — dishes dealt mid-span, some
      // already at the far edge — as misses the child never had a chance at, and
      // three of them landed before the first feed.
      if (lane.foodId !== null && slot <= FIRST_VISIBLE_SLOT + 1 && this.wanted(lane.foodId)) {
        lane.passedWanted = true
      }

      this.placeLane(lane, slot, layout.dishPitch(m))
    }

    this.rescueIfDry(visible, total)
  }

  /**
   * The anti-drought guarantee, checked every frame: if the wait for a wanted dish
   * has grown past the budget, re-dress the lane currently BEHIND THE HATCH, which
   * is invisible by definition and always exists — so the rescue costs the child
   * nothing and shows them nothing.
   *
   * Doing this per frame rather than only when a lane wraps is what removes a
   * whole pitch of latency from the promise (see belt.needsRescue).
   */
  private rescueIfDry(visible: number, total: number): void {
    const round = this.scene.round
    if (!round || this.scene.transitioning) return
    const pool = [...new Set(round.tray)]
    if (pool.length === 0) return
    const snapshot = this.lanes.map((lane, i) => ({
      slot: laneSlot(i, this.offset, total),
      foodId: lane.foodId,
    }))
    const dry = needsRescue({
      others: snapshot,
      lanes: total,
      step: stepMs(this.dials.traverseMs, visible),
      maxWaitMs: this.dials.maxWaitMs,
      wantedEvery: this.dials.wantedEvery,
      pool,
      wanted: this.wanted,
    })
    if (!dry) return
    const index = rescueLane(snapshot)
    if (index === null) return
    const foodId = pickWantedFood(pool, this.wanted, Math.random)
    if (foodId === null) return
    const lane = this.lanes[index]
    if (lane.food) {
      this.scene.tray.removeFood(lane.food)
      lane.food = null
      lane.foodId = null
    }
    this.fillLane(index, foodId)
  }

  /** Put one lane's plate and dish where its slot says they belong. */
  private placeLane(lane: Lane, slot: number, pitch: number): void {
    const at = this.dishPos(slot)
    lane.plate.setVisible(lane.foodId !== null)
    lane.plate.setPosition(at.x, at.y + this.px(12))
    this.dressPlate(lane.plate, pitch)
    // The held dish and any dish mid-tween (arcing home, flying to a mouth) are
    // owned by the tray's animations — the belt must not fight them.
    const food = lane.food
    if (food && !food.active) {
      // The tray disposed of it (eaten, or a leftover tumbling away at the end
      // of the round); the lane becomes a gap the scheduler will refill.
      lane.food = null
      lane.foodId = null
      lane.passedWanted = false
    } else if (food && food !== this.held && food !== this.scene.tray.dragged) {
      if (!this.scene.tweens.isTweening(food)) food.setPosition(at.x, at.y)
    }
  }

  /** Skin one belt plate: the episode's doily marker, or the plate fallback. */
  private dressPlate(plate: Phaser.GameObjects.Image, pitch: number): void {
    const w = pitch * PLATE_W_MUL
    const marker = `marker-${this.scene.episode.id}`
    if (this.scene.hasArt(marker)) {
      if (plate.texture.key !== artKey(marker)) plate.setTexture(artKey(marker))
      plate.setDisplaySize(w, w * 0.5)
    } else {
      if (plate.texture.key !== 'ftm-plate') plate.setTexture('ftm-plate')
      plate.setDisplaySize(w, w * 0.55)
    }
  }

  /** Re-anchor the belt furniture after a resize / orientation change. */
  place(): void {
    if (!this.active) return
    this.belt?.destroy()
    for (const roller of this.rollers) roller.destroy()
    this.rollers = []
    this.hatch?.destroy()
    this.buildBelt()
    this.update(0)
  }

  /** Live belt state for the dev/e2e hook. */
  snapshotState(): ConveyorState {
    const m = this.scene.metrics()
    const total = this.lanes.length
    const step = stepMs(this.dials.traverseMs, layout.visibleDishCount(m))
    return {
      traverseMs: this.dials.traverseMs,
      maxWaitMs: this.dials.maxWaitMs,
      moving: this.held === null && !this.scene.transitioning,
      misses: this.missedPasses,
      dishes: this.lanes.flatMap((lane, i) => {
        if (lane.foodId === null) return []
        const slot = laneSlot(i, this.offset, total)
        const at = this.dishPos(slot)
        return [
          {
            foodId: lane.foodId,
            wanted: this.wanted(lane.foodId),
            visible: isSlotVisible(slot, total),
            msUntilReachable: msUntilReachable(slot, total, step),
            xCss: at.x / this.scene.dpr,
            yCss: at.y / this.scene.dpr,
          },
        ]
      }),
    }
  }
}
