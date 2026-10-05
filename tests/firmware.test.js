import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyUF2 } from '../src/lib/firmware.js'

function firmware({ blocks = 2, name = 'MicroPython.UF2', mutate } = {}) {
  const bytes = new Uint8Array(blocks * 512)
  for (let block = 0; block < blocks; block++) {
    const view = new DataView(bytes.buffer, block * 512, 512)
    const fields = [0x0a324655, 0x9e5d5157, 0x2000, 0x10000000 + block * 256,
      256, block, blocks, 0xe48bff56]
    fields.forEach((value, index) => view.setUint32(index * 4, value, true))
    bytes.fill(block % 256, block * 512 + 32, block * 512 + 288)
    view.setUint32(508, 0x0ab16f30, true)
    mutate?.(view, block)
  }
  return Object.assign(new Blob([bytes]), { name })
}

function destination(info = 'UF2 Bootloader v3.0\nModel: Raspberry Pi RP2\nBoard-ID: RPI-RP2\n') {
  const chunks = []
  const writable = {
    write: vi.fn(async chunk => { chunks.push(new Uint8Array(await chunk.arrayBuffer())) }),
    close: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  }
  const createWritable = vi.fn(async () => writable)
  const getFileHandle = vi.fn(async (name, options) => {
    if (name === 'INFO_UF2.TXT' && !options?.create) {
      return { getFile: async () => new Blob([info]) }
    }
    return { createWritable }
  })
  const showDirectoryPicker = vi.fn(async () => ({ getFileHandle }))
  return { chunks, writable, createWritable, getFileHandle, showDirectoryPicker }
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function flushIO() {
  for (let i = 0; i < 80; i++) await Promise.resolve()
}

describe('native I/O cancellation', () => {
  it.each(['arrayBuffer', 'info handle', 'getFile', 'text', 'file handle', 'createWritable', 'write', 'close'])('bounds pending %s on cancellation and deadline', async stage => {
    vi.useFakeTimers()
    for (const cancel of [true, false]) {
      const target = destination()
      const file = firmware()
      const pending = deferred()
      const controller = new AbortController()
      if (stage === 'arrayBuffer') vi.spyOn(file, 'slice').mockReturnValue({ arrayBuffer: () => pending.promise })
      if (stage === 'info handle') target.getFileHandle.mockReturnValueOnce(pending.promise)
      if (stage === 'getFile') target.getFileHandle.mockResolvedValueOnce({ getFile: () => pending.promise })
      if (stage === 'text') target.getFileHandle.mockResolvedValueOnce({ getFile: async () => ({ size: 20, text: () => pending.promise }) })
      if (stage === 'file handle') {
        const original = target.getFileHandle.getMockImplementation()
        target.getFileHandle.mockImplementation((name, options) => options.create ? pending.promise : original(name, options))
      }
      if (stage === 'createWritable') target.createWritable.mockReturnValue(pending.promise)
      if (stage === 'write' || stage === 'close') target.writable[stage].mockReturnValue(pending.promise)
      const progress = vi.fn()
      const outcome = copyUF2(file, { ...target, signal: controller.signal, onProgress: progress, ioTimeoutMs: 20, cleanupTimeoutMs: 10 })
        .then(value => ({ value }), error => ({ error }))
      await flushIO()
      if (cancel) controller.abort()
      await vi.advanceTimersByTimeAsync(31)
      const { error } = await outcome
      expect(error).toBeInstanceOf(Error)
      expect(error.requiresReload).toBe(true)
      expect(error.message).toMatch(/reload before retrying/)
      if (!cancel) expect(error.message).toMatch(/timed out/)
      const calls = progress.mock.calls.length
      // Late native rejections must be consumed, not restart the copy or leak.
      pending.reject(new Error('Late native failure'))
      await flushIO()
      expect(progress).toHaveBeenCalledTimes(calls)
      if (stage !== 'close') expect(target.writable.close).not.toHaveBeenCalled()
    }
  })

  it.each(['resolve', 'reject'])('cancels an unresolved picker without timing out the user chooser (late %s)', async settlement => {
    vi.useFakeTimers()
    const target = destination()
    const pending = deferred()
    target.showDirectoryPicker.mockReturnValue(pending.promise)
    const controller = new AbortController()
    const done = vi.fn()
    const outcome = copyUF2(firmware(), { ...target, signal: controller.signal, ioTimeoutMs: 10 }).then(done)
    expect(target.showDirectoryPicker).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(100000)
    expect(done).not.toHaveBeenCalled()
    controller.abort()
    await outcome
    expect(done).toHaveBeenCalledWith({ status: 'cancelled' })
    pending[settlement](settlement === 'resolve' ? { getFileHandle: target.getFileHandle } : new Error('Late picker failure'))
    await flushIO()
    expect(target.getFileHandle).not.toHaveBeenCalled()
  })

  it.each([false, true])('cleans up a late-acquired writable, after cleanup deadline: %s', async late => {
    vi.useFakeTimers()
    const target = destination()
    const pending = deferred()
    target.createWritable.mockReturnValue(pending.promise)
    const controller = new AbortController()
    const outcome = copyUF2(firmware(), { ...target, signal: controller.signal, cleanupTimeoutMs: 10 })
      .then(value => ({ value }), error => ({ error }))
    await flushIO()
    expect(target.createWritable).toHaveBeenCalledOnce()
    controller.abort()
    await flushIO()
    if (late) await vi.advanceTimersByTimeAsync(11)
    pending.resolve(target.writable)
    await flushIO()
    const result = await outcome
    if (late) expect(result.error.requiresReload).toBe(true)
    else expect(result.value).toEqual({ status: 'cancelled' })
    expect(target.writable.abort).toHaveBeenCalledOnce()
    expect(target.writable.write).not.toHaveBeenCalled()
    expect(target.writable.close).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['pending', 'rejected'])('requires reload when abort is %s instead of claiming safe cancellation', async mode => {
    vi.useFakeTimers()
    const target = destination()
    const pending = deferred()
    target.writable.abort.mockImplementation(() => mode === 'pending' ? pending.promise : Promise.reject(new Error('Abort failed')))
    const controller = new AbortController()
    const outcome = copyUF2(firmware(), { ...target, signal: controller.signal, cleanupTimeoutMs: 10, onProgress: () => controller.abort() })
      .then(value => ({ value }), error => ({ error }))
    await flushIO()
    await vi.advanceTimersByTimeAsync(11)
    const { error } = await outcome
    expect(error.requiresReload).toBe(true)
    expect(error.message).toMatch(/reload before retrying/)
    expect(target.writable.abort).toHaveBeenCalledOnce()
    expect(target.writable.write).not.toHaveBeenCalled()
    pending.reject(new Error('Late abort failure'))
    // For the rejected mode the deferred promise was never returned to the helper.
    if (mode === 'rejected') pending.promise.catch(() => {})
    await flushIO()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['info handle', 'createWritable', 'write'])('does not turn a noncancel AbortError at %s into user cancellation', async stage => {
    const target = destination()
    const error = Object.assign(new Error('Native failure'), { name: 'AbortError' })
    if (stage === 'info handle') target.getFileHandle.mockRejectedValueOnce(error)
    if (stage === 'createWritable') target.createWritable.mockRejectedValueOnce(error)
    if (stage === 'write') target.writable.write.mockRejectedValueOnce(error)
    await expect(copyUF2(firmware(), target)).rejects.toBe(error)
  })

  it('reports safe cancellation only after abort settles the outstanding write', async () => {
    vi.useFakeTimers()
    const target = destination()
    const pending = deferred()
    target.writable.write.mockReturnValue(pending.promise)
    target.writable.abort.mockImplementation(async () => { pending.reject(new Error('Write stopped')) })
    const controller = new AbortController()
    const outcome = copyUF2(firmware(), { ...target, signal: controller.signal, cleanupTimeoutMs: 10 })
    await flushIO()
    controller.abort()
    await expect(outcome).resolves.toEqual({ status: 'cancelled' })
    expect(target.writable.abort).toHaveBeenCalledOnce()
    expect(target.writable.close).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds cancellation of a permanently pending write and attempts abort independently', async () => {
    vi.useFakeTimers()
    const target = destination()
    const pending = deferred()
    target.writable.write.mockReturnValue(pending.promise)
    const controller = new AbortController()
    const outcome = copyUF2(firmware(), { ...target, signal: controller.signal, cleanupTimeoutMs: 10 })
      .then(value => ({ value }), error => ({ error }))
    await flushIO()
    expect(target.writable.write).toHaveBeenCalledOnce()
    controller.abort()
    await vi.advanceTimersByTimeAsync(11)
    expect(target.writable.abort).toHaveBeenCalledOnce()
    const { error } = await outcome
    expect(error).toBeInstanceOf(Error)
    expect(error.requiresReload).toBe(true)
    expect(error.message).toMatch(/reload before retrying/)
    expect(target.writable.close).not.toHaveBeenCalled()
    pending.resolve()
    await flushIO()
    expect(target.writable.close).not.toHaveBeenCalled()
  })
})

describe('copyUF2', () => {
  it('does not open the picker when already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const target = destination()
    await expect(copyUF2(firmware(), { ...target, signal: controller.signal })).resolves.toEqual({ status: 'cancelled' })
    expect(target.showDirectoryPicker).not.toHaveBeenCalled()
  })

  it.each(['picker', 'validation', 'info handle', 'info file', 'info text', 'file handle', 'writable', 'progress', 'write', 'close'])('cancels during %s without reporting success or continuing writes', async stage => {
    const controller = new AbortController()
    const target = destination()
    const file = firmware({ blocks: 257 })
    const cancelAfter = object => async (...args) => {
      const result = await object(...args)
      controller.abort()
      return result
    }
    let onProgress
    if (stage === 'picker') target.showDirectoryPicker.mockImplementationOnce(cancelAfter(target.showDirectoryPicker.getMockImplementation()))
    if (stage === 'validation') {
      const originalSlice = file.slice.bind(file)
      vi.spyOn(file, 'slice').mockImplementationOnce((start, end) => {
        const chunk = originalSlice(start, end)
        chunk.arrayBuffer = cancelAfter(chunk.arrayBuffer.bind(chunk))
        return chunk
      })
    }
    if (['info handle', 'file handle'].includes(stage)) {
      const original = target.getFileHandle.getMockImplementation()
      target.getFileHandle.mockImplementation(async (...args) => {
        const handle = await original(...args)
        if ((stage === 'info handle') === (args[0] === 'INFO_UF2.TXT')) controller.abort()
        return handle
      })
    }
    if (['info file', 'info text'].includes(stage)) {
      target.getFileHandle.mockResolvedValueOnce({ getFile: async () => {
        if (stage === 'info file') controller.abort()
        const info = new Blob(['Board-ID: RPI-RP2\n'])
        if (stage === 'info text') info.text = cancelAfter(info.text.bind(info))
        return info
      } })
    }
    if (stage === 'writable') target.createWritable.mockImplementationOnce(cancelAfter(target.createWritable.getMockImplementation()))
    if (stage === 'progress') onProgress = () => controller.abort()
    if (stage === 'write' || stage === 'close') target.writable[stage].mockImplementationOnce(cancelAfter(target.writable[stage].getMockImplementation()))
    await expect(copyUF2(file, { ...target, onProgress, signal: controller.signal })).resolves.toEqual({ status: 'cancelled' })
    if (['writable', 'progress', 'write', 'close'].includes(stage)) {
      expect(target.writable.abort).toHaveBeenCalledOnce()
      if (stage !== 'close') expect(target.writable.close).not.toHaveBeenCalled()
      if (stage === 'write') expect(target.writable.write).toHaveBeenCalledOnce()
    } else {
      expect(target.createWritable).not.toHaveBeenCalled()
    }
  })

  it.each(['write', 'close'])('aborts the writable on %s failure without masking the original error', async method => {
    const target = destination()
    const original = Object.assign(new Error('Device disconnected'), { name: 'AbortError' })
    target.writable[method].mockRejectedValue(original)
    target.writable.abort.mockRejectedValue(new Error('Already disconnected'))
    await expect(copyUF2(firmware(), target)).rejects.toBe(original)
    expect(target.writable.abort).toHaveBeenCalledOnce()
    if (method === 'write') expect(target.writable.close).not.toHaveBeenCalled()
  })

  it('aborts if the progress callback throws', async () => {
    const target = destination()
    const original = new Error('Consumer failure')
    await expect(copyUF2(firmware(), { ...target, onProgress: () => { throw original } })).rejects.toBe(original)
    expect(target.writable.abort).toHaveBeenCalledOnce()
  })

  it('preserves createWritable permission failure', async () => {
    const target = destination()
    const error = Object.assign(new Error('No write permission'), { name: 'NotAllowedError' })
    target.createWritable.mockRejectedValue(error)
    await expect(copyUF2(firmware(), target)).rejects.toBe(error)
    expect(target.writable.abort).not.toHaveBeenCalled()
  })

  it('uses the browser picker with its window receiver by default', async () => {
    const target = destination()
    const browser = { showDirectoryPicker: vi.fn(function (options) {
      expect(this).toBe(browser)
      return target.showDirectoryPicker(options)
    }) }
    vi.stubGlobal('window', browser)
    const copying = copyUF2(firmware())
    expect(browser.showDirectoryPicker).toHaveBeenCalledWith({ mode: 'readwrite' })
    await expect(copying).resolves.toMatchObject({ status: 'success' })
  })

  it('reports a capability error without requiring browser globals', async () => {
    vi.stubGlobal('window', undefined)
    await expect(copyUF2(firmware())).rejects.toThrow(/not supported|unavailable/i)
  })

  it('returns cancelled only for picker cancellation, not permission or other picker errors', async () => {
    for (const name of ['AbortError', 'NotAllowedError', 'TypeError']) {
      const error = Object.assign(new Error(name), { name })
      const picker = vi.fn().mockRejectedValue(error)
      const copying = copyUF2(firmware(), { showDirectoryPicker: picker })
      if (name === 'AbortError') await expect(copying).resolves.toEqual({ status: 'cancelled' })
      else await expect(copying).rejects.toBe(error)
      expect(picker).toHaveBeenCalledOnce()
    }
  })

  it('validates and copies in bounded chunks without calling the file arrayBuffer', async () => {
    const file = firmware({ blocks: 1025 })
    const expected = await file.arrayBuffer()
    const wholeRead = vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('Whole file read forbidden'))
    const slice = vi.spyOn(file, 'slice')
    const progress = vi.fn()
    const target = destination()
    await copyUF2(file, { ...target, onProgress: progress })
    expect(wholeRead).not.toHaveBeenCalled()
    expect(slice.mock.calls.every(([start, end]) => end - start <= 65536)).toBe(true)
    expect(target.writable.write.mock.calls.length).toBeGreaterThan(1)
    expect(target.writable.write.mock.calls.every(([chunk]) => chunk.size <= 65536)).toBe(true)
    expect(await new Blob(target.chunks).arrayBuffer()).toEqual(expected)
    expect(progress.mock.calls[0]).toEqual([0, file.size])
    let previous = -1
    for (const [completed, total] of progress.mock.calls) {
      expect(total).toBe(file.size)
      expect(completed).toBeGreaterThan(previous)
      previous = completed
    }
    expect(previous).toBe(file.size)
  })

  it.each(['', 'ordinary directory', 'Board-ID: RPI-RP2350\n', 'Board-ID: SAMD21\nRP2040 elsewhere', 'Board-ID: RP20400\n'])('rejects a destination without an RP2040 board identity (%s)', async info => {
    const target = destination(info)
    await expect(copyUF2(firmware(), target)).rejects.toThrow(/RP2040|INFO_UF2/)
    expect(target.getFileHandle.mock.calls.some(([, options]) => options?.create)).toBe(false)
  })

  it('reads the RP2040 bootloader identity before creating firmware', async () => {
    const target = destination('UF2 Bootloader\nBoard-ID: RP2040-Pico-v1\n')
    await copyUF2(firmware(), target)
    expect(target.getFileHandle.mock.calls[0]).toEqual(['INFO_UF2.TXT', { create: false }])
    expect(target.getFileHandle.mock.calls[1]).toEqual(['MicroPython.UF2', { create: true }])
  })

  it('does not hide missing INFO_UF2 or destination permission errors', async () => {
    for (const name of ['NotFoundError', 'NotAllowedError']) {
      const target = destination()
      const error = Object.assign(new Error('Cannot read bootloader identity'), { name })
      target.getFileHandle.mockRejectedValue(error)
      await expect(copyUF2(firmware(), target)).rejects.toBe(error)
      expect(target.createWritable).not.toHaveBeenCalled()
    }
  })

  it('rejects an oversized INFO_UF2 file without reading the whole file', async () => {
    const target = destination()
    const text = vi.fn()
    target.getFileHandle.mockResolvedValueOnce({ getFile: async () => ({ size: 65537, text }) })
    await expect(copyUF2(firmware(), target)).rejects.toThrow(/INFO_UF2/)
    expect(text).not.toHaveBeenCalled()
    expect(target.createWritable).not.toHaveBeenCalled()
  })

  it.each([
    ['extension', () => firmware({ name: 'firmware.bin' })],
    ['empty', () => Object.assign(new Blob([]), { name: 'empty.uf2' })],
    ['partial block', () => Object.assign(new Blob([new Uint8Array(513)]), { name: 'bad.uf2' })],
    ['slash', () => firmware({ name: '../firmware.uf2' })],
    ['backslash', () => firmware({ name: 'folder\\firmware.uf2' })],
    ...[
      ['first magic', 0, 0], ['second magic', 4, 0], ['end magic', 508, 0],
      ['missing family flag', 8, 0], ['container flag', 8, 0x3000],
      ['non-flash flag', 8, 0x2001], ['unknown flag', 8, 0x22000],
      ['family', 28, 0xe48bff59], ['payload zero', 16, 0],
      ['payload excessive', 16, 480], ['payload unaligned', 16, 255],
      ['payload incompatible', 16, 128], ['number', 20, 9],
      ['duplicate number', 20, 0], ['count zero', 24, 0], ['count mismatch', 24, 3],
      ['RAM address', 12, 0x20000000], ['low address', 12, 0x0fffff00],
      ['unaligned address', 12, 0x10000001], ['past flash', 12, 0x11000000],
      ['overlapping addresses', 12, 0x10000000],
    ].map(([name, offset, value]) => [name, () => firmware({ mutate: (view, block) => {
      if (block === 1) view.setUint32(offset, value, true)
    } })]),
  ])('rejects invalid %s before any destination creation', async (_name, makeFile) => {
    const target = destination()
    await expect(copyUF2(makeFile(), target)).rejects.toThrow(/UF2|firmware/i)
    expect(target.getFileHandle.mock.calls.some(([, options]) => options?.create)).toBe(false)
  })

  it('invokes the picker synchronously and copies original bytes/name with progress', async () => {
    const file = firmware()
    const target = destination()
    const progress = vi.fn()
    const copying = copyUF2(file, { showDirectoryPicker: target.showDirectoryPicker, onProgress: progress })
    expect(target.showDirectoryPicker).toHaveBeenCalledWith({ mode: 'readwrite' })
    await expect(copying).resolves.toEqual({ status: 'success', name: file.name, bytes: file.size })
    expect(target.getFileHandle).toHaveBeenCalledWith(file.name, { create: true })
    expect(await new Blob(target.chunks).arrayBuffer()).toEqual(await file.arrayBuffer())
    expect(target.writable.close).toHaveBeenCalledOnce()
    expect(progress).toHaveBeenLastCalledWith(file.size, file.size)
  })
})
