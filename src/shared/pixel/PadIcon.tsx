/**
 * One rail icon, drawn from `shared/pixel/icons`.
 *
 * Two rules the pad depends on, both enforced here so no call site can forget:
 *  • The icon is sized as a SHARE OF ITS BUTTON, never from the PNG's intrinsic
 *    pixels — the sliced art is 384–593 px and the buttons come from `padLayout`
 *    (`layout.button`), so anything else would blow the rail apart on a phone.
 *  • The image is inert to input (`pointer-events: none`, `draggable={false}`).
 *    The pad captures pointers to draw strokes and the buttons want the press for
 *    themselves; a native image drag would fight both.
 *
 * `alt=""` is deliberate: the button already carries the `aria-label`, and a
 * second name for the same control just makes a screen reader say it twice.
 */

import type { CSSProperties, ReactNode } from 'react'
import { padIconUrl } from './icons'
import type { PadIconName } from './icons'

export interface PadIconProps {
  name: PadIconName
  /** Drawn instead when the PNG is missing — always a glyph, never bare text. */
  fallback: ReactNode
  /** Icon side as a share of its button. 1 = the icon IS the button face. */
  scale?: number
  /** Soft shadow under the art, for an icon that is the whole button face. */
  shadow?: boolean
}

export default function PadIcon({ name, fallback, scale = 0.76, shadow = false }: PadIconProps) {
  const url = padIconUrl(name)
  if (!url) return <>{fallback}</>
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      style={{
        ...iconStyle,
        width: `${scale * 100}%`,
        height: `${scale * 100}%`,
        ...(shadow ? { filter: 'drop-shadow(0 5px 10px rgba(0,0,0,0.32))' } : null),
      }}
    />
  )
}

const iconStyle: CSSProperties = {
  display: 'block',
  objectFit: 'contain',
  pointerEvents: 'none',
  userSelect: 'none',
}
