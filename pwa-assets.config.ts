import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Generates favicon + PWA + Apple touch icons from a single source SVG.
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: minimal2023Preset,
  images: ['public/logo.svg'],
})
