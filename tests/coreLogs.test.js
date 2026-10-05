import { describe, it, expect, vi } from 'vitest'
import { createLogStore } from '../src/lib/logStore.js'

describe('bounded log store', () => {
  it('bounds huge partial chunks and complete lines, publishing once per batch', async () => {
    const store = createLogStore({ maxChars: 20, maxLines: 3 })
    const listener = vi.fn()
    store.subscribe(listener)
    store.append('x'.repeat(10000))
    store.append('\na\nb\nc\nprompt')
    expect(listener).not.toHaveBeenCalled()
    await new Promise(resolve => setTimeout(resolve, 25))
    const { logs, partial } = store.getSnapshot()
    expect(logs.length + (partial ? 1 : 0)).toBeLessThanOrEqual(3)
    expect(logs.join('\n').length + partial.length).toBeLessThanOrEqual(20)
    expect(partial).toBe('prompt')
    expect(listener).toHaveBeenCalledTimes(1)
    store.clearLogs()
    expect(store.getSnapshot()).toMatchObject({ logs: [], partial: '' })
  })
})
