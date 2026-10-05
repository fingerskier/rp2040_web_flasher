import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('deployment assets and supported runtime', () => {
  it('ships a small, high-DPI header logo instead of the full-size source image', () => {
    const path = new URL('../src/assets/logo.png', import.meta.url)
    const png = readFileSync(path)
    expect(statSync(path).size).toBeLessThan(30_000)
    expect(png.readUInt32BE(20)).toBe(96)
  })

  it('resolves manifest icons inside the deployed project subdirectory', () => {
    const manifest = JSON.parse(read('public/site.webmanifest'))
    expect(manifest.name).toBe('RP2040 MicroPython Flasher')
    for (const icon of manifest.icons) {
      expect(new URL(icon.src, 'https://example.com/rp2040_web_flasher/site.webmanifest').pathname)
        .toMatch(/^\/rp2040_web_flasher\//)
    }
  })

  it('advertises only MicroPython and supplies a self-hosted production CSP', () => {
    const html = read('index.html')
    expect(html).toContain('MicroPython')
    expect(html).toContain('http-equiv="Content-Security-Policy"')
    expect(html).toContain("object-src 'none'")
    expect(html).toContain("base-uri 'self'")
    expect(read('README.md')).not.toMatch(/running MicroPython or CircuitPython/)
  })
})
