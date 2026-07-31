import '@testing-library/jest-dom/vitest'

// --- Deterministic Web Storage for the jsdom test environment ---------------
// Node ships an experimental global Web Storage API (`localStorage` /
// `sessionStorage`). It is flagged off on the Node 24 that `.nvmrc` pins and
// CI runs, so there jsdom's own Storage backs a bare `localStorage`. But from
// Node 25 it is unflagged and on by default: a bare `localStorage` reference
// resolves to Node's implementation, which — with no `--localstorage-file` — is
// an inert object whose `.clear()`/`.getItem()` are missing. Our stores and
// their tests then die on `localStorage.clear is not a function`, so the suite
// passes on CI yet fails locally on a newer Node.
//
// Install a small in-memory Storage on the test globals so every localStorage-
// backed test behaves identically on any Node version. jsdom's own Storage is
// likewise per-realm in-memory, so this loses no fidelity for our stores (which
// only use get/set/remove/clear and already fall back to memory on failure).
class MemoryStorage {
  private map = new Map<string, string>()
  get length(): number {
    return this.map.size
  }
  clear(): void {
    this.map.clear()
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  setItem(key: string, value: string): void {
    this.map.set(String(key), String(value))
  }
}

function installStorage(name: 'localStorage' | 'sessionStorage'): void {
  const value = new MemoryStorage() as unknown as Storage
  const win = (globalThis as { window?: object }).window
  for (const target of win && win !== globalThis ? [globalThis, win] : [globalThis]) {
    Object.defineProperty(target, name, { configurable: true, writable: true, value })
  }
}

installStorage('localStorage')
installStorage('sessionStorage')
