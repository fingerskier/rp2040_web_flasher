const abortError = () => new DOMException('Connection cancelled', 'AbortError')
const check = signal => { if (signal?.aborted) throw abortError() }

// Cleanup must attempt ALL acquired resources even if one hangs or throws.
async function settle(fn, milliseconds = 500) {
  let timer
  try { await Promise.race([Promise.resolve().then(fn), new Promise(resolve => { timer = setTimeout(resolve, milliseconds) })]) }
  catch { /* Best effort; subsequent releases must still run. */ }
  finally { clearTimeout(timer) }
}

async function setupStep(promise, signal, milliseconds = 5000, lateCleanup) {
  let timer, aborted, abandoned = false
  const task = Promise.resolve(promise)
  task.then(result => { if (abandoned) void settle(() => lateCleanup?.(result)) }, () => {})
  try {
    return await Promise.race([task, new Promise((resolve, reject) => {
      aborted = () => reject(abortError())
      signal?.addEventListener('abort', aborted, { once: true })
      if (signal?.aborted) aborted()
      if (Number.isFinite(milliseconds)) timer = setTimeout(() => reject(new Error('Device setup timed out')), milliseconds)
    })])
  } catch (error) { abandoned = true; throw error }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', aborted) }
}

export async function openSerial(browser = navigator, options = {}, signal) {
  if (!browser.serial) throw new Error('Web Serial API is not available in this browser')
  let port, reader, writer, closing
  let cancelPromise
  const cancel = () => { cancelPromise ??= Promise.resolve().then(() => reader?.cancel()); return cancelPromise }
  const close = () => {
    closing ??= (async () => {
      await settle(cancel)
      await settle(() => writer?.abort())
      await settle(() => reader?.releaseLock())
      await settle(() => writer?.releaseLock())
      await settle(() => port?.close())
    })()
    return closing
  }
  try {
    port = await setupStep(browser.serial.requestPort(options.requestPortOptions), signal, null, latePort => latePort.close())
    check(signal)
    await setupStep(port.open({ baudRate: 115200, ...options.openOptions, ...(options.baudRate ? { baudRate: options.baudRate } : {}) }), signal, options.timeoutMs, () => port.close())
    check(signal)
    writer = port.writable?.getWriter()
    // Read bytes directly: no hidden pipeThrough pipeline whose rejection or
    // locks can outlive the session. Decoder ownership belongs to the session.
    reader = port.readable?.getReader()
    if (!reader || !writer) throw new Error('Unable to obtain serial reader/writer')
    check(signal)
    return { type: 'serial', read: () => reader.read(), write: bytes => writer.write(bytes), cancel, close, device: port }
  } catch (error) { await close(); throw error }
}

export function resolveUsbInterface(device, options = {}) {
  for (const iface of device.configuration?.interfaces ?? []) {
    if (options.interfaceNumber !== undefined && options.interfaceNumber !== iface.interfaceNumber) continue
    for (const alternate of iface.alternates ?? []) {
      if (options.alternateSetting !== undefined && options.alternateSetting !== alternate.alternateSetting) continue
      const input = alternate.endpoints?.find(endpoint => endpoint.direction === 'in' && endpoint.type === 'bulk' && (options.endpointIn === undefined || options.endpointIn === endpoint.endpointNumber))
      const output = alternate.endpoints?.find(endpoint => endpoint.direction === 'out' && endpoint.type === 'bulk' && (options.endpointOut === undefined || options.endpointOut === endpoint.endpointNumber))
      if (input && output) return { interfaceNumber: iface.interfaceNumber, alternateSetting: alternate.alternateSetting, endpointIn: input.endpointNumber, endpointOut: output.endpointNumber, packetSize: input.packetSize ?? 64 }
    }
  }
  throw new Error('No matching USB interface/alternate with bulk IN and OUT endpoints')
}

export async function openUsb(browser = navigator, options = {}, signal) {
  if (!browser.usb) throw new Error('WebUSB API is not available in this browser')
  if (!Array.isArray(options.filters) || !options.filters.length || options.filters.some(filter => !filter || !Object.keys(filter).length)) throw new Error('Explicit nonempty USB filters are required')
  let device, tuple, claimed = false, closing
  const close = () => {
    closing ??= (async () => {
      if (claimed) await settle(() => device.releaseInterface(tuple.interfaceNumber))
      await settle(() => device?.close())
    })()
    return closing
  }
  try {
    device = await setupStep(browser.usb.requestDevice({ filters: options.filters }), signal, null, lateDevice => lateDevice.close())
    check(signal)
    const step = promise => setupStep(promise, signal, options.timeoutMs, () => device.close())
    await step(device.open())
    check(signal)
    if (!device.configuration) await step(device.selectConfiguration(options.configurationValue ?? 1))
    check(signal)
    tuple = resolveUsbInterface(device, options)
    await step(device.claimInterface(tuple.interfaceNumber))
    claimed = true
    check(signal)
    await step(device.selectAlternateInterface(tuple.interfaceNumber, tuple.alternateSetting))
    check(signal)
    return {
      type: 'usb', device, close,
      // Closing the device is the WebUSB mechanism for cancelling transferIn.
      cancel: close,
      async read() {
        const result = await device.transferIn(tuple.endpointIn, options.packetSize ?? tuple.packetSize)
        if (result.status !== 'ok' || !result.data) throw new Error(`USB input transfer failed: ${result.status}`)
        return { value: new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength), done: false }
      },
      async write(bytes) {
        const result = await device.transferOut(tuple.endpointOut, bytes)
        if (result.status !== 'ok' || result.bytesWritten !== bytes.byteLength) throw new Error('USB output transfer failed or was incomplete')
      },
    }
  } catch (error) { await close(); throw error }
}
