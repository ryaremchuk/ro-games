/** Thin wrapper so tests can mock a full page reload (jsdom can't). */
export function reloadPage() {
  window.location.reload()
}
