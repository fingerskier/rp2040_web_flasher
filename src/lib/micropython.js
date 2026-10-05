// JSON quoting is a Python-compatible string literal for validated filenames.
// Preserve UTF-8 code points: JSON-style surrogate escapes are NOT Python pairs.
function pythonString(value) {
  return JSON.stringify(value)
}
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

export async function beginMicroPython({ write, take, wait }) {
  await write('\r\x03\x03\x01')
  await take('raw REPL; CTRL-B to exit\r\n>')
  async function execute(source, { request = false } = {}) {
    // Conservative pyboard-style pacing trades throughput for CDC reliability.
    // Slice encoded bytes (the device accumulates UTF-8), not JS characters.
    const bytes = new TextEncoder().encode(source)
    for (let offset = 0; offset < bytes.length; offset += 256) {
      await write(bytes.subarray(offset, offset + 256))
      await wait(new Promise(resolve => setTimeout(resolve, 10)))
    }
    await write('\x04')
    const ack = await take('OK')
    if (ack !== '') throw new Error('Invalid MicroPython raw REPL acknowledgement')
    try {
      const stdout = await take('\x04')
      const stderr = await take('\x04')
      if (stderr.trim()) throw new Error(`MicroPython: ${stderr.trim()}`)
      const prompt = await take('>')
      if (prompt !== '') throw new Error('Invalid MicroPython raw REPL prompt')
      return stdout.trim()
    } catch (error) {
      // A reset may remove the transport after raw OK, never before acceptance.
      // No claim about reboot completion; preserve all received remote failures.
      if (request && !error.partial && ['DEVICE_TIMEOUT', 'DEVICE_DISCONNECTED'].includes(error.code)) return ''
      throw error
    }
  }
  const firmware = await execute('import sys; print(sys.implementation.name)')
  if (firmware !== 'micropython') throw new Error(`Unsupported firmware: ${firmware || 'unknown'}. MicroPython is required.`)
  return { execute, async friendly() { await write('\x02'); await take('>>> ') } }
}

export async function uploadMicroPython(file, { write, take, progress, check, wait }) {
  if (!file?.name || /[/\\]/.test(file.name) || [...file.name].some(char => char.charCodeAt(0) < 32) || ['.', '..'].includes(file.name)) throw new Error('Select a file with a valid filename (no paths)')
  const { execute } = await beginMicroPython({ write, take, wait })
  const bytes = new Uint8Array(await wait(file.arrayBuffer()))
  check()
  const stage = `.webflash-${globalThis.crypto.randomUUID()}.tmp`
  const staged = pythonString(stage)
  const target = pythonString(file.name)
  await execute(`import os, ubinascii; _f = open(${staged}, 'wb')`)
  progress(0, bytes.length)
  const chunkSize = 128
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    check()
    const chunk = bytes.subarray(offset, offset + chunkSize)
    const written = await execute(`print(_f.write(ubinascii.unhexlify('${hex(chunk)}')))`)
    if (written !== String(chunk.length)) throw new Error('MicroPython short file write')
    progress(offset + chunk.length, bytes.length)
  }
  await execute('_f.close()')
  const size = await execute(`print(os.stat(${staged})[6])`)
  if (size !== String(bytes.length)) throw new Error('Staged file size verification failed')
  await execute(`_v = open(${staged}, 'rb')`)
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    const actual = await execute(`_v.seek(${offset}); print(ubinascii.hexlify(_v.read(${chunk.length})).decode())`)
    if (actual !== hex(chunk)) throw new Error('Staged file byte verification failed')
  }
  await execute('_v.close()')
  // Never remove the destination first: failed verification/rename preserves it.
  // Cancellation disconnects and may leave a .webflash-*.tmp file behind.
  await execute(`os.rename(${staged}, ${target})`)
  await write('\x02')
  return { status: 'success', name: file.name, bytes: bytes.length }
}
