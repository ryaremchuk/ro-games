import { describe, expect, it } from 'vitest'
import { generateLevel, mulberry32 } from '../logic'
import { MAX_BLOCKS, MAX_PIGGIES, clamp, parseLevelSpec, round3 } from './parse'

describe('slingshot editor: parseLevelSpec', () => {
  const valid = () => generateLevel(3, mulberry32(3))

  it('round-trips every generated level 1..40 losslessly', () => {
    for (let level = 1; level <= 40; level++) {
      const spec = generateLevel(level, mulberry32(level))
      const res = parseLevelSpec(JSON.stringify(spec))
      expect(res.ok, `level ${level} must parse`).toBe(true)
      if (res.ok) expect(res.spec).toEqual(spec)
    }
  })

  it('rejects malformed JSON and non-object roots', () => {
    expect(parseLevelSpec('not json').ok).toBe(false)
    expect(parseLevelSpec('[]').ok).toBe(false)
    expect(parseLevelSpec('null').ok).toBe(false)
    expect(parseLevelSpec('42').ok).toBe(false)
  })

  it('rejects bad top-level fields with specific errors', () => {
    const spec = valid()
    const broken = (patch: object) => parseLevelSpec(JSON.stringify({ ...spec, ...patch }))

    expect(broken({ level: 0 })).toMatchObject({
      ok: false,
      error: expect.stringContaining('level'),
    })
    expect(broken({ level: 2.5 }).ok).toBe(false)
    expect(broken({ theme: 'volcano' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('theme'),
    })
    expect(broken({ gravityScale: 0 }).ok).toBe(false)
    expect(broken({ gravityScale: Number.NaN }).ok).toBe(false)
    expect(broken({ birds: [] }).ok).toBe(false)
    expect(broken({ birds: ['huge'] }).ok).toBe(false)
    expect(broken({ piggies: [] })).toMatchObject({
      ok: false,
      error: expect.stringContaining('piggies'),
    })
  })

  it('rejects invalid entries with indexed errors', () => {
    const spec = valid()
    const withBlock = (block: object) =>
      parseLevelSpec(JSON.stringify({ ...spec, blocks: [...spec.blocks, block] }))

    expect(withBlock({ material: 'gold', x: 0.5, y: 0.5, w: 0.1, h: 0.1, angle: 0 })).toMatchObject(
      {
        ok: false,
        error: expect.stringContaining('material'),
      },
    )
    expect(
      withBlock({ material: 'wood', x: Number.NaN, y: 0.5, w: 0.1, h: 0.1, angle: 0 }).ok,
    ).toBe(false)
    expect(withBlock({ material: 'wood', x: 0.5, y: 0.5, w: -0.1, h: 0.1, angle: 0 }).ok).toBe(
      false,
    )
    expect(withBlock({ material: 'wood', x: 9, y: 0.5, w: 0.1, h: 0.1, angle: 0 }).ok).toBe(false)

    const badPiggy = parseLevelSpec(JSON.stringify({ ...spec, piggies: [{ x: 0.5, y: 'top' }] }))
    expect(badPiggy).toMatchObject({ ok: false, error: expect.stringContaining('piggies[0]') })

    const badProp = parseLevelSpec(
      JSON.stringify({ ...spec, props: [{ kind: 'cannon', x: 0.5, y: 0.5 }] }),
    )
    expect(badProp).toMatchObject({ ok: false, error: expect.stringContaining('props[0]') })

    const badPropDim = parseLevelSpec(
      JSON.stringify({ ...spec, props: [{ kind: 'ball', x: 0.5, y: 0.5, r: 0 }] }),
    )
    expect(badPropDim.ok).toBe(false)
  })

  it('caps absurd object counts', () => {
    const spec = valid()
    const block = { material: 'wood', x: 0.5, y: 0.5, w: 0.05, h: 0.05, angle: 0 }
    const tooMany = { ...spec, blocks: Array.from({ length: MAX_BLOCKS + 1 }, () => block) }
    expect(parseLevelSpec(JSON.stringify(tooMany)).ok).toBe(false)

    const piggy = { x: 0.5, y: 0.5 }
    const herd = { ...spec, piggies: Array.from({ length: MAX_PIGGIES + 1 }, () => piggy) }
    expect(parseLevelSpec(JSON.stringify(herd)).ok).toBe(false)
  })

  it('drops unknown fields instead of passing them through', () => {
    const spec = valid()
    const withJunk = {
      ...spec,
      hack: 'x',
      blocks: spec.blocks.map((b) => ({ ...b, script: 'alert(1)' })),
    }
    const res = parseLevelSpec(JSON.stringify(withJunk))
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect('hack' in res.spec).toBe(false)
      expect(res.spec.blocks.every((b) => !('script' in b))).toBe(true)
    }
  })

  it('defaults missing block angle to 0', () => {
    const spec = valid()
    const blocks = spec.blocks.map(({ material, x, y, w, h }) => ({ material, x, y, w, h }))
    const res = parseLevelSpec(JSON.stringify({ ...spec, blocks }))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.spec.blocks.every((b) => b.angle === 0)).toBe(true)
  })

  it('helpers: round3 and clamp', () => {
    expect(round3(0.123456)).toBe(0.123)
    expect(round3(-0.0004)).toBe(-0)
    expect(clamp(5, 0, 1)).toBe(1)
    expect(clamp(-5, 0, 1)).toBe(0)
    expect(clamp(0.5, 0, 1)).toBe(0.5)
  })
})
