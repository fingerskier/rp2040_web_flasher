const BLOCK_SIZE = 512
const CHUNK_SIZE = 64 * 1024
const FLASH_START = 0x10000000
const FLASH_END = 0x11000000
const CANCELLED = Symbol('UF2 copy cancelled')

function checkSignal(signal) {
  if (signal?.aborted) throw CANCELLED
}

// Native filesystem promises cannot be forcibly cancelled. Observe every late
// settlement and bound our wait without pretending that a race stopped the I/O.
function bounded(promise, milliseconds, fallback) {
  let timer
  return Promise.race([
    promise,
    new Promise(resolve => { timer = setTimeout(() => resolve(fallback), milliseconds) }),
  ]).finally(() => clearTimeout(timer))
}

function nativeIO(signal, ioTimeoutMs, cleanupTimeoutMs) {
  const pending = new Set()
  let writable, stopping = false, aborting
  const abort = () => {
    if (!aborting && writable) {
      // Run independently of a pending write; all rejection paths are observed.
      aborting = bounded(Promise.resolve().then(() => writable.abort()).then(
        () => true, () => false,
      ), cleanupTimeoutMs, false)
    }
    return aborting
  }
  const run = (call, { picker = false, acquire = false } = {}) => {
    checkSignal(signal)
    // Calling here (not in a .then) preserves picker user activation.
    const native = Promise.resolve(call())
    const observed = native.then(value => {
      if (acquire) {
        writable = value
        if (stopping) abort()
      }
      return value
    })
    const settled = observed.then(() => {}, () => {})
    if (!picker) pending.add(settled)
    settled.then(() => pending.delete(settled))
    return new Promise((resolve, reject) => {
      let timer
      const cancel = () => finish(reject, CANCELLED)
      const finish = (complete, value) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', cancel)
        complete(value)
      }
      signal?.addEventListener('abort', cancel, { once: true })
      if (!picker) timer = setTimeout(() => finish(reject, new Error('Native firmware I/O timed out')), ioTimeoutMs)
      observed.then(value => finish(resolve, value), error => finish(reject, error))
      if (signal?.aborted) cancel()
    })
  }
  const cleanup = async () => {
    stopping = true
    abort()
    return bounded((async () => {
      await Promise.all([...pending])
      return writable ? await abort() : true
    })(), cleanupTimeoutMs, false)
  }
  return { run, cleanup }
}

function requireReload(error) {
  const message = 'Native firmware I/O could not be confirmed stopped; reload before retrying'
  if (error instanceof Error) {
    try {
      error.requiresReload = true
      error.message = `${error.message}. ${message}`
      if (error.requiresReload && error.message.includes(message)) return error
    } catch { /* Frozen errors still need an explicit recovery instruction. */ }
  }
  return Object.assign(new Error(message, { cause: error === CANCELLED ? undefined : error }), { requiresReload: true })
}

async function validateFirmware(file, signal, run) {
  checkSignal(signal)
  if (!file || typeof file.name !== 'string' || !/^.+\.uf2$/i.test(file.name) ||
      /[\\/]/.test(file.name) || file.name.includes('\0') || !Number.isSafeInteger(file.size) ||
      file.size <= 0 || file.size % BLOCK_SIZE !== 0 || typeof file.slice !== 'function') {
    throw new Error('Select a nonempty UF2 firmware file with a plain .uf2 filename and complete 512-byte blocks')
  }
  const blocks = file.size / BLOCK_SIZE
  let previousEnd = FLASH_START
  for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
    checkSignal(signal)
    const buffer = await run(() => file.slice(offset, Math.min(offset + CHUNK_SIZE, file.size)).arrayBuffer())
    checkSignal(signal)
    for (let local = 0; local < buffer.byteLength; local += BLOCK_SIZE) {
      const view = new DataView(buffer, local, BLOCK_SIZE)
      const word = position => view.getUint32(position, true)
      const block = (offset + local) / BLOCK_SIZE
      if (word(0) !== 0x0a324655 || word(4) !== 0x9e5d5157 || word(508) !== 0x0ab16f30) {
        throw new Error(`Invalid UF2 magic in block ${block}`)
      }
      // Deliberately accept standard, ordered RP2040 flash images only:
      // no containers, RAM images, metadata extensions or mixed-family files.
      if (word(8) !== 0x2000 || word(28) !== 0xe48bff56) {
        throw new Error(`UF2 block ${block} is not supported RP2040 flash firmware`)
      }
      const address = word(12)
      const payload = word(16)
      if (payload !== 256 || address % 256 !== 0 || address < previousEnd ||
          address + payload > FLASH_END) {
        throw new Error(`Invalid UF2 payload or RP2040 flash address in block ${block}`)
      }
      if (word(20) !== block || word(24) !== blocks) {
        throw new Error(`Invalid UF2 block numbering or block count in block ${block}`)
      }
      previousEnd = address + payload
    }
  }
}

/**
 * Validate and copy a trusted RP2040 MicroPython UF2 using bounded 64 KiB chunks.
 * Format/family validation cannot establish that the runtime is MicroPython,
 * or that the image fits a particular board's physical flash capacity.
 * Success means the file copy closed successfully, NOT verified device flashing.
 * Cancellation cannot undo blocks already consumed by the bootloader.
 */
export async function copyUF2(file, { signal, onProgress, showDirectoryPicker, ioTimeoutMs = 30000, cleanupTimeoutMs = 2000 } = {}) {
  if (signal?.aborted) return { status: 'cancelled' }
  const browser = globalThis.window
  const picker = showDirectoryPicker ?? browser?.showDirectoryPicker?.bind(browser)
  if (typeof picker !== 'function') throw new Error('Directory picker is unavailable: UF2 copy is not supported in this browser')
  const { run, cleanup } = nativeIO(signal, ioTimeoutMs, cleanupTimeoutMs)
  let directory
  try {
    // Do not await validation before this call: preserve transient user activation.
    directory = await run(() => picker({ mode: 'readwrite' }), { picker: true })
  } catch (error) {
    if (error === CANCELLED || error?.name === 'AbortError') return { status: 'cancelled' }
    throw error
  }

  let writable
  try {
    await validateFirmware(file, signal, run)
    checkSignal(signal)
    const infoHandle = await run(() => directory.getFileHandle('INFO_UF2.TXT', { create: false }))
    checkSignal(signal)
    const infoFile = await run(() => infoHandle.getFile())
    checkSignal(signal)
    if (infoFile.size > CHUNK_SIZE) throw new Error('Invalid oversized INFO_UF2.TXT')
    const info = await run(() => infoFile.text())
    checkSignal(signal)
    // The RP2040 ROM reports RPI-RP2, not the silicon name RP2040.
    if (!/^Board-ID:[ \t]*(?:RPI-RP2|RP2040)(?:-[^\r\n]*)?[ \t]*\r?$/im.test(info)) {
      throw new Error('Select the RP2040 bootloader drive containing an RP2040 INFO_UF2.TXT')
    }
    const handle = await run(() => directory.getFileHandle(file.name, { create: true }))
    checkSignal(signal)
    writable = await run(() => handle.createWritable(), { acquire: true })
    checkSignal(signal)
    onProgress?.(0, file.size)
    for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
      checkSignal(signal)
      const end = Math.min(offset + CHUNK_SIZE, file.size)
      await run(() => writable.write(file.slice(offset, end)))
      checkSignal(signal)
      onProgress?.(end, file.size)
    }
    checkSignal(signal)
    await run(() => writable.close())
    checkSignal(signal)
    return { status: 'success', name: file.name, bytes: file.size }
  } catch (error) {
    if (!await cleanup()) throw requireReload(error)
    if (error === CANCELLED) return { status: 'cancelled' }
    // A device reboot/disconnection is not evidence of a successful flash.
    // Only picker AbortError and explicit signal checks count as cancellation.
    throw error
  }
}
