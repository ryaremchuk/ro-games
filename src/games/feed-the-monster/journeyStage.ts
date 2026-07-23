/**
 * The long-term journey STAGE — the grown-friends lineup + every between-round
 * celebration sequence (the friend growing up, walking aside to join the pile,
 * the lineup's welcome dance, a brand-new friend entering, and the grander
 * episode hand-off).
 *
 * Factored out of the scene so all of the journey's spectacle lives in one
 * widget. The scene constructs one (`new JourneyStage(this)`) and delegates; the
 * stage owns the lineup display objects (`minis`) and their idle-glance pupils
 * (`miniPupils`) and reads live scene state (bodyR / growth / journey / episode)
 * plus the monster rig, particle emitters and layout/color helpers back through
 * the passed scene reference. The journey STATE machine itself (applyJourney /
 * feedStep / round flow) stays on the scene and calls into the stage.
 */
import Phaser from 'phaser'
import { playTone } from '../../shared/audio'
import { FRIENDS_PER_EPISODE, episodeFor, friendColor, scaleForStep } from './journey'
import { artKey, friendSpec } from './art'
import * as textures from './textures'
import type FeedTheMonsterScene from './FeedTheMonsterScene'

// Mirrors the scene's ART SPEC ink — shared by the lineup minis' pupils/mouth
// here and the walker's face on the rig, so all keep the exact same literal
// (see monsterRig.ts / requestBubble.ts for the same duplicate-to-avoid-a-
// value-import pattern).
const INK = 0x3d3a4b
// Mirrors the scene's FOOD_CSS: the episode hand-off rebuilds the scene textures
// at this footprint, so it must match the scene's value exactly.
const FOOD_CSS = 64

export class JourneyStage {
  /**
   * The fed-friends lineup containers (a cozy pile bottom-left). Public so the
   * scene's layout() bobs them and applyJourney() rebuilds the pile.
   */
  minis: Phaser.GameObjects.Container[] = []
  /**
   * Lineup minis' pupils (node + its eye container) for pointer tracking.
   * Public so MonsterRig's scheduleBlink can blink the lineup too.
   */
  miniPupils: Array<{
    node: Phaser.GameObjects.Container
    eye: Phaser.GameObjects.Container
  }> = []

  private readonly scene: FeedTheMonsterScene

  constructor(scene: FeedTheMonsterScene) {
    this.scene = scene
  }

  private px(css: number): number {
    return css * this.scene.dpr
  }

  /** Fed-friends count, for the e2e state hook (was `this.minis.length`). */
  get miniCount(): number {
    return this.minis.length
  }

  /** A simplified grown friend for the lineup: body + eyes, gently bobbing. */
  spawnMini(index: number, episode = this.scene.journey.episode): Phaser.GameObjects.Container {
    const color = friendColor(episode, index)
    const r = this.scene.bodyR
    const slot = this.scene.miniSlot(index)
    const mini = this.scene.add.container(slot.x, slot.y).setDepth(2).setScale(0.3)

    const shadow = this.scene.add.ellipse(0, r * 1.02, r * 1.5, r * 0.26, 0x000000, 0.1)
    const spec = friendSpec(episode, index)
    const body = this.scene.hasArt(spec.art)
      ? this.scene.add
          .image(0, -r * 0.1, artKey(spec.art))
          .setScale((r * 2.3) / this.scene.textures.getFrame(artKey(spec.art)).height)
      : this.scene.add.image(
          0,
          -r * 0.1,
          textures.monsterTexture(this.scene, color, this.scene.bodyR),
        )
    // Match the walker's face anchors so the lineup mini reads as the same
    // animal (eyes on its own patch, mouth below). Each eye is a container with
    // a pupil node so the mini can idle-glance on its own (scheduleMiniGlance)
    // — alive, but never cursor-tracking (no iPad cursor).
    const fx = (spec.faceX ?? 0) * r // shift the face onto an off-center patch
    const glanceNodes: Phaser.GameObjects.Container[] = []
    const eye = (side: -1 | 1): Phaser.GameObjects.Container => {
      const ec = this.scene.add.container(fx + side * r * spec.eyeGap, r * spec.faceY)
      const white = this.scene.add.ellipse(0, 0, r * 0.34, r * 0.34, 0xffffff)
      const node = this.scene.add.container(0, 0)
      const dark = this.scene.add.ellipse(0, 0, r * 0.2, r * 0.2, INK)
      const glint = this.scene.add.circle(-r * 0.05, -r * 0.06, r * 0.05, 0xffffff)
      node.add([dark, glint])
      ec.add([white, node])
      this.miniPupils.push({ node, eye: ec })
      glanceNodes.push(node)
      return ec
    }
    const smile = this.scene.hasArt('face-mouth-smile')
      ? this.scene.add
          .image(fx, r * spec.mouthY - r * 0.13, artKey('face-mouth-smile'))
          .setDisplaySize(r * 0.55, r * 0.15)
      : this.scene.add.ellipse(fx, r * spec.mouthY - r * 0.13, r * 0.42, r * 0.09, INK)
    // A soft, full-strength halo marks the lineup friend as fully grown — the
    // same growth aura the walker earned, standing in for the old crown. Behind
    // the body, tinted a lightened body hue (art.ts socket rig is gone).
    const halo = this.scene.add
      .image(0, -r * 0.1, 'ftm-halo')
      .setTint(this.scene.monsterRig.lighten(color, 0.55))
    halo.setDisplaySize(r * 3.2, r * 3.2).setAlpha(0.5)
    mini.add([shadow, halo, body, eye(-1), eye(1), smile])

    // Idle life so the lineup feels alive, staggered per slot.
    this.scene.tweens.add({
      targets: mini,
      y: slot.y - this.px(6),
      duration: 1600 + index * 180,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
    this.scheduleMiniGlance(glanceNodes)

    this.minis.push(mini)
    return mini
  }

  /**
   * A lineup friend idly looks around on its own — both eyes drift together to
   * a gentle random direction (or straight ahead), then re-schedule after a
   * random pause. Independent per mini and untethered from any pointer, so the
   * lineup feels curious and alive on a touch device with no cursor. The chain
   * self-terminates once the mini's pupils are destroyed (rebuild/episode).
   */
  private scheduleMiniGlance(nodes: Phaser.GameObjects.Container[]): void {
    const alive = nodes.filter((n) => n.active)
    if (alive.length === 0) return
    const reach = this.scene.bodyR * 0.06
    const ahead = Math.random() < 0.35
    const angle = Math.random() * Math.PI * 2
    const dx = ahead ? 0 : Math.cos(angle) * reach
    const dy = ahead ? 0 : Math.sin(angle) * reach * 0.7 // less vertical travel
    for (const node of alive) {
      this.scene.tweens.add({ targets: node, x: dx, y: dy, duration: 420, ease: 'Sine.easeInOut' })
    }
    this.scene.time.delayedCall(900 + Math.random() * 1900, () => this.scheduleMiniGlance(nodes))
  }

  /**
   * The grown friend celebrates and walks aside to join the lineup; then the
   * whole lineup dances to welcome the newcomer before the next friend arrives.
   * On the fifth friend the dance is grander and hands off to the next episode.
   * `onResume` restarts play once the new (or next-episode) friend is on stage.
   */
  friendGrownSequence(danceParty: boolean, onResume: () => void): void {
    const mp = this.scene.monsterPos()
    // Star shower + a proud jump.
    this.scene.stars.explode(16, mp.x, mp.y - this.scene.bodyR * this.scene.growth)
    ;[523, 659, 784, 1047].forEach((freq, i) =>
      this.scene.time.delayedCall(i * 120, () => playTone(freq, 160, 'triangle', 0.1)),
    )
    this.scene.tweens.add({
      targets: this.scene.monsterRig.container,
      y: mp.y - this.px(50),
      duration: 240,
      yoyo: true,
      ease: 'Quad.easeOut',
    })

    // Walk aside to the lineup slot, shrinking into a mini…
    const grownIndex = danceParty ? FRIENDS_PER_EPISODE - 1 : this.scene.journey.friendsFed - 1
    const episodeAtGrow = this.scene.journey.episode - (danceParty ? 1 : 0)
    const slot = this.scene.miniSlot(grownIndex)
    this.scene.time.delayedCall(900, () => {
      this.scene.tweens.add({
        targets: this.scene.monsterRig.container,
        x: slot.x,
        y: slot.y,
        scaleX: 0.3,
        scaleY: 0.3,
        duration: 700,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          // …swap the walker for a lineup mini…
          this.scene.monsterRig.container.destroy()
          const mini = this.spawnMini(grownIndex, episodeAtGrow)
          mini.setScale(0)
          this.scene.tweens.add({
            targets: mini,
            scaleX: 0.3,
            scaleY: 0.3,
            duration: 260,
            ease: 'Back.easeOut',
          })
          // …then the whole lineup dances to greet the new friend. Only after
          // the dance does the next friend hop in (or, on the fifth, the world
          // turns over to the next episode).
          const danceMs = this.celebrateLineup(danceParty)
          this.scene.time.delayedCall(danceMs + 300, () => {
            if (danceParty) this.episodeTransition(onResume)
            else this.nextFriendEnters(onResume)
          })
        },
      })
    })
  }

  /** A brand-new small friend hops in from the side, then play resumes. */
  private nextFriendEnters(onResume: () => void): void {
    this.scene.growth = scaleForStep(this.scene.journey.growthStep)
    this.scene.monsterRig.build()

    const mp = this.scene.monsterPos()
    this.scene.monsterRig.container.setPosition(this.scene.scale.width + this.scene.bodyR, mp.y)
    this.scene.tweens.add({
      targets: this.scene.monsterRig.container,
      x: mp.x,
      duration: 600,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.scene.layout()
        onResume()
      },
    })
    playTone(659, 90, 'sine', 0.08)
    this.scene.time.delayedCall(110, () => playTone(880, 110, 'sine', 0.08))
  }

  /**
   * The fed friends in the lineup dance — a staggered bounce-and-wobble wave
   * with confetti, stars and a little melody. Played every time a friend joins
   * (light) and again, grander, when the fifth completes the episode. Returns
   * the wave's duration in ms so the caller can time what comes next.
   */
  private celebrateLineup(grand: boolean): number {
    const cx = this.scene.scale.width / 2
    const repeat = grand ? 3 : 1
    const waves = grand ? [0, 1] : [0]
    waves.forEach((wave) => {
      this.scene.time.delayedCall(wave * 900, () => {
        this.scene.confetti.explode(grand ? 50 : 26, cx * 0.5, this.px(90))
        this.scene.confetti.explode(grand ? 50 : 26, cx * 1.5, this.px(90))
        this.scene.stars.explode(grand ? 12 : 8, cx, this.px(140))
      })
    })
    // A little party melody — a longer flourish for the episode finale.
    const melody = grand ? [523, 659, 784, 659, 880, 784, 1047] : [523, 659, 784, 1047]
    melody.forEach((freq, i) =>
      this.scene.time.delayedCall(i * 180, () => playTone(freq, 150, 'triangle', 0.1)),
    )
    // Everyone bounces + wobbles in a staggered wave.
    this.minis.forEach((mini, i) => {
      this.scene.tweens.add({
        targets: mini,
        y: mini.y - this.px(46),
        delay: i * 130,
        duration: 260,
        yoyo: true,
        repeat,
        ease: 'Quad.easeOut',
      })
      this.scene.tweens.add({
        targets: mini,
        angle: { from: -8, to: 8 },
        delay: i * 130,
        duration: 260,
        yoyo: true,
        repeat,
        ease: 'Sine.easeInOut',
        onComplete: () => mini.setAngle(0),
      })
    })

    const lastDelay = Math.max(this.minis.length - 1, 0) * 130
    return lastDelay + 260 * 2 * (repeat + 1)
  }

  /** Soft white fade → new palette, food pool, fresh lineup, first friend. */
  private episodeTransition(onResume: () => void): void {
    const veil = this.scene.add
      .rectangle(0, 0, this.scene.scale.width, this.scene.scale.height, 0xffffff)
      .setOrigin(0)
      .setDepth(90)
      .setAlpha(0)
    this.scene.tweens.add({
      targets: veil,
      alpha: 1,
      duration: 550,
      ease: 'Sine.easeIn',
      onComplete: () => {
        // Behind the veil: swap the world.
        this.scene.episode = episodeFor(this.scene.journey)
        textures.buildSceneTextures(this.scene, {
          dpr: this.scene.dpr,
          bodyR: this.scene.bodyR,
          episode: this.scene.episode,
          color: this.scene.friendBodyColor(),
          foodCss: FOOD_CSS,
        })
        for (const mini of this.minis) {
          this.scene.tweens.killTweensOf(mini)
          mini.destroy()
        }
        this.minis = []
        this.miniPupils = []
        this.scene.growth = scaleForStep(this.scene.journey.growthStep)
        this.scene.monsterRig.build()
        this.scene.layout()
        ;[659, 784, 988].forEach((freq, i) =>
          this.scene.time.delayedCall(200 + i * 150, () => playTone(freq, 140, 'sine', 0.08)),
        )
        this.scene.tweens.add({
          targets: veil,
          alpha: 0,
          delay: 150,
          duration: 600,
          ease: 'Sine.easeOut',
          onComplete: () => {
            veil.destroy()
            onResume()
          },
        })
      },
    })
  }
}
