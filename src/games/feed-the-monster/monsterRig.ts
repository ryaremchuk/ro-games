/**
 * The feedable MONSTER — the big animated friend on stage: body, growth-aura
 * halo, the engine-drawn face (close-set eyes with tracking pupils, blush,
 * mouth/tongue, nose) and every reaction (breathe, blink, chomp, giggle,
 * sneeze, squint, happy `^^` eyes + laugh, the mouth open/close, the growth
 * aura + its ambient sparkle tick, and the per-frame pupil tracking).
 *
 * Factored out of the scene so all of the friend's build/animate/react logic
 * lives in one widget. The scene constructs one (`new MonsterRig(this)`) and
 * delegates; the rig holds its own display objects and reads live scene state
 * (bodyR / growth / journey / dragged / funnyUntil / sneezing) plus the shared
 * particle emitters and layout/color helpers back through the passed scene
 * reference. The lineup minis are NOT the rig's — they live on the journey
 * stage (their pupils deliberately do not cursor-track); only the current
 * walker lives here.
 */
import Phaser from 'phaser'
import { playTone } from '../../shared/audio'
import { auraIntensity, darken } from './journey'
import { artKey, friendSpec } from './art'
import * as textures from './textures'
import type { XY } from './layout'
import type FeedTheMonsterScene from './FeedTheMonsterScene'

// ART SPEC palette. Mirrors the scene's ink; INK is shared by the walker's
// pupils/mouth here and the lineup minis on the journey stage, so both keep the
// exact same literal — see requestBubble.ts / journeyStage.ts for the same
// duplicate-to-avoid-a-value-import pattern. PINK is the blush/tongue hue.
const PINK = 0xff8fab
const INK = 0x3d3a4b

export class MonsterRig {
  private monster!: Phaser.GameObjects.Container
  /**
   * Breathing/idle-life layer INSIDE monster: body + face + accessories all
   * live here so they animate as one. monster carries growth + chomp/squash +
   * position (it must not also breathe); rig carries the ~3% idle breathe, so
   * the face and worn accessories never float while the body pulses (the old
   * bug: breathe ran on monsterBody alone, its siblings stayed rigid).
   */
  private rig!: Phaser.GameObjects.Container
  private monsterBody!: Phaser.GameObjects.Image
  /** monsterBody's resting scale (art sprites need ≠1; breathe is relative). */
  private bodyScale = 1
  /**
   * Growth aura: a soft glowing halo behind the body whose alpha + scale ramp
   * with the growth step (applyAura). This — plus the ambient sparkles — is how
   * a friend reads as "grown up" now, replacing the old worn accessories. A
   * plain sprite (not a renderer FX), so it behaves identically everywhere.
   * haloFull is its display scale at full size (set per friend in build).
   */
  private halo!: Phaser.GameObjects.Image
  private haloFull = 1
  private eyeL!: Phaser.GameObjects.Container
  private eyeR!: Phaser.GameObjects.Container
  /** Pupil is a node (dark disc + white catchlight glint) that tracks touch. */
  private pupilL!: Phaser.GameObjects.Container
  private pupilR!: Phaser.GameObjects.Container
  /** White backing + the happy `^` arc — swapped for happy/closed eyes. */
  private eyeWhiteL!: Phaser.GameObjects.Image | Phaser.GameObjects.Ellipse
  private eyeWhiteR!: Phaser.GameObjects.Image | Phaser.GameObjects.Ellipse
  private mouthGiggle: Phaser.GameObjects.Image | null = null
  private happyL: Phaser.GameObjects.Image | null = null
  private happyR: Phaser.GameObjects.Image | null = null
  private happyEyes = false
  private mouthLips!: Phaser.GameObjects.Ellipse | Phaser.GameObjects.Image
  private mouthTongue!: Phaser.GameObjects.Ellipse
  /** Resting closed-smile sprite; crossfades with the open mouth (or null). */
  private mouthSmile: Phaser.GameObjects.Image | null = null
  /** mouthLips' resting scale — applyMouth animates relative to it. */
  private mouthBase = { x: 1, y: 1 }
  private mouthBaseSmile = { x: 1, y: 1 }
  /** True when mouthLips is the face-mouth sprite (tongue is baked in). */
  private artMouth = false
  /** Current friend's horizontal face shift in px (spec.faceX × bodyR). */
  private faceOffX = 0
  /**
   * Current friend's mouth Y offset in px (spec.mouthY × bodyR) — where the
   * mouth is actually DRAWN. The feed/open snap zone (mouthWorld) centers here
   * so it lands on the visible mouth; friends' mouths sit at very different
   * heights (spec.mouthY ranges ≈ −0.5…+0.14), so a fixed offset would bias the
   * zone far below the mouth the child aims at.
   */
  private mouthOffY = 0
  private nose!: Phaser.GameObjects.Ellipse

  private mouthState = { open: 0 }
  private mouthTween: Phaser.Tweens.Tween | null = null

  private readonly scene: FeedTheMonsterScene

  constructor(scene: FeedTheMonsterScene) {
    this.scene = scene
  }

  private px(css: number): number {
    return css * this.scene.dpr
  }

  /** The friend's container (position/growth/squash), for the scene to tween. */
  get container(): Phaser.GameObjects.Container {
    return this.monster
  }

  /** Visible growth scale, for the e2e state hook (was `this.monster.scaleX`). */
  get growthScale(): number {
    return this.monster.scaleX
  }

  /** How open the mouth is right now (the drag handler's snap-assist reads it). */
  get mouthOpen(): number {
    return this.mouthState.open
  }

  // ─── Build ───────────────────────────────────────────────────────────────

  /** Build (or rebuild, for the next friend) the feedable monster. */
  build(): void {
    if (this.monster) {
      this.scene.tweens.killTweensOf(this.monster)
      this.scene.tweens.killTweensOf(this.rig)
      this.scene.tweens.killTweensOf(this.monsterBody)
      if (this.halo) this.scene.tweens.killTweensOf(this.halo)
      this.mouthTween?.stop()
      this.mouthState.open = 0
      this.happyEyes = false
      this.monster.destroy()
    }

    const color = this.scene.friendBodyColor()
    const spec = friendSpec(this.scene.journey.episode, this.scene.journey.friendsFed)
    const artBody = this.scene.hasArt(spec.art)
    const r = this.scene.bodyR
    this.monster = this.scene.add.container(0, 0).setDepth(2)
    this.monster.setScale(this.scene.growth)
    // rig holds everything that breathes together (halo + body + face); the
    // shadow stays on monster so ground contact never pulses.
    this.rig = this.scene.add.container(0, 0)

    const shadow = this.scene.add.ellipse(0, r * 1.02, r * 1.5, r * 0.26, 0x000000, 0.12)
    // Growth-aura halo, behind the body inside the rig so it grows, breathes
    // and moves as one with the friend. Tinted a lightened body hue; applyAura
    // sets its alpha/scale from the current growth step.
    this.halo = this.scene.add.image(0, -r * 0.1, 'ftm-halo').setTint(this.lighten(color, 0.55))
    this.haloFull = (r * 3.2) / this.halo.width
    this.halo.setScale(this.haloFull)
    this.rig.add(this.halo)
    if (artBody) {
      this.monsterBody = this.scene.add.image(0, -r * 0.1, artKey(spec.art))
      this.bodyScale = (r * 2.3) / this.monsterBody.height
    } else {
      this.monsterBody = this.scene.add.image(
        0,
        -r * 0.1,
        textures.monsterTexture(this.scene, color, this.scene.bodyR),
      )
      this.bodyScale = 1
    }
    this.monsterBody.setScale(this.bodyScale)
    this.rig.add(this.monsterBody)
    this.monster.add([shadow, this.rig])

    // Face recipe: big close-set white eyes, pupils that drift toward touch.
    // Always engine-drawn (never baked into body art) so every friend blinks,
    // tracks and chomps the same way; face-eye/face-mouth sprites re-skin it.
    // Off-center face patch (e.g. the fox, whose tail widens the sprite): the
    // whole face shifts by faceX so it lands on the muzzle.
    this.faceOffX = (spec.faceX ?? 0) * r
    this.mouthOffY = spec.mouthY * r
    const fx = this.faceOffX
    const eyeR = r * 0.2
    const buildEye = (side: -1 | 1): Phaser.GameObjects.Container => {
      const eye = this.scene.add.container(fx + side * r * spec.eyeGap, r * spec.faceY)
      const white = this.scene.hasArt('face-eye')
        ? this.scene.add.image(0, 0, artKey('face-eye')).setDisplaySize(eyeR * 2, eyeR * 2)
        : this.scene.add.ellipse(0, 0, eyeR * 2, eyeR * 2, 0xffffff)
      // Pupil node = a big dark disc + a bright catchlight glint. The glint is
      // what turns a blank stare into a warm, alive eye; it rides with the
      // pupil as it tracks the touch.
      const pupil = this.scene.add.container(0, 0)
      const dark = this.scene.add.ellipse(0, 0, eyeR * 1.05, eyeR * 1.05, INK)
      const glint = this.scene.add.circle(-eyeR * 0.28, -eyeR * 0.3, eyeR * 0.24, 0xffffff)
      pupil.add([dark, glint])
      // Happy `^` closed eye for celebration/yum — hidden until toggled.
      // Squashed to ~half its old height (and a touch narrower) so the arc
      // reads as a delicate, thin `^` instead of a heavy chunky wedge.
      const happy = this.scene.hasArt('face-eye-happy')
        ? this.scene.add
            .image(0, 0, artKey('face-eye-happy'))
            .setDisplaySize(eyeR * 2.1, eyeR * 0.75)
            .setVisible(false)
        : null
      eye.add(happy ? [white, pupil, happy] : [white, pupil])
      if (side < 0) {
        this.pupilL = pupil
        this.eyeWhiteL = white
        this.happyL = happy
      } else {
        this.pupilR = pupil
        this.eyeWhiteR = white
        this.happyR = happy
      }
      return eye
    }
    this.eyeL = buildEye(-1)
    this.eyeR = buildEye(1)

    // Art bodies bake their own blush next to the face patch.
    const blush: Phaser.GameObjects.GameObject[] = artBody
      ? []
      : [
          this.scene.add.ellipse(fx - r * 0.62, r * 0.08, r * 0.22, r * 0.15, PINK, 0.4),
          this.scene.add.ellipse(fx + r * 0.62, r * 0.08, r * 0.22, r * 0.15, PINK, 0.4),
        ]

    const mouth = this.scene.add.container(fx, r * spec.mouthY)
    this.artMouth = this.scene.hasArt('face-mouth')
    if (this.artMouth) {
      const lips = this.scene.add.image(0, 0, artKey('face-mouth'))
      this.mouthBase = { x: (r * 0.9) / lips.width, y: (r * 0.6) / lips.height }
      this.mouthLips = lips
    } else {
      this.mouthLips = this.scene.add.ellipse(0, 0, r * 0.9, r * 0.6, INK)
      this.mouthBase = { x: 1, y: 1 }
    }
    this.mouthTongue = this.scene.add.ellipse(0, r * 0.1, r * 0.5, r * 0.34, PINK)
    this.mouthTongue.setAlpha(0)
    this.mouthTongue.setVisible(!this.artMouth) // sprite mouth bakes the tongue
    mouth.add([this.mouthLips, this.mouthTongue])

    // Resting face = a closed smile sprite; the open mouth is only for eating.
    // applyMouth crossfades them so the friend looks content at rest instead of
    // frozen with a flattened/gaping mouth (the old "creepy" resting look).
    if (this.artMouth && this.scene.hasArt('face-mouth-smile')) {
      const smile = this.scene.add.image(0, 0, artKey('face-mouth-smile'))
      // Half the previous height (origin is centered, so it shrinks in place —
      // the smile's vertical center stays put) → a thinner, calmer smile.
      this.mouthBaseSmile = { x: (r * 0.58) / smile.width, y: (r * 0.13) / smile.height }
      smile.setScale(this.mouthBaseSmile.x, this.mouthBaseSmile.y)
      // Sit the resting smile higher than the (lower) open mouth — it reads as
      // a small content smile, and the crossfade to the open mouth then plays
      // as the mouth naturally dropping open to eat.
      smile.setPosition(0, -r * 0.15)
      this.mouthSmile = smile
      mouth.add(smile)
    } else {
      this.mouthSmile = null
    }
    // Wide laugh, shown on happy beats (beHappy) instead of the smile/open.
    if (this.artMouth && this.scene.hasArt('face-mouth-giggle')) {
      const giggle = this.scene.add.image(0, 0, artKey('face-mouth-giggle')).setVisible(false)
      giggle.setScale((r * 0.95) / giggle.width, (r * 0.48) / giggle.height)
      this.mouthGiggle = giggle
      mouth.add(giggle)
    } else {
      this.mouthGiggle = null
    }

    this.nose = this.scene.add.ellipse(fx, -r * 0.02, r * 0.22, r * 0.16, darken(color))
    if (artBody) this.nose.setAlpha(0.001) // keep the sneeze hotspot, hide the blot

    this.rig.add([...blush, this.eyeL, this.eyeR, mouth, this.nose])
    this.applyMouth()

    // Idle life: the whole rig breathes as one, so the halo, body and face
    // pulse together (monster's own scale is reserved for growth/squash — see
    // the rig field note).
    this.scene.tweens.add({
      targets: this.rig,
      scaleX: 1.03,
      scaleY: 1.03,
      duration: 2200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })

    // Tap the body → giggle. Tap the nose → sneeze (easter egg).
    // Hit shapes live in unscaled frame coords, hence the /bodyScale.
    const frame = this.scene.textures.getFrame(this.monsterBody.texture.key)
    this.monsterBody.setInteractive(
      new Phaser.Geom.Circle(
        frame.width / 2,
        frame.height / 2 + (artBody ? 0 : r * 0.1),
        r / this.bodyScale,
      ),
      Phaser.Geom.Circle.Contains,
    )
    this.monsterBody.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.getDistance() < this.px(10)) this.giggle()
    })
    this.nose.setInteractive(
      new Phaser.Geom.Circle(r * 0.11, r * 0.08, r * 0.24),
      Phaser.Geom.Circle.Contains,
    )
    this.nose.on('pointerdown', () => this.sneeze())

    // Light the aura to this friend's growth step (instant on a fresh build;
    // the grow/shrink pops animate via applyAura(true)).
    this.applyAura(false)
  }

  // ─── Growth aura (the friend "grows up" without any worn accessories) ─────

  /** Blend a hex color toward white by t (0 = unchanged, 1 = white). */
  lighten(color: number, t: number): number {
    const mix = (c: number): number => Math.round(c + (255 - c) * t)
    return (mix((color >> 16) & 0xff) << 16) | (mix((color >> 8) & 0xff) << 8) | mix(color & 0xff)
  }

  /**
   * Push the growth-aura halo to a growth step's intensity (brighter + wider
   * the more grown) — animated for the grow/shrink pop, instant on a rebuild.
   * The fully-grown finale passes GROW_STEPS so the just-completed friend blazes
   * at full before it walks aside to the (also glowing) lineup.
   */
  applyAura(animated: boolean, step = this.scene.journey.growthStep): void {
    const t = auraIntensity(step)
    const alpha = 0.2 + 0.55 * t
    const scale = this.haloFull * (0.85 + 0.3 * t)
    if (animated) {
      this.scene.tweens.add({
        targets: this.halo,
        alpha,
        scaleX: scale,
        scaleY: scale,
        duration: 420,
        ease: 'Sine.easeOut',
      })
    } else {
      this.halo.setAlpha(alpha).setScale(scale)
    }
  }

  /**
   * One tick of the ambient growth sparkles: a few glints pop on a ring around
   * the friend, denser the more grown it is (rate ∝ auraIntensity). Read off
   * the LIVE monster transform so they track it through growth and the
   * walk-aside; skipped while the walker is torn down between friends.
   */
  tickAura(): void {
    if (!this.monster || !this.monster.active) return
    const t = auraIntensity(this.scene.journey.growthStep)
    let n = 0
    if (Math.random() < t) n++
    if (Math.random() < t * 0.6) n++
    if (n === 0) return
    const rx = this.scene.bodyR * this.monster.scaleX
    const cy = this.monster.y - this.scene.bodyR * this.monster.scaleY * 0.12
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2
      const rr = rx * (0.6 + Math.random() * 0.5)
      this.scene.auraSparkle.emitParticleAt(
        this.monster.x + Math.cos(angle) * rr,
        cy + Math.sin(angle) * rr * 0.8,
        1,
      )
    }
  }

  // ─── Mouth helpers ───────────────────────────────────────────────────────

  mouthWorld(): XY {
    return {
      x: this.monster.x + this.faceOffX * this.monster.scaleX,
      y: this.monster.y + this.mouthOffY * this.monster.scaleY,
    }
  }

  private noseWorld(): XY {
    return {
      x: this.monster.x + this.faceOffX * this.monster.scaleX,
      y: this.monster.y - this.scene.bodyR * 0.02 * this.monster.scaleY,
    }
  }

  setMouthOpen(target: number, duration: number): void {
    this.mouthTween?.stop()
    this.mouthTween = this.scene.tweens.add({
      targets: this.mouthState,
      open: target,
      duration,
      ease: 'Quad.easeOut',
      onUpdate: () => this.applyMouth(),
    })
  }

  private applyMouth(): void {
    if (this.happyEyes && this.mouthGiggle) return // beHappy owns the mouth
    const open = this.mouthState.open
    if (this.mouthSmile) {
      // Hard swap (no alpha crossfade) between the resting smile and the open
      // mouth: the old fade left both mouths partly visible mid-transition,
      // which read as a double-mouth artifact. The open mouth keeps a rounded
      // min shape (scaleY ≥ 0.4) so the instant swap never flashes a flat
      // line; the smooth open/close motion comes from the scaleY ramp below.
      const opening = open > 0.02
      this.mouthSmile.setAlpha(opening ? 0 : 1)
      this.mouthLips.setAlpha(opening ? 1 : 0)
      this.mouthLips.setScale(
        this.mouthBase.x * (1 + open * 0.12),
        this.mouthBase.y * (0.4 + 0.6 * open),
      )
      return
    }
    this.mouthLips.setScale(
      this.mouthBase.x * (1 + open * 0.15),
      this.mouthBase.y * (0.14 + 0.86 * open),
    )
    if (this.artMouth) return // sprite mouth carries its own tongue
    this.mouthTongue.setAlpha(open)
    this.mouthTongue.setScale(1, 0.4 + 0.6 * open)
  }

  /** Toggle the happy `^^` closed eyes (no-op without the sprite). */
  private setHappyEyes(on: boolean): void {
    if (!this.happyL || !this.happyR) return
    this.happyEyes = on
    this.happyL.setVisible(on)
    this.happyR.setVisible(on)
    this.eyeWhiteL.setVisible(!on)
    this.eyeWhiteR.setVisible(!on)
    this.pupilL.setVisible(!on)
    this.pupilR.setVisible(!on)
  }

  /**
   * A burst of pure joy: happy `^^` eyes + the wide laugh mouth, reverting to
   * the resting smile after `ms`. Guards on `.active` so a revert scheduled
   * before a friend rebuild (celebration) never touches a destroyed sprite.
   */
  beHappy(ms: number): void {
    this.setHappyEyes(true)
    if (this.mouthGiggle) {
      this.mouthSmile?.setVisible(false)
      this.mouthLips.setVisible(false)
      this.mouthGiggle.setVisible(true)
    }
    this.scene.time.delayedCall(ms, () => {
      this.setHappyEyes(false)
      if (this.mouthGiggle?.active) {
        this.mouthGiggle.setVisible(false)
        this.mouthLips.setVisible(true)
        this.mouthSmile?.setVisible(true)
        this.applyMouth()
      }
    })
  }

  // ─── Reactions ───────────────────────────────────────────────────────────

  shakeHead(): void {
    const baseX = this.scene.monsterPos().x
    this.scene.tweens.killTweensOf(this.monster)
    this.monster.setScale(this.scene.growth)
    this.scene.tweens.add({
      targets: this.monster,
      x: baseX + this.px(8),
      duration: 50,
      yoyo: true,
      repeat: 3,
      ease: 'Sine.easeInOut',
      onComplete: () => this.monster.setX(baseX),
    })
  }

  squintEyes(): void {
    for (const eye of [this.eyeL, this.eyeR]) {
      this.scene.tweens.killTweensOf(eye)
      this.scene.tweens.add({
        targets: eye,
        scaleY: 0.35,
        duration: 120,
        yoyo: true,
        hold: 350,
        ease: 'Quad.easeOut',
        onComplete: () => eye.setScale(1),
      })
    }
  }

  private giggle(): void {
    // Never during round transitions: killTweensOf would sever the
    // walk-aside/party tween chain that carries the friend sequence.
    if (this.scene.transitioning) return
    this.beHappy(700)
    playTone(784, 60, 'sine', 0.07)
    this.scene.time.delayedCall(80, () => playTone(880, 70, 'sine', 0.07))
    this.scene.tweens.killTweensOf(this.monster)
    this.monster.setScale(this.scene.growth)
    this.scene.tweens.add({
      targets: this.monster,
      rotation: 0.05,
      duration: 70,
      yoyo: true,
      repeat: 3,
      ease: 'Sine.easeInOut',
      onComplete: () => this.monster.setRotation(0),
    })
  }

  /** Easter egg: tap the nose → wind-up… ah-CHOO! */
  private sneeze(): void {
    // Same transition guard as giggle(): a mid-walk rebuild would kill the
    // sneeze tween chain and strand `sneezing` forever (no blinks all session).
    if (this.scene.sneezing || this.scene.transitioning) return
    this.scene.sneezing = true
    playTone(660, 130, 'triangle', 0.07)
    for (const eye of [this.eyeL, this.eyeR]) {
      this.scene.tweens.add({ targets: eye, scaleY: 0.1, duration: 200, ease: 'Quad.easeOut' })
    }
    this.scene.tweens.add({
      targets: this.monster,
      scaleX: this.scene.growth * 0.96,
      scaleY: this.scene.growth * 1.1,
      duration: 280,
      ease: 'Quad.easeOut',
      onComplete: () => {
        playTone(880, 60, 'triangle', 0.1)
        this.scene.time.delayedCall(70, () => playTone(330, 210, 'triangle', 0.09))
        const nose = this.noseWorld()
        this.scene.puffs.explode(12, nose.x, nose.y)
        this.scene.tweens.add({
          targets: this.monster,
          scaleX: this.scene.growth * 1.14,
          scaleY: this.scene.growth * 0.84,
          duration: 90,
          yoyo: true,
          ease: 'Quad.easeIn',
          onComplete: () => {
            this.monster.setScale(this.scene.growth)
            for (const eye of [this.eyeL, this.eyeR]) eye.setScale(1)
            this.scene.sneezing = false
          },
        })
      },
    })
  }

  scheduleBlink(): void {
    this.scene.time.delayedCall(3000 + Math.random() * 3000, () => {
      if (!this.scene.sneezing && !this.happyEyes) {
        for (const eye of [this.eyeL, this.eyeR]) {
          if (this.scene.tweens.isTweening(eye)) continue
          this.scene.tweens.add({
            targets: eye,
            scaleY: 0.1,
            duration: 60,
            yoyo: true,
            hold: 40,
            ease: 'Quad.easeIn',
          })
        }
      }
      // The lineup blinks too, each slightly offset so it never looks robotic.
      for (const { eye } of this.scene.stage.miniPupils) {
        if (!eye.active || this.scene.tweens.isTweening(eye)) continue
        this.scene.tweens.add({
          targets: eye,
          scaleY: 0.1,
          duration: 60,
          yoyo: true,
          hold: 40,
          delay: Math.random() * 500,
          ease: 'Quad.easeIn',
        })
      }
      this.scheduleBlink()
    })
  }

  // ─── Per-frame: pupils track the food / last touch ───────────────────────

  update(): void {
    const pointer = this.scene.input.activePointer
    const target: XY = this.scene.dragged
      ? { x: this.scene.dragged.x, y: this.scene.dragged.y }
      : { x: pointer.worldX, y: pointer.worldY }
    const crossEyed = this.scene.time.now < this.scene.funnyUntil
    // Kept small so a big pupil never spills past the eye white, even when the
    // eye squashes mid-blink.
    const maxOff = this.scene.bodyR * 0.05

    // Only the walker's pupils follow the food/touch (it looks at what it's
    // being fed). Happy `^^` eyes have no pupil to steer — skip them.
    // The lineup friends do NOT track (there is no cursor on the iPad, and
    // constant following looks uncanny) — they idle-glance on their own timers.
    if (!this.happyEyes) {
      const eyes: Array<[Phaser.GameObjects.Container, Phaser.GameObjects.Container, number]> = [
        [this.eyeL, this.pupilL, 1],
        [this.eyeR, this.pupilR, -1],
      ]
      for (const [eye, pupil, side] of eyes) {
        let dx: number
        let dy: number
        if (crossEyed) {
          dx = side * maxOff * 0.9
          dy = maxOff * 0.5
        } else {
          const m = eye.getWorldTransformMatrix()
          const angle = Math.atan2(target.y - m.ty, target.x - m.tx)
          dx = Math.cos(angle) * maxOff
          dy = Math.sin(angle) * maxOff
        }
        pupil.x += (dx - pupil.x) * 0.18
        pupil.y += (dy - pupil.y) * 0.18
      }
    }
  }
}
