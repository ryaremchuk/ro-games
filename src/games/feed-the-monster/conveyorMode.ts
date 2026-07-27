/**
 * The CONVEYOR round mode — the belt on screen. Every rule it obeys is decided
 * in belt.ts (pure, tested); this file only draws the loop and enforces the
 * lift rules.
 *
 * Follows the duoMode.ts template: a self-contained widget the scene delegates
 * to, so the polished still-tray flow is left completely untouched. It owns the
 * belt strip, the two end rollers and one plate per dish, and it REUSES the tray
 * for the dishes themselves (`tray.makeFood`) — the drag mechanics, the magnetic
 * snap toward the mouth and the feed handoff are already correct and shared, and
 * a belt dish must behave exactly like a plate food the moment it is picked up.
 *
 * **The belt never stops.** Not while a dish is held, not during a spit-back, not
 * through the celebration that ends the round. A belt that halts stops being a
 * belt — the whole read of the mechanic ("food keeps coming, wait for yours") is
 * carried by constant motion, and a child who has just seen the world freeze under
 * their finger has learned that touching things pauses the game.
 *
 * The lift rules, which are what make a never-stopping belt safe:
 *  1. Touching a dish LIFTS IT CLEAN OFF its plate. From pointerdown it is an
 *     ordinary dragged object: it cannot slide out from under the finger, so no
 *     stop is needed to protect the drag. Motion stays in the SCAN only.
 *  2. **Its plate keeps riding, empty**, and is CLAIMED for it. That is the whole
 *     of the parent's "кращий УІ": the plate you took your food off is visibly
 *     still yours, going round with everything else.
 *  3. A dish let go without being fed always lands on a plate again — its own, or
 *     the nearest free one in view (belt.returnLane) — flying to a target that is
 *     re-read every frame, so it settles onto a plate that never stopped moving.
 *  4. An eaten dish leaves its plate EMPTY on the belt; the plate refills only
 *     when it next wraps round through the off-screen lane past the entry edge
 *     (belt.ts calls that lane the hatch). Gaps riding past are the intended
 *     look — they are what tells the child the next one is coming.
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
  pitchMs,
  rescueLane,
  returnLane,
  slotAtPitchX,
  slotPitchX,
  traverseMs,
} from './belt'
import type { BeltDials, BeltLaneSnapshot } from './belt'
import { artKey } from './art'
import * as layout from './layout'
import type { ConveyorLaneState, ConveyorState } from './testHook'
import type FeedTheMonsterScene from './FeedTheMonsterScene'

/** Plate under a dish, as a fraction of the pitch. */
const PLATE_W_MUL = 0.78
/** Tread scroll per pitch travelled, in texture px — pure decoration. */
const TREAD_SCROLL = 48

/**
 * A dish that is off its plate but still owns it: in the child's hand, or flying
 * back. Nothing else may be put on a claimed plate, which is what makes "the dish
 * you picked up always has somewhere to go back to" structural rather than a
 * fallback chain that can run out.
 */
interface LaneClaim {
  dish: Phaser.GameObjects.Image
  /**
   * Has the child let go, and is this plate the one it was COMMITTED to? The
   * landing plate is chosen once, at release, and then followed: re-deciding
   * every frame would jerk the dish sideways the moment a plate wrapped past
   * the entry edge mid-flight.
   */
  landing: boolean
}

interface Lane {
  /** What rides this plate; null is an EMPTY PLATE, still riding. */
  foodId: string | null
  food: Phaser.GameObjects.Image | null
  plate: Phaser.GameObjects.Image
  claim: LaneClaim | null
  /** Slot the lane held on the previous frame, to detect the entry-edge wrap. */
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
  private dials: BeltDials = { dishSpeedCss: 48, maxWaitMs: 4_000, wantedEvery: 3 }
  private belt?: Phaser.GameObjects.TileSprite
  private rollers: Phaser.GameObjects.Image[] = []
  /** The dish in the child's hand right now (lifted off its plate). */
  private held: Phaser.GameObjects.Image | null = null
  /**
   * Has the held dish crossed the drag threshold? A dragged dish is routed by the
   * tray's `dragend` (into a mouth, or arced home); a dish merely TAPPED fires no
   * dragend at all, so the belt has to put that one back itself.
   */
  private heldDragged = false
  /** Wanted dishes that rode past un-taken — the belt meter's signal. */
  private missedPasses = 0

  constructor(scene: FeedTheMonsterScene) {
    this.scene = scene
  }

  private px(css: number): number {
    return css * this.scene.dpr
  }

  /** One dish's slot width, in CSS px — the unit the belt's speed is set in. */
  private pitchCss(): number {
    return layout.dishPitch(this.scene.metrics()) / this.scene.dpr
  }

  /** ms for a dish to advance one pitch at the current speed. */
  private step(): number {
    return pitchMs(this.dials.dishSpeedCss, this.pitchCss())
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
    this.heldDragged = false

    const m = this.scene.metrics()
    const visible = layout.visibleDishCount(m)
    const total = laneCount(visible)

    this.buildBelt()
    // The still plate row stands down; the belt carries its own plates.
    for (const plate of this.scene.tray.plates) plate.setVisible(false)
    this.scene.tray.clearFoods()
    // A belt dish's home is wherever its plate has ridden to — that is what makes
    // "arc back home" put it back ON the belt instead of onto a hidden plate.
    this.scene.tray.homeProvider = (img) => this.laneHome(img)

    // Seed the visible lanes straight from the round's tray composition, so the
    // very first thing the child sees already contains something they can feed;
    // the hidden lanes are scheduled, which starts the anti-drought machinery.
    this.lanes = []
    for (let i = 0; i < total; i++) {
      const plate = this.scene.add.image(0, 0, 'ftm-plate').setDepth(4)
      const lane: Lane = {
        foodId: null,
        food: null,
        plate,
        claim: null,
        lastSlot: 0,
        passedWanted: false,
      }
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
    // dragged to the mouth comes up nowhere near its own sprite, so a GameObject
    // `pointerup` would never fire and a tapped dish would be left hanging in
    // mid-air while its plate rode away underneath it.
    this.scene.input.on('pointerup', this.release)
    this.scene.input.on('pointerupoutside', this.release)
    this.scene.input.on('dragstart', this.noteDragStart)
    playTone(392, 90, 'triangle', 0.07)
    this.scene.time.delayedCall(120, () => playTone(523, 120, 'triangle', 0.07))
  }

  /** Tear the belt down and hand the still plate row back. */
  stop(): void {
    if (!this.active) return
    this.active = false
    this.scene.input.off('pointerup', this.release)
    this.scene.input.off('pointerupoutside', this.release)
    this.scene.input.off('dragstart', this.noteDragStart)
    this.held = null
    this.heldDragged = false
    for (const lane of this.lanes) {
      this.scene.tweens.killTweensOf(lane.plate)
      lane.plate.destroy()
    }
    this.lanes = []
    this.belt?.destroy()
    this.belt = undefined
    for (const roller of this.rollers) roller.destroy()
    this.rollers = []
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

    // Nothing is drawn at the entry edge: the belt runs left → right and a dish
    // simply rides in from off screen past the left edge. A doorway image used to
    // stand here to explain where the food came from, but at this size it read as
    // a brown rectangle sitting on the first plate, so it was cut — the belt is
    // the strip plus its two rollers, and nothing else.
    // Depth stack left behind: belt strip and rollers 3, plates 4, dishes 5
    // (tray.makeFood), a dragged dish 20 — so a dish is always above the plate it
    // rides on, and nothing occludes it.
  }

  // ─── Lanes ─────────────────────────────────────────────────────────────────

  /** Everything the pure scheduler and the return rule need about every lane. */
  private snapshot(): BeltLaneSnapshot[] {
    const total = this.lanes.length
    return this.lanes.map((lane, i) => ({
      slot: laneSlot(i, this.offset, total),
      foodId: lane.foodId,
      reserved: lane.claim !== null,
    }))
  }

  private wanted = (foodId: string): boolean => {
    const round = this.scene.round
    return round ? wantsFood(round.request, this.scene.eaten, foodId) : false
  }

  /** Ask belt.ts what the next dish riding in from off screen carries. */
  private scheduleFood(laneIndex: number): string {
    const round = this.scene.round
    const pool = round ? [...new Set(round.tray)] : []
    if (pool.length === 0) return ''
    return nextDishFood(
      {
        others: this.snapshot().filter((_, i) => i !== laneIndex),
        lanes: this.lanes.length || laneCount(layout.visibleDishCount(this.scene.metrics())),
        step: this.step(),
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
    if (!lane || foodId === '' || lane.claim !== null) return
    lane.foodId = foodId
    lane.passedWanted = false
    const at = this.dishPos(laneSlot(index, this.offset, this.lanes.length))
    lane.food = this.scene.tray.makeFood(foodId, at.x, at.y, index)
    lane.food.setData('lane', index)
    // Lift rule 1: from pointerDOWN (not from the drag threshold) the dish is off
    // its plate and in the child's hand. Waiting for `dragstart` would let the
    // stream slide on under a finger that has already committed.
    lane.food.on('pointerdown', () => this.lift(lane.food!))
  }

  /** Empty a plate — the plate itself rides on, which is the whole point. */
  private emptyLane(lane: Lane): void {
    lane.foodId = null
    lane.food = null
    lane.passedWanted = false
  }

  /** A lane's current dish position (the plate and the food share it). */
  private dishPos(slot: number): layout.XY {
    return layout.beltDishPos(this.scene.metrics(), slotPitchX(slot))
  }

  /** The lane this dish rides on or has claimed, or null when it is loose. */
  private laneOf(img: Phaser.GameObjects.Image): number | null {
    const index = this.lanes.findIndex((l) => l.food === img || l.claim?.dish === img)
    return index < 0 ? null : index
  }

  // ─── Lift and land ─────────────────────────────────────────────────────────

  /**
   * The child put a finger on a dish: take it off its plate. The plate stays on
   * the belt, empty and claimed, and keeps riding — the belt itself does not so
   * much as slow down.
   */
  private lift(img: Phaser.GameObjects.Image): void {
    if (!this.active || this.held) return
    const index = this.laneOf(img)
    if (index === null) return
    const lane = this.lanes[index]
    if (lane.food !== img) return
    this.held = img
    this.heldDragged = false
    this.emptyLane(lane)
    lane.claim = { dish: img, landing: false }
    img.setData('lane', index)
  }

  /** Did the held dish become a real drag? Then the tray's dragend routes it. */
  private noteDragStart = (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject): void => {
    if (obj === this.held) this.heldDragged = true
  }

  /**
   * The finger came up. A dish that was DRAGGED has already been routed by the
   * tray (into a mouth, or arced home through `homePos` → `laneHome`); a dish that
   * was merely tapped fires no dragend at all, so it is sent home from here.
   * Either way nothing is left loose past this frame.
   */
  private release = (): void => {
    const img = this.held
    if (!img) return
    this.held = null
    const dragged = this.heldDragged
    this.heldDragged = false
    if (dragged || !img.active) return
    this.scene.tray.returnHome(img)
  }

  /**
   * Where a lifted dish belongs — a plate, chosen once (belt.returnLane) at the
   * moment it is let go and then followed wherever the belt rides it. Called every
   * frame of the flight home, so answering with the SAME lane each time is a
   * correctness requirement, not an optimisation.
   */
  private laneHome(img: Phaser.GameObjects.Image): layout.XY {
    const total = this.lanes.length
    const fallback = (): layout.XY =>
      layout.beltDishPos(this.scene.metrics(), slotPitchX(FIRST_VISIBLE_SLOT))
    if (total === 0) return fallback()

    const current = this.laneOf(img)
    if (current !== null) {
      const lane = this.lanes[current]
      // Never lifted (a second finger dragged it straight off a moving plate), or
      // already committed to this plate: follow it, do not re-decide.
      if (lane.food === img || lane.claim?.landing) {
        return this.dishPos(laneSlot(current, this.offset, total))
      }
    }

    const dropSlot = slotAtPitchX(img.x / layout.dishPitch(this.scene.metrics()))
    const index = returnLane(this.snapshot(), current, dropSlot, total) ?? current
    if (index === null) return fallback()
    // Move the claim to whichever plate won, so the plate it came off can be
    // re-dressed and the new one cannot be taken while the dish is in the air.
    for (const lane of this.lanes) if (lane.claim?.dish === img) lane.claim = null
    this.lanes[index].claim = { dish: img, landing: true }
    img.setData('lane', index)
    return this.dishPos(laneSlot(index, this.offset, total))
  }

  /**
   * A dish that has finished flying home settles back ONTO its plate, and the belt
   * carries it again. Polled rather than driven by a landing callback so that every
   * way a flight can end — landed, eaten in mid-air, faded out by a celebration —
   * leaves the plate in a consistent state.
   */
  private settleClaims(): void {
    this.lanes.forEach((lane, index) => {
      const claim = lane.claim
      if (!claim) return
      const dish = claim.dish
      if (!dish.active) {
        lane.claim = null
        return
      }
      // Still in a hand, or let go but not yet routed home (it may be on its way
      // into a mouth): the plate stays claimed and stays empty.
      if (!claim.landing || dish === this.held || dish === this.scene.tray.dragged) return
      if (this.scene.tray.isAnimating(dish)) return
      lane.claim = null
      lane.food = dish
      lane.foodId = dish.getData('foodId') as string
      lane.passedWanted = false
      dish.setData('lane', index)
    })
  }

  /** A dish left the belt for good (eaten): its plate rides on, empty. */
  noteEaten(img: Phaser.GameObjects.Image): void {
    if (!this.active) return
    for (const lane of this.lanes) {
      if (lane.claim?.dish === img) lane.claim = null
      if (lane.food === img) this.emptyLane(lane)
    }
    if (this.held === img) {
      this.held = null
      this.heldDragged = false
    }
  }

  // ─── Per-frame ─────────────────────────────────────────────────────────────

  /**
   * Advance the loop and reposition everything. Nothing here is conditional on the
   * child, the friend or a celebration: the belt runs from `serve` to `stop`.
   */
  update(deltaMs: number): void {
    if (!this.active || this.lanes.length === 0) return
    const m = this.scene.metrics()
    const total = this.lanes.length
    const step = this.step()
    this.offset += deltaMs / step
    if (this.belt) this.belt.tilePositionX += (deltaMs / step) * TREAD_SCROLL

    this.settleClaims()

    for (let i = 0; i < total; i++) {
      const lane = this.lanes[i]
      const slot = laneSlot(i, this.offset, total)
      // The wrap past the entry edge is the spawn decision: a lane that has come all
      // the way round gets a fresh dish (or fills the gap an eaten one left) —
      // unless a dish in the child's hand has claimed that plate, in which case it
      // rides through empty and stays theirs.
      if (slot < lane.lastSlot) {
        if (lane.passedWanted) this.missedPasses++
        if (lane.food) this.scene.tray.removeFood(lane.food)
        this.emptyLane(lane)
        this.fillLane(i, this.scheduleFood(i))
      }
      lane.lastSlot = slot
      // A MISS is a wanted dish that rode the WHOLE visible span un-taken, so it
      // only becomes one after being seen near the entry end. Marking it anywhere
      // on the belt counted the initial seeding — dishes dealt mid-span, some
      // already at the far edge — as misses the child never had a chance at, and
      // three of them landed before the first feed.
      if (lane.foodId !== null && slot <= FIRST_VISIBLE_SLOT + 1 && this.wanted(lane.foodId)) {
        lane.passedWanted = true
      }

      this.placeLane(lane, slot, layout.dishPitch(m))
    }

    this.rescueIfDry(total, step)
  }

  /**
   * The anti-drought guarantee, checked every frame: if the wait for a wanted dish
   * has grown past the budget, re-dress the lane currently OFF SCREEN past the entry
   * edge (belt.ts calls that lane the hatch), which is invisible by definition and
   * always exists — so the rescue costs the child nothing and shows them nothing.
   *
   * Doing this per frame rather than only when a lane wraps is what removes a
   * whole pitch of latency from the promise (see belt.needsRescue). Running OUT of
   * wanted dishes for a while is not a defect — waiting for the right dish to come
   * round is the mechanic — so this is a ceiling on the wait, not a floor on supply.
   */
  private rescueIfDry(total: number, step: number): void {
    const round = this.scene.round
    if (!round || this.scene.transitioning) return
    const pool = [...new Set(round.tray)]
    if (pool.length === 0) return
    const snapshot = this.snapshot()
    const dry = needsRescue({
      others: snapshot,
      lanes: total,
      step,
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
    if (lane.food) this.scene.tray.removeFood(lane.food)
    this.emptyLane(lane)
    this.fillLane(index, foodId)
  }

  /** Put one lane's plate and dish where its slot says they belong. */
  private placeLane(lane: Lane, slot: number, pitch: number): void {
    const at = this.dishPos(slot)
    // The plate ALWAYS rides, dish or no dish. An emptied plate that vanished made
    // the belt look like it was losing pieces of itself; an emptied plate going
    // round is both better UI and the promise that it will be refilled.
    lane.plate.setPosition(at.x, at.y + this.px(12))
    this.dressPlate(lane.plate, pitch)

    const food = lane.food
    if (!food) return
    if (!food.active) {
      // The tray disposed of it (eaten, or a leftover tumbling away at the end of
      // the round); the plate rides on empty until the scheduler refills it.
      this.emptyLane(lane)
      return
    }
    // A dish mid-drag or mid-animation (flying home, flying to a mouth, fading
    // out) is owned by the tray — the belt must not fight it.
    if (food === this.scene.tray.dragged || this.scene.tray.isAnimating(food)) return
    food.setPosition(at.x, at.y)
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
    this.buildBelt()
    this.update(0)
  }

  /** Live belt state for the dev/e2e hook. */
  snapshotState(): ConveyorState {
    const m = this.scene.metrics()
    const total = this.lanes.length
    const step = this.step()
    const lanes: ConveyorLaneState[] = this.lanes.map((lane, i) => {
      const slot = laneSlot(i, this.offset, total)
      const at = this.dishPos(slot)
      return {
        foodId: lane.foodId,
        wanted: lane.foodId !== null && this.wanted(lane.foodId),
        visible: isSlotVisible(slot, total),
        msUntilReachable: msUntilReachable(slot, total, step),
        xCss: at.x / this.scene.dpr,
        yCss: at.y / this.scene.dpr,
      }
    })
    return {
      dishSpeedCss: this.dials.dishSpeedCss,
      traverseMs: traverseMs(step, layout.visibleDishCount(m)),
      maxWaitMs: this.dials.maxWaitMs,
      moving: this.active,
      offset: this.offset,
      lifted: (this.held?.getData('foodId') as string | undefined) ?? null,
      misses: this.missedPasses,
      lanes,
    }
  }
}
