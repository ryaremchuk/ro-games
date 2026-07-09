/**
 * Tiny typed pub/sub between the Phaser scene (which owns the level draft and
 * all editing behaviour) and the React `EditorPanel` overlay (which is just
 * buttons). No React state per frame: the scene emits a coarse snapshot only
 * when something editorial changes (selection, add/delete, mode, import…).
 *
 * The scene registers its `EditorApi` on create and unregisters on shutdown;
 * the panel may mount before the scene boots, so it renders a waiting state
 * until the registration emit arrives.
 */

export type EditorMode = 'edit' | 'play'
export type AddKind = 'wood' | 'stone' | 'ice' | 'piggy' | 'ball' | 'trampoline' | 'seesaw'
export type SelectionKind = 'block' | 'piggy' | 'ball' | 'trampoline' | 'seesaw'

export interface EditorSnapshot {
  mode: EditorMode
  level: number
  /** `hasReachablePiggy(draft)` — at least one piggy inside the launch envelope. */
  reachable: boolean
  blocks: number
  piggies: number
  props: number
  selection: SelectionKind | null
}

/** Commands the panel sends to the scene. */
export interface EditorApi {
  snapshot(): EditorSnapshot
  exportJson(): string
  /** Returns an error message, or null when the JSON was applied. */
  importJson(json: string): string | null
  /** Discard the draft and re-seed it from the generator at `level`. */
  regenerate(level: number): void
  setMode(mode: EditorMode): void
  add(kind: AddKind): void
  deleteSelected(): void
  rotateSelected(degrees: number): void
}

type Listener = (snap: EditorSnapshot) => void

let api: EditorApi | null = null
const listeners = new Set<Listener>()

export function registerEditorApi(next: EditorApi | null): void {
  api = next
  if (next) emitEditorChange()
}

export function getEditorApi(): EditorApi | null {
  return api
}

export function subscribeEditor(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Scene calls this after every editorial change; panel re-renders from it. */
export function emitEditorChange(): void {
  if (!api) return
  const snap = api.snapshot()
  for (const fn of listeners) fn(snap)
}

/** Is the current URL asking for the hidden editor? (`#/slingshot?edit`) */
export function editRequested(): boolean {
  const query = location.hash.split('?')[1] ?? ''
  return new URLSearchParams(query).has('edit')
}
