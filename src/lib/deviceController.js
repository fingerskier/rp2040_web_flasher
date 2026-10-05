import { createLogStore } from './logStore.js'
import { beginMicroPython, uploadMicroPython } from './micropython.js'
import { openSerial, openUsb } from './deviceTransports.js'

export const abortError = () => new DOMException('Operation cancelled; reconnect before retrying.', 'AbortError')
export function bounded(promise, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => finish(reject, abortError())
    const timer = setTimeout(() => finish(reject, Object.assign(new Error('Device operation timed out'), { code: 'DEVICE_TIMEOUT' })), timeoutMs)
    function finish(fn, value) { clearTimeout(timer); signal?.removeEventListener('abort', aborted); fn(value) }
    signal?.addEventListener('abort', aborted, { once: true })
    if (signal?.aborted) aborted()
    Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error))
  })
}

export function createDeviceController({ timeoutMs = 5000, cleanupMs = 3000, logs = createLogStore(), browser = globalThis.navigator, copyFirmware } = {}) {
  let session = null
  let teardown = null
  let connecting = null
  let copying = null
  let reloadError = null
  let tail = Promise.resolve()
  let state = { isConnected: false, isConnecting: false, isDisconnecting: false, isBusy: false, error: null, operation: null, transport: null }
  const listeners = new Set()
  const update = patch => { state = { ...state, ...patch, ...(reloadError ? { isBusy: true, operation: null, error: reloadError } : {}) }; listeners.forEach(fn => fn()) }
  function assert(s) { if (!s || session !== s || s.abort.signal.aborted) throw abortError() }
  async function cleanup(s) {
    if (s.cleanup) return s.cleanup
    s.removeDisconnect?.()
    s.abort.abort()
    s.cleanup = (async () => {
      const errors = []
      for (const fn of [() => s.io.cancel?.(), () => s.io.close?.(), () => s.loop]) {
        try { await bounded(Promise.resolve().then(fn), cleanupMs) } catch (error) { errors.push(error) }
      }
      return errors
    })()
    return s.cleanup
  }
  async function disconnect(error = null) {
    const setup = connecting
    setup?.abort()
    connecting = null
    const copy = copying
    copy?.abort()
    copying = null
    const s = session
    if (!s && teardown) return teardown
    session = null
    tail = Promise.resolve()
    update({ isConnected: false, isConnecting: false, isDisconnecting: !!(s || copy || setup), isBusy: false, operation: null, transport: null, error })
    if (s || copy || setup) {
      teardown = (async () => {
        if (s) await cleanup(s)
        for (const operation of [copy, setup]) {
          if (!operation) continue
          try { await bounded(operation.work, cleanupMs) } catch { /* Original caller receives the operation error. */ }
        }
      })().finally(() => {
        teardown = null
        if (!session) update({ isDisconnecting: false })
      })
      await teardown
    }
  }
  function readFailed(s, error) {
    if (session !== s) return
    if (s.expectReset) { s.readError = Object.assign(error, { code: 'DEVICE_DISCONNECTED' }); s.waiting?.() }
    else void disconnect(error)
  }
  async function connectTransport(io) {
    if (reloadError) throw reloadError
    if (session || state.isDisconnecting) throw new Error('Disconnect the current device first')
    const s = { io, abort: new AbortController(), decoder: new TextDecoder(), buffer: '', waiting: null, pending: 0 }
    session = s
    const events = browser?.[io.type]
    const unplug = event => {
      if (session === s && (event.device === io.device || event.port === io.device || event.target === io.device)) readFailed(s, new Error('Device unplugged'))
    }
    events?.addEventListener?.('disconnect', unplug)
    s.removeDisconnect = () => events?.removeEventListener?.('disconnect', unplug)
    logs.clearLogs()
    update({ isConnected: true, transport: { type: io.type }, error: null })
    s.loop = (async () => {
      try {
        while (!s.abort.signal.aborted) {
          const { value, done } = await io.read()
          if (session !== s || s.abort.signal.aborted) break
          if (done) throw new Error('Device disconnected (end of stream)')
          const text = s.decoder.decode(value, { stream: true })
          logs.append(text)
          if (s.protocol) {
            s.buffer += text
            if (s.buffer.length > 65_536) throw new Error('Device response exceeded limit')
            s.waiting?.()
          }
        }
      } catch (error) {
        // Do not await disconnect here: cleanup waits for this very loop.
        readFailed(s, error)
      }
    })()
  }
  async function connect(open, options) {
    if (reloadError) throw reloadError
    if (session || connecting || copying || state.isDisconnecting) throw new Error('A device operation is already active')
    const token = new AbortController()
    connecting = token
    update({ isConnecting: true, error: null })
    try {
      token.work = open(browser, { ...options, timeoutMs }, token.signal)
      const io = await token.work
      if (connecting !== token || token.signal.aborted) { await io.close(); throw abortError() }
      await connectTransport(io)
      return io.device
    } catch (error) {
      if (connecting === token) update({ error })
      throw error
    } finally {
      if (connecting === token) { connecting = null; update({ isConnecting: false }) }
    }
  }
  function copyUF2(file) {
    if (reloadError) return Promise.reject(reloadError)
    if (state.isBusy || connecting || copying || state.isDisconnecting) return Promise.reject(new Error('A device operation is already active'))
    if (!copyFirmware) return Promise.reject(new Error('Firmware copy is unavailable'))
    const token = new AbortController()
    copying = token
    update({ isBusy: true, error: null, operation: { label: 'Copying firmware', completed: 0, total: file.size } })
    let work
    try {
      // Deliberately invoke before ANY await/microtask to preserve picker activation.
      work = copyFirmware(file, { signal: token.signal, onProgress: (completed, total) => {
        if (copying === token) update({ operation: { label: 'Copying firmware', completed, total } })
      } })
    } catch (error) { work = Promise.reject(error) }
    token.work = Promise.resolve(work).catch(error => {
      if (error.requiresReload === true) { reloadError = error; update({}) }
      if (copying === token) update({ error })
      throw error
    }).finally(() => {
      if (copying === token) { copying = null; update({ isBusy: false, operation: null }) }
    })
    return token.work
  }
  function enqueue(label, fn) {
    if (reloadError) return Promise.reject(reloadError)
    if (copying) return Promise.reject(new Error('Firmware copy is active'))
    const s = session
    if (!s) return Promise.reject(new Error('Not connected to a device'))
    s.pending++
    update({ isBusy: true })
    const run = tail.then(async () => {
      assert(s)
      if (reloadError) throw reloadError
      update({ isBusy: true, error: null, operation: { label, completed: 0, total: 0 } })
      try { return await fn(s) }
      catch (error) { if (session === s) await disconnect(error); throw error }
      finally { s.pending--; if (session === s) update({ isBusy: s.pending > 0, operation: null }) }
    })
    tail = run.catch(() => {})
    return run
  }
  async function write(s, data) {
    assert(s)
    await bounded(s.io.write(typeof data === 'string' ? new TextEncoder().encode(data) : data), timeoutMs, s.abort.signal)
    assert(s)
  }
  async function take(s, token) {
    assert(s)
    try {
      return await bounded(new Promise((resolve, reject) => {
        s.waiting = () => {
          const index = s.buffer.indexOf(token)
          if (index < 0) {
            if (s.readError) { s.waiting = null; reject(s.readError) }
            return
          }
          const value = s.buffer.slice(0, index)
          s.buffer = s.buffer.slice(index + token.length)
          // Buffered reads can arrive before the async finally runs.
          s.waiting = null
          resolve(value)
        }
        s.waiting()
      }), timeoutMs, s.abort.signal)
    } catch (error) { error.partial = s.buffer; throw error }
    finally { s.waiting = null }
  }
  const uploadFile = file => enqueue('Uploading file', async s => {
    s.protocol = true
    s.buffer = ''
    try {
      return await uploadMicroPython(file, {
        write: data => write(s, data), take: token => take(s, token), check: () => assert(s),
        wait: promise => bounded(promise, timeoutMs, s.abort.signal),
        progress: (completed, total) => { assert(s); update({ operation: { label: 'Uploading file', completed, total } }) },
      })
    } finally { s.protocol = false; s.buffer = ''; s.waiting = null }
  })
  const protocol = (label, fn) => enqueue(label, async s => {
    s.protocol = true
    s.buffer = ''
    try {
      const repl = await beginMicroPython({ write: data => write(s, data), take: token => take(s, token), wait: promise => bounded(promise, timeoutMs, s.abort.signal) })
      return await fn(repl, s)
    } finally { s.protocol = false; s.buffer = ''; s.waiting = null }
  })
  // Public raw input is Python source, never transport control bytes.
  const sendRaw = source => protocol('Sending command', async repl => {
    if (typeof source !== 'string' || [...source].some(char => { const code = char.charCodeAt(0); return (code < 32 && ![9, 10, 13].includes(code)) || code === 127 })) throw new Error('Command must be MicroPython source without control bytes')
    const stdout = await repl.execute(source)
    await repl.friendly()
    return { status: 'success', stdout }
  })
  const requestReset = source => protocol('Requesting device reset', async (repl, s) => {
    await repl.execute('import machine')
    s.expectReset = true
    await repl.execute(source, { request: true })
    await disconnect()
    return { status: 'requested' }
  })
  return {
    logs, getSnapshot: () => state, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    connectTransport, disconnect, uploadFile, sendRaw, sendCommand: sendRaw,
    connect: options => connect(openSerial, options), connectSerial: options => connect(openSerial, options), connectUsb: options => connect(openUsb, options), copyUF2,
    triggerReplMode: () => protocol('Entering REPL', async repl => { await repl.friendly(); return { status: 'success' } }),
    triggerFsMode: () => requestReset('machine.bootloader()'),
    reboot: () => requestReset('machine.reset()'),
    clearError: () => update({ error: null }), cancelOperation: () => disconnect(abortError()),
  }
}
