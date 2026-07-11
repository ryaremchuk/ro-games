// ART: PAW-Patrol-style card art. Generated as a single 4x4 sprite sheet, sliced into
// per-subject transparent PNGs in ./art (hashed + base-aware via Vite, like the
// whack-a-silly critters). The exported API is a fixed contract with MemoryScene:
// do not change key/label/blob or the signatures. The card-back paw print stays a
// tiny inline SVG — no asset file needed for one flat white shape.

export interface ArtSubject {
  key: string
  label: string
  /** Pastel hex for the card-front circle behind the art. */
  blob: string
  /** Texture source for Phaser's loader: a Vite asset URL (or data URI). */
  textureUrl: string
}

const ART_URLS = import.meta.glob('./art/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

function subject(key: string, label: string, blob: string): ArtSubject {
  const textureUrl = ART_URLS[`./art/${key}.png`]
  if (!textureUrl) throw new Error(`memory: missing card art for "${key}"`)
  return { key, label, blob, textureUrl }
}

export const CARD_SUBJECTS: readonly ArtSubject[] = [
  subject('chase', 'Police puppy', '#D6E6FA'),
  subject('marshall', 'Fire puppy', '#FBD9D7'),
  subject('skye', 'Flying puppy', '#FBDCEC'),
  subject('rubble', 'Construction puppy', '#FDEFC9'),
  subject('rocky', 'Recycling puppy', '#D9F0DB'),
  subject('zuma', 'Water puppy', '#FCE3CC'),
  subject('everest', 'Snow puppy', '#D2EFEE'),
  subject('police-truck', 'Police truck', '#D6E6FA'),
  subject('fire-truck', 'Fire truck', '#FBD9D7'),
  subject('helicopter', 'Pink helicopter', '#FBDCEC'),
  subject('bulldozer', 'Yellow bulldozer', '#FDEFC9'),
  subject('hovercraft', 'Orange hovercraft', '#FCE3CC'),
  subject('snowplow', 'Snowplow', '#D2EFEE'),
  subject('badge', 'Rescue badge', '#FDEFC9'),
  subject('bone', 'Puppy bone', '#FBEEDC'),
  subject('lookout-tower', 'Lookout tower', '#D6E6FA'),
]

const PAW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="512" height="512"><path d="M128 131 C 158 131 168 151 164 169 C 160 187 96 187 92 169 C 88 151 98 131 128 131 Z" fill="#FFFFFF"/><ellipse cx="90" cy="117" rx="12" ry="17" transform="rotate(-16 90 117)" fill="#FFFFFF"/><ellipse cx="114" cy="97" rx="12" ry="17" transform="rotate(-6 114 97)" fill="#FFFFFF"/><ellipse cx="142" cy="97" rx="12" ry="17" transform="rotate(6 142 97)" fill="#FFFFFF"/><ellipse cx="166" cy="117" rx="12" ry="17" transform="rotate(16 166 117)" fill="#FFFFFF"/></svg>`

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
}

export const PAW_PRINT: ArtSubject = {
  key: 'paw-print',
  label: 'Paw print',
  blob: '#FFFFFF',
  textureUrl: svgToDataUri(PAW_SVG),
}
