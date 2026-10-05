import { it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createDeviceController } from '../src/lib/deviceController.js'

function fakeTransport() {
  let push, finish
  const calls = []
  const stream = new ReadableStream({ start(c) { push = bytes => c.enqueue(typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes); finish = () => c.close() } })
  const reader = stream.getReader()
  return { type: 'fake', read: () => reader.read(), write: async bytes => { calls.push(new TextDecoder().decode(bytes)) }, cancel: () => reader.cancel(), close: async () => { calls.push('close') }, push: value => push(value), eof: () => finish(), calls }
}

it('cleans up on EOF and keeps stale reads out of the next session', async () => {
  const c = createDeviceController({ timeoutMs: 50 })
  const first = fakeTransport()
  await c.connectTransport(first)
  expect(c.getSnapshot().isConnected).toBe(true)
  first.eof()
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(c.getSnapshot().isConnected).toBe(false)
  expect(first.calls).toContain('close')
  const { io: second } = micropython()
  await c.connectTransport(second)
  await c.sendCommand('print(1)')
  expect(second.calls).toContain('print(1)')
  await c.disconnect()
})

function micropython({ firmware = 'micropython', stderr = '', silent = false, ack = 'OK', corrupt = false, commandReply, burstStderr } = {}) {
  const io = fakeTransport()
  const files = new Map()
  const commands = []
  const decoder = new TextDecoder()
  let source = ''
  let stage
  const baseWrite = io.write
  io.write = async bytes => {
    await baseWrite(bytes)
    const text = decoder.decode(bytes, { stream: true })
    if (text.includes('\x01')) { if (!silent) io.push('raw REPL; CTRL-B to exit\r\n>'); return }
    if (text === '\x02') { io.push('\r\n>>> '); return }
    if (text !== '\x04') { source += text; return }
    commands.push(source)
    if (commandReply && !source.includes('sys.implementation.name')) { const command = source; source = ''; commandReply(io, command); return }
    let out = ''
    if (source.includes('sys.implementation.name')) {
      out = firmware + '\r\n'
      if (burstStderr !== undefined) {
        source = ''
        io.push(ack)
        // Let the ACK settle and the stdout waiter start, then queue both
        // stream chunks in one turn: no delay between the two EOTs.
        setTimeout(() => {
          io.push(out + '\x04')
          io.push(burstStderr + '\x04>')
        }, 0)
        return
      }
    }
    if (source.includes("open(")) { const match = source.match(/open\((".*?"), 'wb'\)/); if (match) { stage = JSON.parse(match[1]); files.set(stage, []) } }
    const chunk = source.match(/unhexlify\('([0-9a-f]*)'\)/)
    if (chunk) { const data = Array.from(Buffer.from(chunk[1], 'hex')); files.get(stage).push(...data); out = data.length + '\r\n' }
    if (source.includes('os.stat(')) out = String(files.get(stage).length) + '\r\n'
    const readback = source.match(/_v.seek\((\d+)\); print\(ubinascii.hexlify\(_v.read\((\d+)\)/)
    if (readback) out = Buffer.from(files.get(stage).slice(Number(readback[1]), Number(readback[1]) + Number(readback[2]))).toString('hex') + '\r\n'
    if (source.includes('os.rename(')) { const match = source.match(/os.rename\((".*?"), (".*?")\)/); files.set(JSON.parse(match[2]), files.get(stage)); files.delete(stage) }
    source = ''
    if (readback && corrupt) out = 'ff\r\n'
    io.push(ack + out + '\x04' + stderr + '\x04>')
  }
  return { io, files, commands }
}

it.each(['', 'ValueError: firmware query failed'])('preserves distinct stdout/stderr EOTs in a ReadableStream burst: %j', async burstStderr => {
  const c = createDeviceController({ timeoutMs: 100 })
  const { io, commands } = micropython({ burstStderr })
  await c.connectTransport(io)
  try {
    const command = c.sendCommand('print("user")')
    if (burstStderr) {
      await expect(command).rejects.toThrow(`MicroPython: ${burstStderr}`)
      expect(commands).not.toContain('print("user")')
    } else {
      await expect(command).resolves.toEqual({ status: 'success', stdout: '' })
      expect(commands).toContain('print("user")')
      expect(io.calls.at(-1)).toBe('\x02')
    }
  } finally {
    await c.disconnect()
  }
})

it('persists binary bytes and exact filename using acknowledged staged writes without executing the file', async () => {
  const c = createDeviceController({ timeoutMs: 100 })
  const { io, files, commands } = micropython()
  await c.connectTransport(io)
  const bytes = Uint8Array.from({ length: 777 }, (_, index) => index % 256)
  const result = await c.uploadFile({ name: 'my script.py', size: bytes.length, arrayBuffer: async () => bytes.buffer })
  expect(result).toEqual({ status: 'success', name: 'my script.py', bytes: 777 })
  expect(files.get('my script.py')).toEqual([...bytes])
  expect(files.size).toBe(1)
  expect(io.calls.join('')).not.toContain('\x05')
  expect(io.calls.some(call => call.includes('os.stat('))).toBe(true)
  // Replay the actual generated Python commands against a real filesystem too;
  // the byte-transport emulator cannot prove Python syntax or rename semantics.
  const python = 'import sys,json,tempfile,os,binascii,io,contextlib\nsys.modules["ubinascii"]=binascii\nwith tempfile.TemporaryDirectory() as root:\n os.chdir(root)\n ns={}\n with contextlib.redirect_stdout(io.StringIO()):\n  for source in json.loads(sys.argv[1]): exec(source,ns)\n print(json.dumps({"files":os.listdir(),"hex":open("my script.py","rb").read().hex()}))'
  const persisted = JSON.parse(execFileSync('python3', ['-c', python, JSON.stringify(commands)], { encoding: 'utf8' }))
  expect(persisted.files).toEqual(['my script.py'])
  expect(persisted.hex).toBe(Buffer.from(bytes).toString('hex'))
  await c.disconnect()
})

it.each([{ firmware: 'circuitpython' }, { stderr: 'OSError: disk full' }, { silent: true }, { ack: 'NO' }, { corrupt: true }])('rejects incompatible firmware, remote errors, and timeout: %j', async options => {
  const c = createDeviceController({ timeoutMs: 20 })
  const { io, files } = micropython(options)
  await c.connectTransport(io)
  await expect(c.uploadFile({ name: 'main.py', size: 1, arrayBuffer: async () => new Uint8Array([3]).buffer })).rejects.toThrow()
  expect(files.has('main.py')).toBe(false)
  expect(c.getSnapshot().isConnected).toBe(false)
})

it('captures queued work in its original session and cancels blocked writes without retargeting', async () => {
  const c = createDeviceController({ timeoutMs: 100 })
  const first = fakeTransport()
  first.write = () => new Promise(() => {})
  await c.connectTransport(first)
  const pending = c.sendCommand('old1').catch(error => error)
  const queued = c.sendCommand('old2').catch(error => error)
  await Promise.resolve()
  await c.cancelOperation()
  const { io: second } = micropython()
  await c.connectTransport(second)
  expect((await pending).name).toBe('AbortError')
  expect((await queued).name).toBe('AbortError')
  expect(second.calls).toEqual([])
  await c.sendCommand('new')
  expect(second.calls).toContain('new')
  await c.disconnect()
})

it('rejects overlapping connection requests and rolls back late picker completion after disconnect', async () => {
  let pick
  const port = { close: async () => { port.closed = true }, open: async () => { port.opened = true } }
  const c = createDeviceController({ browser: { serial: { requestPort: () => new Promise(resolve => { pick = resolve }) } } })
  const connecting = c.connectSerial().catch(error => error)
  expect(c.getSnapshot().isConnecting).toBe(true)
  await expect(c.connectSerial()).rejects.toThrow()
  await c.disconnect()
  pick(port)
  expect((await connecting).name).toBe('AbortError')
  await new Promise(resolve => setTimeout(resolve, 1))
  expect(port.closed).toBe(true)
  expect(port.opened).toBeUndefined()
  expect(c.getSnapshot().isConnected).toBe(false)
})

it('starts firmware picker synchronously and exposes cancellable disconnected busy state', async () => {
  let entered = false
  const c = createDeviceController({ copyFirmware: (file, { signal }) => { entered = true; return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('cancel', 'AbortError')))) } })
  const pending = c.copyUF2({ name: 'test.uf2', size: 1 }).catch(error => error)
  expect(entered).toBe(true)
  expect(c.getSnapshot().isBusy).toBe(true)
  await c.cancelOperation()
  expect((await pending).name).toBe('AbortError')
  expect(c.getSnapshot().isBusy).toBe(false)
})

it('marks queued work busy synchronously so firmware copy cannot race it', async () => {
  const c = createDeviceController({ copyFirmware: async () => ({ status: 'success' }) })
  await c.connectTransport(micropython().io)
  const sending = c.sendCommand('a')
  expect(c.getSnapshot().isBusy).toBe(true)
  await expect(c.copyUF2({ size: 1 })).rejects.toThrow(/active/)
  await sending
  await c.disconnect()
})

it('handles unplug events even when the read never settles, with bounded cleanup', async () => {
  const serial = new EventTarget()
  const c = createDeviceController({ browser: { serial }, cleanupMs: 5 })
  const io = fakeTransport()
  io.type = 'serial'
  io.device = {}
  io.read = () => new Promise(() => {})
  await c.connectTransport(io)
  const event = new Event('disconnect')
  Object.defineProperty(event, 'port', { value: io.device })
  serial.dispatchEvent(event)
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(c.getSnapshot().isConnected).toBe(false)
  expect(c.getSnapshot().isDisconnecting).toBe(false)
  expect(io.calls).toContain('close')
})

it('rejects setup timeout and attempts acquired-port cleanup', async () => {
  let closed = false
  const port = { open: () => new Promise(() => {}), close: async () => { closed = true } }
  const c = createDeviceController({ timeoutMs: 10, browser: { serial: { requestPort: async () => port } } })
  await expect(c.connectSerial()).rejects.toThrow(/timed out/)
  expect(closed).toBe(true)
  expect(c.getSnapshot().isConnecting).toBe(false)
})

it('preserves non-BMP Unicode and quotes in a filename', async () => {
  const c = createDeviceController({ timeoutMs: 100 })
  const { io, files } = micropython()
  await c.connectTransport(io)
  const name = '😀 café.py'
  await c.uploadFile({ name, size: 0, arrayBuffer: async () => new ArrayBuffer(0) })
  expect(files.has(name)).toBe(true)
  const literal = io.calls.find(call => call.includes('os.rename(')).match(/os.rename\(".*?", (.*)\)/)[1]
  expect(execFileSync('python3', ['-c', 'import sys; print(eval(sys.argv[1]).encode("utf8").hex())', literal], { encoding: 'utf8' }).trim()).toBe(Buffer.from(name).toString('hex'))
  await c.disconnect()
})

it('keeps concurrent disconnects idempotent and connecting blocked until cleanup settles', async () => {
  const c = createDeviceController({ cleanupMs: 50 })
  const io = fakeTransport()
  let release
  io.close = () => new Promise(resolve => { release = resolve })
  await c.connectTransport(io)
  const one = c.disconnect()
  const two = c.disconnect()
  expect(c.getSnapshot().isDisconnecting).toBe(true)
  await expect(c.connectTransport(fakeTransport())).rejects.toThrow()
  await new Promise(resolve => setTimeout(resolve, 1))
  release()
  await Promise.all([one, two])
  expect(c.getSnapshot().isDisconnecting).toBe(false)
})

it('isolates late old-session bytes and decoder state after fatal reads and reconnect', async () => {
  const c = createDeviceController({ cleanupMs: 5 })
  let oldRead
  const old = { type: 'fake', read: () => new Promise(resolve => { oldRead = resolve }), cancel: async () => { throw Error('cancel') }, close: async () => {} }
  await c.connectTransport(old)
  await c.disconnect()
  const next = fakeTransport()
  await c.connectTransport(next)
  oldRead({ value: new TextEncoder().encode('stale'), done: false })
  next.push('new')
  await new Promise(resolve => setTimeout(resolve, 25))
  expect(c.logs.getSnapshot().partial).toBe('new')
  expect(c.getSnapshot().isConnected).toBe(true)
  await c.disconnect()
})

it('does not reopen the firmware picker while an aborted copy is still settling', async () => {
  let settle
  const c = createDeviceController({ copyFirmware: () => new Promise(resolve => { settle = resolve }) })
  const copy = c.copyUF2({ size: 1 })
  const cancelling = c.cancelOperation()
  expect(c.getSnapshot().isDisconnecting).toBe(true)
  await expect(c.copyUF2({ size: 1 })).rejects.toThrow(/active/)
  settle({ status: 'cancelled' })
  await Promise.all([copy, cancelling])
  expect(c.getSnapshot().isDisconnecting).toBe(false)
})

it('awaits setup rollback when disconnect races an acquired port opening', async () => {
  let closing = false
  const port = { open: () => new Promise(() => {}), close: async () => { await new Promise(resolve => setTimeout(resolve, 10)); closing = true } }
  const c = createDeviceController({ browser: { serial: { requestPort: async () => port } } })
  const connection = c.connectSerial().catch(error => error)
  await Promise.resolve()
  await c.disconnect()
  expect(closing).toBe(true)
  expect((await connection).name).toBe('AbortError')
})

it('decodes split UTF-8 bytes per session and serializes commands behind the entire upload', async () => {
  const c = createDeviceController({ timeoutMs: 100 })
  const { io } = micropython()
  await c.connectTransport(io)
  io.push(new Uint8Array([0xe2, 0x82]))
  io.push(new Uint8Array([0xac]))
  await new Promise(resolve => setTimeout(resolve, 25))
  expect(c.logs.getSnapshot().partial).toBe('€')
  const upload = c.uploadFile({ name: 'data.bin', size: 1, arrayBuffer: async () => new Uint8Array([1]).buffer })
  const command = c.sendCommand('print("after")')
  await Promise.all([upload, command])
  expect(io.calls.indexOf('print("after")')).toBeGreaterThan(io.calls.indexOf('\x02'))
  expect(io.calls.at(-1)).toBe('\x02')
  await c.disconnect()
})

it('reports a fatal reader failure and attempts close even when cancellation fails', async () => {
  let closed = false
  const c = createDeviceController()
  await c.connectTransport({ type: 'fake', read: async () => { throw Error('unplugged read') }, cancel: async () => { throw Error('cancel failed') }, close: async () => { closed = true } })
  await new Promise(resolve => setTimeout(resolve, 1))
  expect(c.getSnapshot().isConnected).toBe(false)
  expect(c.getSnapshot().error.message).toBe('unplugged read')
  expect(closed).toBe(true)
})

it.each(['sendCommand', 'sendRaw', 'triggerReplMode', 'triggerFsMode', 'reboot'])('gates %s on verified MicroPython', async method => {
  for (const options of [{ silent: true }, { firmware: 'circuitpython' }]) {
    const c = createDeviceController({ timeoutMs: 15 })
    const { io } = micropython(options)
    await c.connectTransport(io)
    await expect(c[method]('print("user")')).rejects.toThrow()
    expect(io.calls.join('')).not.toContain('print("user")')
    expect(io.calls.join('')).not.toContain('machine.')
    expect(c.getSnapshot().isConnected).toBe(false)
  }
})

it('waits for command ACK, stdout, stderr and final prompt before completing or starting queued work', async () => {
  const c = createDeviceController({ timeoutMs: 100 })
  let respond
  const { io } = micropython({ commandReply: (device) => { respond = () => device.push('OKhello\r\n\x04\x04>') } })
  await c.connectTransport(io)
  let settled = false
  const first = c.sendCommand('first()').then(result => { settled = true; return result })
  const second = c.sendRaw('second()')
  await new Promise(resolve => setTimeout(resolve, 35))
  expect(settled).toBe(false)
  expect(io.calls).not.toContain('second()')
  respond()
  expect(await first).toEqual({ status: 'success', stdout: 'hello' })
  await new Promise(resolve => setTimeout(resolve, 35))
  respond()
  await second
  await c.disconnect()
})

it.each(['OK\x04ValueError: bad command\x04>', 'OKoutput\x04\x04', 'NO', ''])('rejects incomplete or failed custom execution %j', async reply => {
  const c = createDeviceController({ timeoutMs: 15 })
  const { io } = micropython({ commandReply: device => device.push(reply) })
  await c.connectTransport(io)
  await expect(c.sendCommand('user()')).rejects.toThrow()
  expect(c.getSnapshot().isConnected).toBe(false)
})

it('rejects transport control bytes in sendRaw', async () => {
  const c = createDeviceController()
  const { io } = micropython()
  await c.connectTransport(io)
  await expect(c.sendRaw('evil\x04')).rejects.toThrow(/control bytes/)
  expect(io.calls).not.toContain('evil\x04')
})

it.each(['reboot', 'triggerFsMode'])('returns requested, not boot-verified success, on expected %s EOF', async method => {
  const c = createDeviceController({ timeoutMs: 20 })
  const { io } = micropython({ commandReply: (device, source) => {
    if (source === 'import machine') device.push('OK\x04\x04>')
    else { device.push('OK'); device.eof() }
  } })
  await c.connectTransport(io)
  await expect(c[method]()).resolves.toEqual({ status: 'requested' })
  expect(c.getSnapshot().isConnected).toBe(false)
  expect(c.getSnapshot().error).toBe(null)
})

it('paces bounded UTF-8 wire chunks for uploads and custom source', async () => {
  const c = createDeviceController({ timeoutMs: 100 })
  const { io, files, commands } = micropython()
  const sizes = []
  const original = io.write
  io.write = bytes => { sizes.push(bytes.length); return original(bytes) }
  await c.connectTransport(io)
  const bytes = new Uint8Array(300).fill(171)
  await c.uploadFile({ name: 'binary', arrayBuffer: async () => bytes.buffer })
  await c.sendCommand('#' + 'é'.repeat(300))
  expect(Math.max(...sizes)).toBeLessThanOrEqual(256)
  expect(commands.at(-1)).toBe('#' + 'é'.repeat(300))
  expect(files.get('binary')).toEqual([...bytes])
  await c.disconnect()
})

it.each([false, true])('latches requiresReload firmware failures despite cancellation: %s', async cancel => {
  const failure = Object.assign(new Error('Reload required: write still pending'), { requiresReload: true })
  let rejectCopy
  const c = createDeviceController({ cleanupMs: 20, copyFirmware: () => new Promise((resolve, reject) => { rejectCopy = reject }) })
  const copy = c.copyUF2({ size: 1 }).catch(error => error)
  const cancelling = cancel ? c.cancelOperation() : Promise.resolve()
  rejectCopy(failure)
  expect(await copy).toBe(failure)
  await cancelling
  await c.disconnect()
  await c.cancelOperation()
  c.clearError()
  expect(c.getSnapshot()).toMatchObject({ isBusy: true, operation: null, error: failure })
  await expect(c.connectTransport(fakeTransport())).rejects.toThrow(/Reload/)
  await expect(c.connectSerial()).rejects.toThrow(/Reload/)
  await expect(c.copyUF2({ size: 1 })).rejects.toThrow(/Reload/)
  await expect(c.sendCommand('print(1)')).rejects.toThrow(/Reload/)
})

it.each(['reboot', 'triggerFsMode'])('preserves pre-acceptance and remote failures for %s', async method => {
  for (const reply of ['', 'NO', 'OK\x04OSError: reset denied\x04>', 'OK\x04partial remote failure']) {
    const c = createDeviceController({ timeoutMs: 15 })
    const { io } = micropython({ commandReply: (device, source) => {
      if (source === 'import machine') device.push('OK\x04\x04>')
      else { device.push(reply); device.eof() }
    } })
    await c.connectTransport(io)
    await expect(c[method]()).rejects.toThrow()
    expect(c.getSnapshot().error).not.toBe(null)
  }
})

it('returns a verified friendly REPL and clears normal copy cancellation state', async () => {
  const c = createDeviceController({ copyFirmware: (file, { signal }) => new Promise(resolve => signal.addEventListener('abort', () => resolve({ status: 'cancelled' }))) })
  const { io } = micropython()
  await c.connectTransport(io)
  await expect(c.triggerReplMode()).resolves.toEqual({ status: 'success' })
  expect(io.calls.at(-1)).toBe('\x02')
  const copy = c.copyUF2({ size: 1 })
  await c.cancelOperation()
  await expect(copy).resolves.toEqual({ status: 'cancelled' })
  expect(c.getSnapshot()).toMatchObject({ isBusy: false, operation: null, isDisconnecting: false })
})

export { fakeTransport }
