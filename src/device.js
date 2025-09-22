export let port= null
let writer = null
let reader = null

const logLines = []
let partial = ''
const MAX_LOG_LINES = 50

async function readLoop() {
  if (!reader) return
  partial = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) {
      partial += value
      const lines = partial.split(/\r?\n/)
      partial = lines.pop() || ''
      for (const line of lines) {
        logLines.push(line)
        if (logLines.length > MAX_LOG_LINES) logLines.shift()
      }
    }
  }
}

const encoder = new TextEncoder()

export async function connect() {
  port = await (navigator).serial.requestPort()
  await port.open({ baudRate: 115200 })
  writer = port.writable?.getWriter() || null
  reader = port.readable?.pipeThrough(new TextDecoderStream()).getReader() || null
  readLoop()
  console.log('Connected to RP2040', port)
}

export async function disconnect() {
  await reader?.cancel()
  reader = null
  await writer?.close()
  writer = null
  await port?.close()
  port = null
}

async function sendRaw(data) {
  console.log('Sending command:', data)
  if (!writer) throw new Error('Not connected')
  await writer.write(encoder.encode(data))
}

export function getLogTail(n) {
  // Get the last n lines from the log, convert them to strings and return
  const these = logLines.slice(-n)
  return these.map(line => line.toString())
}

export async function sendCommand(cmd) {
  await sendRaw(cmd + '\r')
}

export async function triggerFsMode() {
  // Enter bootloader / mass storage mode
  await sendRaw('\x03import machine\nmachine.bootloader()\n')
}

export async function triggerReplMode() {
  // Send Ctrl-C to break to REPL
  await sendRaw('\x03')
}

export async function reboot() {
  await sendRaw('\x03import machine\nmachine.reset()\n')
}

export async function copyUF2(file) {
  const dir = await (window).showDirectoryPicker()
  const handle = await dir.getFileHandle(file.name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(await file.arrayBuffer())
  await writable.close()
}

export async function uploadFile(file) {
  const text = await file.text()
  // Enter paste mode Ctrl-E
  await sendRaw('\x05')
  await sendRaw(text)
  // Exit paste mode Ctrl-D
  await sendRaw('\x04')
}