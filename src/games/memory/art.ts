// ART: Paw-Patrol-inspired ORIGINAL flat chibi art. Hand-authored SVGs.
// The exported API is a fixed contract: do not change key/label/blob or the signatures.
// Style: flat chibi, 2-4 fills + single warm-gray outline #33302E, rounded joins, no gradients, no text.

export interface ArtSubject {
  key: string
  label: string
  /** Pastel hex for the card-front circle behind the art. */
  blob: string
  /** Complete standalone <svg> string, viewBox="0 0 256 256" width="512" height="512". */
  svg: string
}

// ---------------------------------------------------------------------------
// Shared drawing helpers (pure string builders, run once at module load)
// ---------------------------------------------------------------------------

const OL = '#33302E' // outline colour
const S = `stroke="${OL}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"` // main outline
const S6 = `stroke="${OL}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"` // symbol outline

function wrap(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="512" height="512">${inner}</svg>`
}

/** Place a unit-space (origin-centred) symbol at (x,y) scaled by s. */
function at(x: number, y: number, s: number, inner: string): string {
  return `<g transform="translate(${x} ${y}) scale(${s})">${inner}</g>`
}

/** Rotate a unit-space symbol about the origin. */
function rot(deg: number, inner: string): string {
  return `<g transform="rotate(${deg})">${inner}</g>`
}

// --- Badge symbols (all authored in a ~ radius-20 unit box, origin centred) ---

function starPath(r: number, inner: number): string {
  let d = ''
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : inner
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    d +=
      (i === 0 ? 'M' : 'L') +
      (rr * Math.cos(a)).toFixed(1) +
      ' ' +
      (rr * Math.sin(a)).toFixed(1) +
      ' '
  }
  return d + 'Z'
}

function starSym(fill: string): string {
  return `<path d="${starPath(20, 9)}" fill="${fill}" ${S6}/>`
}

function flameSym(): string {
  return (
    `<path d="M0 -21 C 13 -6 19 5 9 16 C 4 22 -10 22 -14 11 C -17 3 -9 -4 -5 -10 C -2 -3 5 -8 0 -21 Z" fill="#F5821F" ${S6}/>` +
    `<path d="M1 -3 C 8 3 9 10 3 14 C 0 16 -6 15 -7 9 C -8 4 -3 0 -1 -6 C 1 -2 4 -3 1 -3 Z" fill="#FEE301"/>`
  )
}

function propellerSym(fill: string): string {
  const blade = `<ellipse cx="0" cy="-13" rx="6" ry="14" fill="${fill}" ${S6}/>`
  return (
    rot(0, blade) +
    rot(120, blade) +
    rot(240, blade) +
    `<circle cx="0" cy="0" r="5.5" fill="${OL}"/>`
  )
}

function wrenchSym(fill: string): string {
  return (
    `<g transform="rotate(45)">` +
    `<path d="M-7 -22 A9 9 0 1 0 7 -22" fill="none" stroke="${fill}" stroke-width="8" stroke-linecap="round"/>` +
    `<path d="M-7 22 A9 9 0 1 1 7 22" fill="none" stroke="${fill}" stroke-width="8" stroke-linecap="round"/>` +
    `<rect x="-5" y="-15" width="10" height="30" rx="5" fill="${fill}"/>` +
    `</g>`
  )
}

function recycleSym(fill: string): string {
  // one folded arrow, then three at 120deg -> a triangular recycle loop with an open centre
  const arrow = `<path d="M-11 -12 L3 -12 L3 -19 L17 -8 L3 3 L3 -4 L-11 -4 Z" fill="${fill}" ${S6}/>`
  return rot(0, arrow) + rot(120, arrow) + rot(240, arrow)
}

function anchorSym(fill: string): string {
  return (
    `<g fill="none" stroke="${fill}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">` +
    `<circle cx="0" cy="-16" r="5.5"/>` +
    `<line x1="0" y1="-10" x2="0" y2="16"/>` +
    `<line x1="-11" y1="-5" x2="11" y2="-5"/>` +
    `<path d="M-14 3 Q-13 16 0 17 Q13 16 14 3"/>` +
    `</g>` +
    `<path d="M-14 3 l-6 -1 l4 8 Z" fill="${fill}"/>` +
    `<path d="M14 3 l6 -1 l-4 8 Z" fill="${fill}"/>`
  )
}

function pineSym(fill: string): string {
  return (
    `<path d="M0 -21 L10 -4 L5 -4 L15 8 L8 8 L18 21 L-18 21 L-8 8 L-15 8 L-5 -4 L-10 -4 Z" fill="${fill}" ${S6}/>` +
    `<rect x="-4" y="19" width="8" height="7" fill="${fill}"/>`
  )
}

function pawSym(fill: string, sw: number): string {
  const st = sw ? `stroke="${OL}" stroke-width="${sw}" stroke-linejoin="round"` : ''
  // big low pad + 4 clearly-separated toe beans in an arc above (visible gaps so it reads as a paw)
  return (
    `<path d="M0 3 C 15 3 20 13 18 22 C 16 31 -16 31 -18 22 C -20 13 -15 3 0 3 Z" fill="${fill}" ${st}/>` +
    `<ellipse cx="-19" cy="-4" rx="6" ry="8.5" transform="rotate(-16 -19 -4)" fill="${fill}" ${st}/>` +
    `<ellipse cx="-7" cy="-14" rx="6" ry="8.5" transform="rotate(-6 -7 -14)" fill="${fill}" ${st}/>` +
    `<ellipse cx="7" cy="-14" rx="6" ry="8.5" transform="rotate(6 7 -14)" fill="${fill}" ${st}/>` +
    `<ellipse cx="19" cy="-4" rx="6" ry="8.5" transform="rotate(16 19 -4)" fill="${fill}" ${st}/>`
  )
}

// --- Pup face + body base -------------------------------------------------

function pupFace(muzzle: string): string {
  return (
    `<ellipse cx="128" cy="124" rx="37" ry="26" fill="${muzzle}" ${S}/>` +
    // eyes
    `<ellipse cx="104" cy="86" rx="11.5" ry="15" fill="${OL}"/>` +
    `<ellipse cx="152" cy="86" rx="11.5" ry="15" fill="${OL}"/>` +
    `<circle cx="99.5" cy="80" r="4.2" fill="#FFFFFF"/>` +
    `<circle cx="147.5" cy="80" r="4.2" fill="#FFFFFF"/>` +
    // nose
    `<path d="M117 105 Q128 99 139 105 Q137 116 128 119 Q119 116 117 105 Z" fill="${OL}" ${S6}/>` +
    // mouth + tongue
    `<path d="M128 119 L128 128" ${S} fill="none"/>` +
    `<path d="M105 128 Q128 151 151 128 Q128 138 105 128 Z" fill="#8A4438" ${S6}/>` +
    `<path d="M117 138 Q128 150 139 138 Q128 143 117 138 Z" fill="#F48FB1"/>`
  )
}

interface PupOpts {
  fur: string
  muzzle: string
  ears: string
  headExtras?: string
  headgear: string
  vest: string
  trim: string
  disc: string
  symbol: string
  tail?: string
}

function pup(o: PupOpts): string {
  return wrap(
    (o.tail ?? '') +
      o.ears +
      // body / vest
      `<path d="M74 232 Q69 156 128 150 Q187 156 182 232 Z" fill="${o.vest}" ${S}/>` +
      // collar trim
      `<path d="M85 161 Q128 149 171 161 Q159 179 128 179 Q97 179 85 161 Z" fill="${o.trim}" ${S}/>` +
      // feet
      `<ellipse cx="99" cy="230" rx="18" ry="13" fill="${o.fur}" ${S}/>` +
      `<ellipse cx="157" cy="230" rx="18" ry="13" fill="${o.fur}" ${S}/>` +
      // head
      `<ellipse cx="128" cy="94" rx="62" ry="56" fill="${o.fur}" ${S}/>` +
      (o.headExtras ?? '') +
      pupFace(o.muzzle) +
      o.headgear +
      // chest badge
      `<circle cx="128" cy="196" r="25" fill="#FFFFFF" ${S}/>` +
      `<circle cx="128" cy="196" r="19" fill="${o.disc}"/>` +
      at(128, 196, 0.72, o.symbol),
  )
}

// ---------------------------------------------------------------------------
// The 16 subjects
// ---------------------------------------------------------------------------

// chase — German-shepherd police pup
const chase = pup({
  fur: '#8B5A2B',
  muzzle: '#D9A870',
  ears:
    `<path d="M92 60 L70 16 Q100 26 116 54 Z" fill="#8B5A2B" ${S}/>` +
    `<path d="M164 60 L186 16 Q156 26 140 54 Z" fill="#8B5A2B" ${S}/>` +
    `<path d="M96 54 L82 28 Q101 36 109 52 Z" fill="#D9A870"/>` +
    `<path d="M160 54 L174 28 Q155 36 147 52 Z" fill="#D9A870"/>`,
  headgear:
    `<path d="M58 78 Q128 66 198 78 Q170 96 128 94 Q86 96 58 78 Z" fill="#123E73" ${S}/>` +
    `<path d="M70 74 Q62 30 128 30 Q194 30 186 74 Q128 62 70 74 Z" fill="#1D5FAD" ${S}/>` +
    `<path d="M72 67 Q128 57 184 67 L182 79 Q128 69 74 79 Z" fill="#FEE301" ${S6}/>` +
    at(128, 47, 0.42, starSym('#FEE301')),
  vest: '#1D5FAD',
  trim: '#FEE301',
  disc: '#1D5FAD',
  symbol: starSym('#FEE301'),
})

// marshall — dalmatian fire pup
const marshall = pup({
  fur: '#FFFFFF',
  muzzle: '#F1F1F1',
  ears:
    `<path d="M75 82 Q45 96 52 142 Q70 152 84 128 Q78 104 92 90 Z" fill="#FFFFFF" ${S}/>` +
    `<path d="M181 82 Q211 96 204 142 Q186 152 172 128 Q178 104 164 90 Z" fill="#FFFFFF" ${S}/>` +
    `<ellipse cx="64" cy="122" rx="12" ry="15" fill="#2B2B2B"/>`,
  headExtras:
    `<ellipse cx="92" cy="70" rx="13" ry="11" fill="#2B2B2B"/>` +
    `<ellipse cx="160" cy="112" rx="10" ry="9" fill="#2B2B2B"/>`,
  headgear:
    `<path d="M56 74 Q128 60 200 74 Q170 90 128 88 Q86 90 56 74 Z" fill="#BD221F" ${S}/>` +
    `<path d="M72 70 Q70 28 128 28 Q186 28 184 70 Q128 58 72 70 Z" fill="#BD221F" ${S}/>` +
    `<path d="M113 30 Q128 12 143 30 L139 52 Q128 46 117 52 Z" fill="#BD221F" ${S}/>` +
    `<path d="M118 40 L138 40 L135 55 Q128 61 121 55 Z" fill="#FEE301" ${S6}/>`,
  vest: '#BD221F',
  trim: '#FEE301',
  disc: '#FFFFFF',
  symbol: flameSym(),
})

// skye — cockapoo flying pup
const skye = pup({
  fur: '#E8A25C',
  muzzle: '#F6CE93',
  ears:
    `<path d="M74 78 Q42 92 50 140 Q66 156 86 134 Q78 104 92 88 Z" fill="#E8A25C" ${S}/>` +
    `<path d="M182 78 Q214 92 206 140 Q190 156 170 134 Q178 104 164 88 Z" fill="#E8A25C" ${S}/>`,
  headgear:
    `<path d="M66 82 Q60 30 128 28 Q196 30 190 82 Q170 70 128 70 Q86 70 66 82 Z" fill="#E84C9C" ${S}/>` +
    `<path d="M63 63 Q128 52 193 63 L191 74 Q128 63 65 74 Z" fill="#F7A8CC" ${S6}/>` +
    `<circle cx="103" cy="61" r="17" fill="#F5A623" ${S}/>` +
    `<circle cx="153" cy="61" r="17" fill="#F5A623" ${S}/>` +
    `<circle cx="98" cy="56" r="5" fill="#FFF3D6"/>` +
    `<circle cx="148" cy="56" r="5" fill="#FFF3D6"/>`,
  vest: '#E84C9C',
  trim: '#F7A8CC',
  disc: '#FFFFFF',
  symbol: propellerSym('#F5821F'),
})

// rubble — bulldog construction pup
const rubble = pup({
  fur: '#C68B4F',
  muzzle: '#F0DDB8',
  ears:
    `<path d="M78 66 Q54 62 54 92 Q68 100 84 84 Z" fill="#C68B4F" ${S}/>` +
    `<path d="M178 66 Q202 62 202 92 Q188 100 172 84 Z" fill="#C68B4F" ${S}/>`,
  headExtras:
    `<ellipse cx="96" cy="130" rx="20" ry="17" fill="#F0DDB8"/>` +
    `<ellipse cx="160" cy="130" rx="20" ry="17" fill="#F0DDB8"/>`,
  headgear:
    `<path d="M56 72 Q128 58 200 72 Q170 88 128 86 Q86 88 56 72 Z" fill="#F5B700" ${S}/>` +
    `<path d="M74 68 Q72 30 128 30 Q184 30 182 68 Q128 56 74 68 Z" fill="#F5B700" ${S}/>` +
    `<path d="M128 32 L128 62" ${S6} fill="none"/>` +
    `<path d="M104 34 L108 60" stroke="${OL}" stroke-width="4" stroke-linecap="round" fill="none"/>` +
    `<path d="M152 34 L148 60" stroke="${OL}" stroke-width="4" stroke-linecap="round" fill="none"/>` +
    `<path d="M74 66 Q128 74 182 66 L182 74 Q128 82 74 74 Z" fill="#8A9299" ${S6}/>`,
  vest: '#F5B700',
  trim: '#8A9299',
  disc: '#FFFFFF',
  symbol: wrenchSym('#8A9299'),
})

// rocky — mixed-breed recycling pup
const rocky = pup({
  fur: '#9AA0A6',
  muzzle: '#EDEFF1',
  ears:
    `<path d="M92 56 L70 14 Q98 24 112 54 Z" fill="#5F6B73" ${S}/>` +
    `<path d="M170 60 Q198 66 196 100 Q182 108 166 90 Q170 72 160 66 Z" fill="#5F6B73" ${S}/>`,
  headExtras: `<ellipse cx="150" cy="86" rx="21" ry="24" fill="#5F6B73"/>`,
  headgear:
    `<path d="M70 72 Q64 32 128 32 Q192 34 186 74 Q128 62 70 72 Z" fill="#3E9B4F" ${S}/>` +
    `<path d="M124 68 Q172 64 200 82 Q178 96 138 88 Q126 82 124 68 Z" fill="#3E9B4F" ${S}/>` +
    `<path d="M74 64 Q128 54 182 64 L181 74 Q128 64 75 74 Z" fill="#7BC67E" ${S6}/>` +
    `<circle cx="128" cy="34" r="6" fill="#7BC67E" ${S6}/>`,
  vest: '#3E9B4F',
  trim: '#7BC67E',
  disc: '#3E9B4F',
  symbol: recycleSym('#FFFFFF'),
})

// zuma — chocolate-lab water pup
const zuma = pup({
  fur: '#6B4226',
  muzzle: '#A9764F',
  ears:
    `<path d="M70 84 Q40 96 46 138 Q62 150 80 128 Q74 104 88 92 Z" fill="#5A3720" ${S}/>` +
    `<path d="M186 84 Q216 96 210 138 Q194 150 176 128 Q182 104 168 92 Z" fill="#5A3720" ${S}/>`,
  headgear:
    `<path d="M64 82 Q62 28 128 28 Q194 28 192 82 Q128 68 64 82 Z" fill="#F5821F" ${S}/>` +
    `<path d="M64 80 Q128 70 192 80 L190 92 Q128 82 66 92 Z" fill="#3B3B3B" ${S6}/>` +
    `<circle cx="128" cy="46" r="10" fill="#BBE3F5" ${S6}/>`,
  vest: '#F5821F',
  trim: '#3B3B3B',
  disc: '#FFFFFF',
  symbol: anchorSym('#1D5FAD'),
})

// everest — husky snow pup
const everest = pup({
  fur: '#B7A8C6',
  muzzle: '#FFFFFF',
  tail:
    `<path d="M182 214 Q226 208 220 168 Q214 144 190 154 Q212 166 200 190 Q192 206 182 214 Z" fill="#B7A8C6" ${S}/>` +
    `<path d="M198 176 Q212 172 214 156 Q206 158 198 168 Z" fill="#FFFFFF"/>`,
  ears:
    `<path d="M96 52 L72 10 Q100 22 114 52 Z" fill="#B7A8C6" ${S}/>` +
    `<path d="M160 52 L184 10 Q156 22 142 52 Z" fill="#B7A8C6" ${S}/>` +
    `<path d="M98 50 L82 22 Q100 30 110 50 Z" fill="#FFFFFF"/>` +
    `<path d="M158 50 L174 22 Q156 30 146 50 Z" fill="#FFFFFF"/>`,
  headExtras: `<path d="M110 44 Q128 70 146 44 Q140 96 128 100 Q116 96 110 44 Z" fill="#FFFFFF"/>`,
  headgear:
    `<path d="M66 78 Q128 66 190 78 L188 60 Q128 50 68 60 Z" fill="#2AB6B0" ${S}/>` +
    `<path d="M74 62 Q72 22 128 22 Q184 22 182 62 Q128 50 74 62 Z" fill="#2AB6B0" ${S}/>` +
    `<path d="M75 44 Q128 34 181 44 L180 56 Q128 46 76 56 Z" fill="#FEE301" ${S6}/>` +
    `<circle cx="128" cy="18" r="10" fill="#FFFFFF" ${S}/>`,
  vest: '#2AB6B0',
  trim: '#F5821F',
  disc: '#2AB6B0',
  symbol: pineSym('#FFFFFF'),
})

// --- Vehicles -------------------------------------------------------------

function wheels(x1: number, x2: number, cy: number, r: number): string {
  return (
    `<circle cx="${x1}" cy="${cy}" r="${r}" fill="#2B2B2B" ${S}/>` +
    `<circle cx="${x2}" cy="${cy}" r="${r}" fill="#2B2B2B" ${S}/>` +
    `<circle cx="${x1}" cy="${cy}" r="${(r * 0.42).toFixed(0)}" fill="#ABB7BD"/>` +
    `<circle cx="${x2}" cy="${cy}" r="${(r * 0.42).toFixed(0)}" fill="#ABB7BD"/>`
  )
}

// police-truck
const policeTruck = wrap(
  wheels(80, 176, 198, 27) +
    `<path d="M34 152 Q34 128 58 126 L198 126 Q222 128 222 152 L222 198 Q222 202 214 202 L42 202 Q34 202 34 196 Z" fill="#1D5FAD" ${S}/>` +
    `<path d="M70 126 L82 82 Q84 76 92 76 L164 76 Q172 76 174 82 L186 126 Z" fill="#FFFFFF" ${S}/>` +
    `<path d="M92 120 L100 92 L124 92 L124 120 Z" fill="#BBE3F5" ${S6}/>` +
    `<path d="M164 120 L156 92 L132 92 L132 120 Z" fill="#BBE3F5" ${S6}/>` +
    `<rect x="104" y="58" width="48" height="18" rx="5" fill="#EDEFF1" ${S}/>` +
    `<rect x="107" y="61" width="20" height="12" rx="3" fill="#D93636"/>` +
    `<rect x="129" y="61" width="20" height="12" rx="3" fill="#2E6FD0"/>` +
    at(128, 168, 0.75, starSym('#FEE301')) +
    `<circle cx="212" cy="164" r="8" fill="#FEE301" ${S6}/>` +
    `<rect x="30" y="188" width="14" height="16" rx="4" fill="#ABB7BD" ${S6}/>`,
)

// fire-truck
const fireTruck = wrap(
  wheels(84, 180, 200, 26) +
    `<g transform="rotate(-7 128 78)">` +
    `<rect x="30" y="70" width="164" height="15" rx="7" fill="#E8ECEF" ${S}/>` +
    `<path d="M62 70 L62 85 M96 70 L96 85 M130 70 L130 85 M164 70 L164 85" stroke="${OL}" stroke-width="4"/>` +
    `</g>` +
    `<path d="M28 154 Q28 132 48 130 L226 130 Q236 132 236 154 L236 196 Q236 200 228 200 L36 200 Q28 200 28 194 Z" fill="#BD221F" ${S}/>` +
    `<path d="M166 130 L166 96 Q166 88 176 88 L214 88 Q222 88 226 96 L232 130 Z" fill="#BD221F" ${S}/>` +
    `<rect x="176" y="98" width="42" height="26" rx="8" fill="#BBE3F5" ${S6}/>` +
    `<rect x="30" y="156" width="132" height="12" fill="#FEE301"/>` +
    at(74, 172, 0.62, flameSym()) +
    `<circle cx="230" cy="156" r="7" fill="#FEE301" ${S6}/>`,
)

// helicopter
const helicopter = wrap(
  `<rect x="52" y="212" width="156" height="9" rx="4.5" fill="#8A9299" ${S}/>` +
    `<path d="M96 184 L84 212 M168 184 L180 212" stroke="#8A9299" stroke-width="8" stroke-linecap="round"/>` +
    `<path d="M40 152 Q40 108 108 108 Q158 108 176 138 L232 150 Q238 152 233 161 L176 168 Q158 192 108 192 Q40 192 40 152 Z" fill="#E84C9C" ${S}/>` +
    `<path d="M46 150 Q46 120 90 120 Q112 120 118 150 Q112 174 80 174 Q49 174 46 150 Z" fill="#F5A623" ${S}/>` +
    `<path d="M226 150 L248 130 L249 152 Z" fill="#E84C9C" ${S6}/>` +
    `<rect x="121" y="84" width="14" height="28" rx="5" fill="#8A9299" ${S}/>` +
    `<rect x="42" y="78" width="172" height="12" rx="6" fill="#8A9299" ${S}/>` +
    `<circle cx="128" cy="84" r="9" fill="#8A9299" ${S6}/>`,
)

// bulldozer
const bulldozer = wrap(
  `<rect x="46" y="172" width="176" height="52" rx="26" fill="#2B2B2B" ${S}/>` +
    `<circle cx="80" cy="198" r="15" fill="#ABB7BD" ${S6}/>` +
    `<circle cx="134" cy="198" r="22" fill="#ABB7BD" ${S6}/>` +
    `<circle cx="188" cy="198" r="15" fill="#ABB7BD" ${S6}/>` +
    `<path d="M86 172 L86 122 Q86 110 98 110 L184 110 Q196 110 200 124 L212 172 Z" fill="#F5B700" ${S}/>` +
    `<rect x="150" y="120" width="46" height="38" rx="9" fill="#BBE3F5" ${S6}/>` +
    `<rect x="94" y="84" width="13" height="28" rx="5" fill="#3B3B3B" ${S6}/>` +
    `<path d="M42 128 Q24 130 24 150 L24 208 Q24 218 36 216 L54 210 L54 152 Q54 140 62 136 Z" fill="#ABB7BD" ${S}/>` +
    at(126, 142, 0.5, wrenchSym('#3B3B3B')),
)

// hovercraft
const hovercraft = wrap(
  `<path d="M0 206 Q24 216 48 206 Q72 196 96 206 Q120 216 144 206 Q168 196 192 206 Q216 216 240 206 Q250 202 256 205 L256 256 L0 256 Z" fill="#099EDA"/>` +
    `<path d="M0 206 Q24 216 48 206 Q72 196 96 206 Q120 216 144 206 Q168 196 192 206 Q216 216 240 206 Q250 202 256 205" fill="none" stroke="#BEE7FA" stroke-width="5" stroke-linecap="round"/>` +
    // puffy segmented skirt
    `<rect x="38" y="168" width="184" height="42" rx="21" fill="#4A4A4A" ${S}/>` +
    `<path d="M74 172 L70 208 M112 170 L112 210 M150 170 L150 210 M188 172 L192 208" stroke="${OL}" stroke-width="4" stroke-linecap="round"/>` +
    // hull
    `<path d="M48 170 Q56 118 128 118 Q200 118 208 170 Z" fill="#F5821F" ${S}/>` +
    `<path d="M90 130 Q128 120 166 130 L160 152 Q128 144 96 152 Z" fill="#BBE3F5" ${S6}/>` +
    at(94, 152, 0.6, anchorSym('#1D5FAD')) +
    // rear fan ring
    `<circle cx="200" cy="146" r="31" fill="#DDE2E6" ${S}/>` +
    at(200, 146, 1.7, propellerSym('#8A9299')),
)

// snowplow
const snowplow = wrap(
  `<path d="M2 214 Q30 202 60 210 Q56 236 56 236 L2 236 Z" fill="#FFFFFF"/>` +
    `<circle cx="30" cy="206" r="9" fill="#FFFFFF"/>` +
    `<circle cx="46" cy="220" r="7" fill="#FFFFFF"/>` +
    `<rect x="58" y="176" width="150" height="44" rx="22" fill="#2B2B2B" ${S}/>` +
    `<circle cx="90" cy="198" r="15" fill="#ABB7BD" ${S6}/>` +
    `<circle cx="176" cy="198" r="15" fill="#ABB7BD" ${S6}/>` +
    `<path d="M94 176 L94 106 Q94 94 106 94 L184 94 Q196 94 200 108 L208 176 Z" fill="#2AB6B0" ${S}/>` +
    `<rect x="110" y="106" width="52" height="38" rx="8" fill="#BBE3F5" ${S6}/>` +
    `<path d="M80 138 Q30 148 24 200 Q22 214 36 214 L60 208 L60 150 Q66 142 80 148 Z" fill="#F5821F" ${S}/>` +
    at(150, 128, 0.42, pineSym('#FFFFFF')),
)

// badge — rescue shield
const badge = wrap(
  `<path d="M128 32 L206 62 Q208 142 128 222 Q48 142 50 62 Z" fill="#ABB7BD" ${S}/>` +
    `<path d="M128 50 L188 73 Q190 136 128 200 Q66 136 68 73 Z" fill="#BD221F" ${S}/>` +
    at(128, 120, 1.75, pawSym('#FFFFFF', 0)),
)

// bone — offset-outline technique for a clean silhouette (no interior seams)
const bone = wrap(
  `<g fill="${OL}">` +
    `<rect x="60" y="106" width="136" height="44" rx="22"/>` +
    `<circle cx="70" cy="108" r="30"/><circle cx="70" cy="148" r="30"/>` +
    `<circle cx="186" cy="108" r="30"/><circle cx="186" cy="148" r="30"/>` +
    `</g>` +
    `<g fill="#F3E4C3">` +
    `<rect x="65" y="111" width="126" height="34" rx="17"/>` +
    `<circle cx="70" cy="110" r="25"/><circle cx="70" cy="146" r="25"/>` +
    `<circle cx="186" cy="110" r="25"/><circle cx="186" cy="146" r="25"/>` +
    `</g>` +
    `<circle cx="60" cy="122" r="4" fill="#E4CFA0"/>`,
)

// lookout-tower
const lookoutTower = wrap(
  `<path d="M0 216 Q64 198 128 208 Q196 216 256 202 L256 256 L0 256 Z" fill="#7BC67E"/>` +
    // slide
    `<path d="M162 108 Q216 122 198 162 Q184 200 216 212" fill="none" stroke="${OL}" stroke-width="22" stroke-linecap="round"/>` +
    `<path d="M162 108 Q216 122 198 162 Q184 200 216 212" fill="none" stroke="#F5B700" stroke-width="14" stroke-linecap="round"/>` +
    // tower shaft (tapered)
    `<path d="M104 100 L92 214 L164 214 L152 100 Z" fill="#E8ECEF" ${S}/>` +
    `<rect x="116" y="150" width="24" height="44" rx="11" fill="#099EDA" ${S6}/>` +
    // saucer deck
    `<path d="M72 98 Q72 78 128 78 Q184 78 184 98 Q184 110 128 112 Q72 110 72 98 Z" fill="#E8ECEF" ${S}/>` +
    `<circle cx="102" cy="95" r="6.5" fill="#099EDA" ${S6}/>` +
    `<circle cx="128" cy="96" r="6.5" fill="#099EDA" ${S6}/>` +
    `<circle cx="154" cy="95" r="6.5" fill="#099EDA" ${S6}/>` +
    // dome roof
    `<path d="M92 78 Q92 48 128 48 Q164 48 164 78 Z" fill="#CFD6DB" ${S}/>` +
    `<rect x="123" y="30" width="10" height="20" rx="4" fill="#8A9299" ${S6}/>` +
    `<circle cx="128" cy="28" r="8" fill="#BD221F" ${S6}/>`,
)

export const CARD_SUBJECTS: readonly ArtSubject[] = [
  { key: 'chase', label: 'Police puppy', blob: '#D6E6FA', svg: chase },
  { key: 'marshall', label: 'Fire puppy', blob: '#FBD9D7', svg: marshall },
  { key: 'skye', label: 'Flying puppy', blob: '#FBDCEC', svg: skye },
  { key: 'rubble', label: 'Construction puppy', blob: '#FDEFC9', svg: rubble },
  { key: 'rocky', label: 'Recycling puppy', blob: '#D9F0DB', svg: rocky },
  { key: 'zuma', label: 'Water puppy', blob: '#FCE3CC', svg: zuma },
  { key: 'everest', label: 'Snow puppy', blob: '#D2EFEE', svg: everest },
  { key: 'police-truck', label: 'Police truck', blob: '#D6E6FA', svg: policeTruck },
  { key: 'fire-truck', label: 'Fire truck', blob: '#FBD9D7', svg: fireTruck },
  { key: 'helicopter', label: 'Pink helicopter', blob: '#FBDCEC', svg: helicopter },
  { key: 'bulldozer', label: 'Yellow bulldozer', blob: '#FDEFC9', svg: bulldozer },
  { key: 'hovercraft', label: 'Orange hovercraft', blob: '#FCE3CC', svg: hovercraft },
  { key: 'snowplow', label: 'Snowplow', blob: '#D2EFEE', svg: snowplow },
  { key: 'badge', label: 'Rescue badge', blob: '#FDEFC9', svg: badge },
  { key: 'bone', label: 'Puppy bone', blob: '#FBEEDC', svg: bone },
  { key: 'lookout-tower', label: 'Lookout tower', blob: '#D6E6FA', svg: lookoutTower },
]

export const PAW_PRINT: ArtSubject = {
  key: 'paw-print',
  label: 'Paw print',
  blob: '#FFFFFF',
  svg: wrap(at(128, 113, 3.1, pawSym('#FFFFFF', 0))),
}

export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
}
