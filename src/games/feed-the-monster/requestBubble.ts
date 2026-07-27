/**
 * The task-request bubble — the top panel that shows WHAT the monster wants.
 *
 * Owns the detached panel bar at the top of the screen and everything drawn
 * inside it: the picture tiles, the subitizing dot pips, the "?" you-pick
 * sockets, the ban (✗) overlay for "not" rounds, the pattern answer ring, and
 * the collected ✓ stamps — plus the audio cue that renders each request.
 *
 * Factored out of the scene so the bubble's build/draw/animate logic lives in
 * one widget. The scene constructs one (`new RequestBubble(this)`) and
 * delegates; the bubble holds its own display objects and reads live scene
 * state (round / episode / eaten / transitioning / dpr) plus `tray.foodTexture`
 * back through the passed scene reference.
 */
import Phaser from 'phaser'
import { playTone } from '../../shared/audio'
import { COLOR_HEX, bubbleItems, grayedBubbleItems, requestTotal } from './logic'
import type { FoodColor, FoodRequest } from './logic'
import * as layout from './layout'
import * as textures from './textures'
import type FeedTheMonsterScene from './FeedTheMonsterScene'

// A "want" tile sits ghosted until it is fed, then solidifies + gets a ✓.
const GHOST_ALPHA = 0.5
// Neutral tints for the tiles that are NOT asking for a colour — kept warm-grey
// (never a food colour) so a 3-4yo never reads them as "feed something purple".
const SLOT_GREY = 0xd6d3ce // pattern answer socket — a "?" hole
const DOTS_BACKING = 0xebe7e0 // subitizing frame behind the ink pips
const BUBBLE_ITEM_CSS = 44
// Mirrors the scene's ART SPEC ink + pentatonic-happy tones (the pips + the
// request-cue melody share these exact values with the scene).
const INK = 0x3d3a4b
const PENTA = [523, 587, 659, 784, 880]

export class RequestBubble {
  private bubble!: Phaser.GameObjects.Container
  private panelGfx!: Phaser.GameObjects.Graphics
  private panelHit: Phaser.GameObjects.Rectangle | null = null
  private bubblePics: Phaser.GameObjects.Image[] = []
  /** Extra bubble decorations (dot pips, ban overlay) cleared per request. */
  private bubbleExtras: Phaser.GameObjects.GameObject[] = []
  /** Dot pips of a dots round, lit one-by-one as the child feeds. */
  private pips: Phaser.GameObjects.Arc[] = []
  /** Accent ring around the pattern's answer socket (cleared per request). */
  private patternRing: Phaser.GameObjects.Arc | null = null
  /** Panel bar as currently drawn, backing px — the e2e hook reads its box. */
  private panelW = 0

  private readonly scene: FeedTheMonsterScene

  constructor(scene: FeedTheMonsterScene) {
    this.scene = scene
  }

  private px(css: number): number {
    return css * this.scene.dpr
  }

  /** Tile count, for the e2e state hook (was `this.bubblePics.length`). */
  get tileCount(): number {
    return this.bubblePics.length
  }

  /**
   * The food each tile shows, in panel order (null for a colour blot, a dots pip
   * frame or an unfilled slot). Exposed so a spec can assert WHAT the friend is
   * asking for — a kitchen round's bubble must hold exactly the finished dish.
   */
  get tileFoodIds(): Array<string | null> {
    return this.bubblePics.map((pic) => (pic.getData('foodId') as string | undefined) ?? null)
  }

  /** The panel bar's box in CSS px, for the e2e hook (two panels must not overlap). */
  boxCss(): { xCss: number; yCss: number; wCss: number; hCss: number } {
    return {
      xCss: this.bubble.x / this.scene.dpr,
      yCss: this.bubble.y / this.scene.dpr,
      wCss: this.panelW / this.scene.dpr,
      hCss: layout.PANEL_H_CSS,
    }
  }

  build(): void {
    this.bubble = this.scene.add.container(0, 0).setDepth(6)
    this.panelGfx = this.scene.add.graphics()
    this.bubble.add(this.panelGfx)
    this.drawPanel(this.px(220))
    this.bubble.setScale(0)
  }

  /**
   * (Re)draw the task panel plate at the given width and rebuild its tap
   * target (tapping the panel repeats the request cue). Drawing per request
   * keeps rounded corners crisp at any width; the border is tinted by the
   * episode palette so the panel changes with the world.
   */
  drawPanel(width: number): void {
    this.panelW = width
    const bh = this.px(layout.PANEL_H_CSS)
    const radius = this.px(26)
    this.panelGfx.clear()
    this.panelGfx.fillStyle(0xffffff, 0.96)
    this.panelGfx.fillRoundedRect(-width / 2, -bh / 2, width, bh, radius)
    this.panelGfx.lineStyle(this.px(5), this.scene.episode.palette.table, 1)
    this.panelGfx.strokeRoundedRect(-width / 2, -bh / 2, width, bh, radius)

    this.panelHit?.destroy()
    this.panelHit = this.scene.add.rectangle(0, 0, width, bh, 0xffffff, 0)
    this.bubble.addAt(this.panelHit, 1) // above the plate, below the tiles
    this.panelHit.setInteractive()
    this.panelHit.on('pointerdown', () => {
      // Not during transitions: a mid-celebration replay would hop tiles
      // that the completion bow is already animating.
      if (this.scene.round && !this.scene.transitioning)
        this.playRequestCue(this.scene.round.request)
      this.scene.tweens.killTweensOf(this.bubble)
      this.scene.tweens.add({
        targets: this.bubble,
        scaleX: { from: 0.94, to: 1 },
        scaleY: { from: 0.94, to: 1 },
        duration: 240,
        ease: 'Back.easeOut',
      })
    })
  }

  /**
   * The task panel owns the top of the screen, detached from the friend. One fixed
   * height for every task kind (a kitchen round used to grow it to carry the recipe;
   * the recipe now hangs over the POT instead — see ./recipePanel), so the whole
   * layout can count on the band this bar occupies.
   */
  reposition(): void {
    this.bubble.setPosition(this.scene.scale.width / 2, layout.panelCenterY(this.scene.metrics()))
  }

  /** Hide/show the whole top task panel — a duo round shows its own per-friend
   * bubbles instead, so the solo panel stands down while a duo is on stage. */
  setHidden(hidden: boolean): void {
    this.bubble.setVisible(!hidden)
  }

  /**
   * The COMMISSION ask: a pencil and, once colour rounds are in rotation, a blot
   * of the colour being asked for. No food tiles, nothing to feed — the panel is
   * saying "make something" instead of "bring me something", and the colour is
   * held on screen so it registers before the pad slides up.
   *
   * `color` is null below the colour-round unlock, where the ask is simply
   * "draw anything".
   */
  showCommission(color: FoodColor | null): void {
    this.clearTiles()
    this.bubble.setVisible(true)

    const tile = this.px(BUBBLE_ITEM_CSS + 22)
    const itemW = this.px(BUBBLE_ITEM_CSS + 14)
    const count = color === null ? 1 : 2
    this.drawPanel(count * itemW + this.px(52))
    this.reposition()

    const pencil = this.scene.add.image(-((count - 1) / 2) * itemW, 0, 'ftm-pencil')
    pencil.setDisplaySize(tile * 0.9, tile * 0.9)
    this.bubble.add(pencil)
    this.bubblePics.push(pencil)
    this.pulse(pencil)

    if (color !== null) {
      const blot = this.scene.add.image(itemW / 2, 0, 'ftm-splash').setTint(COLOR_HEX[color])
      blot.setDisplaySize(tile, tile)
      this.bubble.add(blot)
      this.bubblePics.push(blot)
      this.pulse(blot)
    }

    this.popBubble()
    // Two rising notes — "make me one", distinct from every count cue.
    playTone(587, 150, 'triangle', 0.1)
    this.scene.time.delayedCall(180, () => playTone(880, 200, 'triangle', 0.1))
  }

  /** Tear down the current tiles + decorations (shared by every show*). */
  private clearTiles(): void {
    for (const pic of this.bubblePics) {
      this.scene.tweens.killTweensOf(pic)
      pic.destroy()
    }
    this.bubblePics = []
    for (const extra of this.bubbleExtras) extra.destroy()
    this.bubbleExtras = []
    this.pips = []
    this.patternRing = null
  }

  /** The panel's arrival pop (shared by every show*). */
  private popBubble(): void {
    this.scene.tweens.killTweensOf(this.bubble)
    this.bubble.setScale(0)
    this.scene.tweens.add({
      targets: this.bubble,
      scaleX: 1,
      scaleY: 1,
      duration: 320,
      ease: 'Back.easeOut',
    })
  }

  showRequest(request: FoodRequest): void {
    // A duo round stood this panel down (setHidden); showing a solo request
    // brings it back — content-first, so it never flashes a stale ask.
    this.bubble.setVisible(true)
    this.clearTiles()

    // Pattern rounds ask for exactly ONE food (the sequence's continuation),
    // yet their tiles used to look identical to a "feed all of these" combo —
    // the reported early-win confusion. The sequence is drawn as smaller
    // context tiles; the ringed pulsing socket is the only "want". Pattern
    // spacing is wider so the ring never overlaps the last context tile.
    const isPattern = request.kind === 'pattern'
    // Only these kinds run the ghost→solid+✓ "want" flow (updateBubbleGray).
    // dots progress is carried by lit pips, not/pattern by socket fills — their
    // tiles must NOT ghost (e.g. the dots round's food label stays solid). A
    // kitchen round is in here too: its bubble is now an ordinary ONE-item ask
    // ("bring me this dish"), the recipe having moved onto the pot's own panel.
    const ghostKind =
      request.kind === 'count' ||
      request.kind === 'color' ||
      request.kind === 'mix' ||
      request.kind === 'dish'
    const items = bubbleItems(request)
    const itemW = this.px(BUBBLE_ITEM_CSS + (isPattern ? 18 : 10))
    const bw = items.length * itemW + this.px(52)
    this.drawPanel(bw)
    this.reposition()

    const tile = this.px(BUBBLE_ITEM_CSS + 22)
    items.forEach((item, i) => {
      const x = (i - (items.length - 1) / 2) * itemW
      let pic: Phaser.GameObjects.Image
      // A "want" tile ghosts until it is fed; a "?" marks a you-pick slot; a
      // pattern context tile is drawn already-done (✓ stamped below).
      let ghost = false
      let qSize = 0
      let context = false
      if (item.foodId !== undefined) {
        const fid = item.foodId
        pic = this.scene.add.image(x, 0, this.scene.tray.foodTexture(fid))
        const size = (isPattern ? tile * 0.78 : tile) * textures.foodScale(fid)
        pic.setDisplaySize(size, size)
        pic.setData('foodId', fid)
        // Pattern's shown sequence = given context (reads as done, not a want).
        // A banned food (not-round) stays solid under its ✗. Everything else is
        // a want that ghosts until fed.
        if (isPattern) context = true
        else if (ghostKind && !item.banned) ghost = true
      } else if (item.color !== undefined) {
        pic = this.scene.add.image(x, 0, 'ftm-splash').setTint(COLOR_HEX[item.color])
        pic.setDisplaySize(tile, tile)
        // A banned colour stays solid under its ✗. A colour request is a
        // you-pick slot: keep the hue readable (full tint, semi-transparent)
        // and mark it "any food of this colour" with a ?.
        if (ghostKind && !item.banned) {
          ghost = true
          qSize = tile * 0.5
        }
      } else if (item.dots !== undefined) {
        // Subitizing tile: NEUTRAL backing (never a food colour) + ink pips.
        // Progress is the pips lighting up — no ghost, no ✓.
        pic = this.scene.add.image(x, 0, 'ftm-splash').setTint(DOTS_BACKING)
        pic.setDisplaySize(tile * 1.1, tile * 1.1)
        this.addPips(x, item.dots)
      } else if (isPattern) {
        // The pattern's answer socket — THE ask of the round: a neutral grey
        // "?" hole (never a food colour) with a pulsing ring.
        pic = this.scene.add.image(x, 0, 'ftm-splash').setTint(SLOT_GREY)
        pic.setDisplaySize(tile * 0.9, tile * 0.9)
        const ring = this.scene.add.circle(x, 0, tile * 0.5, 0x000000, 0)
        ring.setStrokeStyle(this.px(4), this.scene.episode.palette.table, 1)
        this.bubble.add(ring)
        this.bubbleExtras.push(ring)
        this.patternRing = ring
        qSize = tile * 0.5
        this.pulse(pic)
      } else {
        // Not-round progress socket — "a food goes here, you pick": the same
        // neutral grey "?" hole as the pattern answer, pulsing until filled.
        // Deliberately makes NO colour claim — the crossed-out tile is the only
        // constraint, so there's no misleading "any colour" wheel (which also
        // showed the banned colour inside a "not that colour" task).
        pic = this.scene.add.image(x, 0, 'ftm-splash').setTint(SLOT_GREY).setAlpha(0.9)
        pic.setDisplaySize(tile * 0.82, tile * 0.82)
        qSize = tile * 0.45
        this.pulse(pic)
      }
      if (ghost) pic.setAlpha(GHOST_ALPHA)
      if (item.banned) {
        const ban = this.scene.add.image(x, 0, 'ftm-ban')
        ban.setDisplaySize(tile * 1.15, tile * 1.15)
        this.bubble.add(ban)
        this.bubbleExtras.push(ban)
      }
      this.bubble.add(pic)
      this.bubblePics.push(pic)
      if (qSize > 0) this.addQ(pic, qSize)
      if (context) this.stampCheck(pic)
    })
    // Overlays (bans, ?, ✓, pips, rings) must render above their tile.
    for (const extra of this.bubbleExtras) this.bubble.bringToTop(extra)
    this.popBubble()
  }

  /** Domino-style pip offsets (in pip-spacing units) for 1..6. */
  private static readonly PIP_LAYOUTS: ReadonlyArray<ReadonlyArray<[number, number]>> = [
    [[0, 0]],
    [
      [-1, -1],
      [1, 1],
    ],
    [
      [-1, -1],
      [0, 0],
      [1, 1],
    ],
    [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ],
    [
      [-1, -1],
      [1, -1],
      [0, 0],
      [-1, 1],
      [1, 1],
    ],
    [
      [-1, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [1, 1],
    ],
  ]

  private addPips(tileX: number, count: number): void {
    const layout = RequestBubble.PIP_LAYOUTS[Math.min(count, RequestBubble.PIP_LAYOUTS.length) - 1]
    // Offsets stay well inside the irregular splash blob (radius ~tile/2).
    const unit = this.px(11)
    for (const [ox, oy] of layout) {
      const pip = this.scene.add.circle(tileX + ox * unit, oy * unit, this.px(8), INK)
      this.bubble.add(pip)
      this.bubbleExtras.push(pip)
      this.pips.push(pip)
    }
  }

  /** Light one pip per eaten food — the count lesson replays as feedback. */
  lightPips(): void {
    this.scene.eaten.forEach((_, i) => {
      const pip = this.pips[i]
      if (!pip || pip.getData('lit')) return
      pip.setData('lit', true)
      pip.setFillStyle(0xffb703)
      this.scene.tweens.add({
        targets: pip,
        scaleX: { from: 1.8, to: 1.2 },
        scaleY: { from: 1.8, to: 1.2 },
        duration: 260,
        ease: 'Back.easeOut',
      })
    })
  }

  /** Steady breathing pulse — the "act here" cue on you-pick sockets. */
  private pulse(pic: Phaser.GameObjects.Image): void {
    this.scene.tweens.add({
      targets: pic,
      scaleX: pic.scaleX * 1.12,
      scaleY: pic.scaleY * 1.12,
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
  }

  /** Overlay a "?" on a you-pick slot ("a food goes here — you choose"). */
  private addQ(pic: Phaser.GameObjects.Image, size: number): void {
    const q = this.scene.add.image(pic.x, pic.y, 'ftm-q')
    q.setDisplaySize(size, size)
    this.bubble.add(q)
    this.bubbleExtras.push(q)
    pic.setData('q', q)
  }

  /** Retire a slot's "?" once the child has supplied the food. */
  private removeQ(pic: Phaser.GameObjects.Image): void {
    const q = pic.getData('q') as Phaser.GameObjects.Image | undefined
    if (!q) return
    pic.setData('q', undefined)
    this.scene.tweens.add({
      targets: q,
      alpha: 0,
      scaleX: q.scaleX * 0.2,
      scaleY: q.scaleY * 0.2,
      duration: 160,
      ease: 'Quad.easeIn',
      onComplete: () => q.destroy(),
    })
  }

  /** Stamp the green "✓ got it" badge on a collected (or given) tile. */
  private stampCheck(pic: Phaser.GameObjects.Image): void {
    if (pic.getData('checked')) return
    pic.setData('checked', true)
    // A soft ✓ disc stamped over the centre of the tile — anchored to the food
    // whatever its shape, translucent so the picture still reads underneath.
    const badge = this.scene.add.image(pic.x, pic.y, 'ftm-check')
    const s = pic.displayWidth * 0.46
    badge.setDisplaySize(s, s).setAlpha(0.85)
    this.bubble.add(badge)
    this.bubbleExtras.push(badge)
    pic.setData('check', badge)
    this.scene.tweens.add({
      targets: badge,
      scaleX: { from: 0, to: badge.scaleX },
      scaleY: { from: 0, to: badge.scaleY },
      duration: 220,
      ease: 'Back.easeOut',
    })
  }

  /** A correct "not" feed stamps the fed food into the next empty slot. */
  fillNotSlot(foodId: string): void {
    const pic = this.bubblePics[this.scene.eaten.length]
    if (!pic) return
    this.scene.tweens.killTweensOf(pic)
    const tile = this.px(BUBBLE_ITEM_CSS + 22)
    this.removeQ(pic)
    pic.setTexture(this.scene.tray.foodTexture(foodId))
    pic.clearTint()
    pic.setAlpha(1)
    const size = tile * textures.foodScale(foodId)
    pic.setDisplaySize(size, size)
    this.scene.tweens.add({
      targets: pic,
      scaleX: { from: pic.scaleX * 1.4, to: pic.scaleX },
      scaleY: { from: pic.scaleY * 1.4, to: pic.scaleY },
      duration: 240,
      ease: 'Back.easeOut',
    })
    this.stampCheck(pic)
  }

  /** The pattern answer lands in the slot and the whole row takes a bow. */
  fillPatternSlot(): void {
    if (!this.scene.round || this.scene.round.request.kind !== 'pattern') return
    const slot = this.bubblePics[this.bubblePics.length - 1]
    if (!slot) return
    this.scene.tweens.killTweensOf(slot)
    const tile = this.px(BUBBLE_ITEM_CSS + 22)
    this.removeQ(slot)
    slot.setTexture(this.scene.tray.foodTexture(this.scene.round.request.answerId))
    slot.clearTint()
    slot.setAlpha(1)
    const size = tile * textures.foodScale(this.scene.round.request.answerId)
    slot.setDisplaySize(size, size)
    this.stampCheck(slot)
    // The socket is answered — its ring bows out.
    if (this.patternRing) {
      this.scene.tweens.killTweensOf(this.patternRing)
      this.scene.tweens.add({
        targets: this.patternRing,
        alpha: 0,
        duration: 300,
        ease: 'Quad.easeOut',
      })
    }
    // Re-read the completed sequence left-to-right — celebration doubles as
    // the lesson (the pattern is shown whole one more time). The ✓ badges ride
    // along with their tiles.
    this.bubblePics.forEach((pic, i) => {
      const targets: Phaser.GameObjects.GameObject[] = [pic]
      const check = pic.getData('check') as Phaser.GameObjects.Image | undefined
      if (check) targets.push(check)
      this.scene.tweens.add({
        targets,
        y: `-=${this.px(12)}`,
        delay: i * 90,
        duration: 150,
        yoyo: true,
        ease: 'Quad.easeOut',
      })
      this.scene.time.delayedCall(i * 90, () =>
        playTone(PENTA[i % PENTA.length], 120, 'sine', 0.08),
      )
    })
  }

  /**
   * Mark the just-satisfied want tiles as collected: solidify the ghosted tile
   * with a pop, retire its "?", and stamp the ✓. not/pattern carry progress via
   * slot fills; dots via lit pips — those never run through here.
   */
  updateBubbleGray(): void {
    if (!this.scene.round) return
    const kind = this.scene.round.request.kind
    if (kind === 'not' || kind === 'pattern' || kind === 'dots') return
    const done = grayedBubbleItems(this.scene.round.request, this.scene.eaten)
    done.forEach((isDone, i) => {
      const pic = this.bubblePics[i]
      if (!pic || !isDone || pic.getData('done')) return
      pic.setData('done', true)
      this.removeQ(pic)
      this.scene.tweens.killTweensOf(pic)
      this.scene.tweens.add({
        targets: pic,
        alpha: 1,
        scaleX: { from: pic.scaleX * 1.18, to: pic.scaleX },
        scaleY: { from: pic.scaleY * 1.18, to: pic.scaleY },
        duration: 240,
        ease: 'Back.easeOut',
      })
      this.stampCheck(pic)
    })
  }

  /** Hop one panel tile (pattern cue re-reads the row tile by tile). */
  private hopBubblePic(index: number): void {
    const pic = this.bubblePics[index]
    if (!pic || !pic.active || this.scene.transitioning) return
    const targets: Phaser.GameObjects.GameObject[] = [pic]
    const check = pic.getData('check') as Phaser.GameObjects.Image | undefined
    if (check) targets.push(check)
    this.scene.tweens.add({
      targets,
      y: `-=${this.px(12)}`,
      duration: 140,
      yoyo: true,
      ease: 'Quad.easeOut',
    })
  }

  /** Flash the pattern answer ring — "this one is missing". */
  private punchPatternRing(): void {
    const ring = this.patternRing
    if (!ring || !ring.active || this.scene.transitioning) return
    this.scene.tweens.killTweensOf(ring)
    ring.setScale(1)
    this.scene.tweens.add({
      targets: ring,
      scaleX: { from: 1.25, to: 1 },
      scaleY: { from: 1.25, to: 1 },
      duration: 320,
      ease: 'Back.easeOut',
    })
  }

  private playRequestBeeps(count: number): void {
    for (let i = 0; i < Math.min(count, PENTA.length); i++) {
      this.scene.time.delayedCall(i * 170, () => playTone(PENTA[i], 150, 'sine', 0.1))
    }
  }

  /** Audio rendering of the request — each task kind gets its own cue. */
  playRequestCue(request: FoodRequest): void {
    switch (request.kind) {
      case 'pattern': {
        // The sequence as a melody, re-taught visually: each context tile
        // hops with its tone, then the answer socket flashes on the rising
        // "…?" — the row leads to the one missing food.
        const roles = [...new Set(request.sequence)]
        request.sequence.forEach((id, i) => {
          const tone = PENTA[(roles.indexOf(id) * 2) % PENTA.length]
          this.scene.time.delayedCall(i * 160, () => {
            playTone(tone, 130, 'sine', 0.09)
            this.hopBubblePic(i)
          })
        })
        this.scene.time.delayedCall(request.sequence.length * 160 + 140, () => {
          playTone(988, 170, 'sine', 0.08)
          this.punchPatternRing()
        })
        return
      }
      case 'not':
        // "Uh-uh" — two low warning taps, then one beep per wanted food.
        playTone(220, 120, 'sine', 0.08)
        this.scene.time.delayedCall(150, () => playTone(196, 140, 'sine', 0.08))
        for (let i = 0; i < Math.min(request.count, PENTA.length); i++) {
          this.scene.time.delayedCall(430 + i * 170, () => playTone(PENTA[i], 150, 'sine', 0.1))
        }
        return
      default:
        this.playRequestBeeps(requestTotal(request))
    }
  }
}
