/**
 * Per-critter body palette for the swappable critter rig. The rig's body/belly/
 * paw textures are baked in GRAYSCALE with 3D shading; the scene tints them with
 * these colors (MULTIPLY, Phaser's default) so the shading survives and every
 * critter shares one set of textures. No Phaser import — pure data + a lookup,
 * so it is trivially unit-tested and the art can be re-skinned in one place.
 */
import { CRITTERS } from './logic'

export interface RigStyle {
  /** Grayscale body torso tint (the critter's main fur/skin color). */
  bodyColor: number
  /** Belly patch tint (usually a paler cream). */
  bellyColor: number
  /** Paw tint (a shade of the body color). */
  pawColor: number
}

/** One style per critter id in the pool (see logic.ts CRITTERS). */
export const RIG_STYLES: Record<string, RigStyle> = {
  hamster: { bodyColor: 0xf0b25f, bellyColor: 0xfff3e0, pawColor: 0xdb9a4a },
  rabbit: { bodyColor: 0xf2eef0, bellyColor: 0xffffff, pawColor: 0xdcd2d6 },
  hedgehog: { bodyColor: 0xb08968, bellyColor: 0xf3e6d5, pawColor: 0x94745a },
  frog: { bodyColor: 0x8fd14f, bellyColor: 0xeaffcf, pawColor: 0x72b23a },
  mouse: { bodyColor: 0xc9c7d2, bellyColor: 0xffffff, pawColor: 0xb0adbd },
  chick: { bodyColor: 0xffd93d, bellyColor: 0xfff6c0, pawColor: 0xe8bd2a },
  fox: { bodyColor: 0xff8c42, bellyColor: 0xfff0e0, pawColor: 0xe0742f },
}

/** Style for a critter id; throws on an unknown id (mirrors critterById). */
export function rigStyleFor(id: string): RigStyle {
  const style = RIG_STYLES[id]
  if (!style) throw new Error(`No rig style for critter id: ${id}`)
  return style
}

/** Every critter in the pool must have a style (guarded by rigStyles.test.ts). */
export function everyCritterHasStyle(): boolean {
  return CRITTERS.every((c) => RIG_STYLES[c.id] !== undefined)
}
