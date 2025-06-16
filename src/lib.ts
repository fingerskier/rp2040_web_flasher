export let port: any = null;
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
let reader: ReadableStreamDefaultReader<string> | null = null;

const logLines: string[] = [];
let partial = '';
const MAX_LOG_LINES = 500;

async function readLoop() {
  if (!reader) return;
  partial = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      partial += value;
      const lines = partial.split(/\r?\n/);
      partial = lines.pop() || '';
      for (const line of lines) {
        logLines.push(line);
        if (logLines.length > MAX_LOG_LINES) logLines.shift();
      }
    }
  }
}

const encoder = new TextEncoder();

export async function connect() {
  port = await (navigator as any).serial.requestPort();
  await port.open({ baudRate: 115200 });
  writer = port.writable?.getWriter() || null;
  reader = port.readable?.pipeThrough(new TextDecoderStream()).getReader() || null;
  readLoop();
}

export async function disconnect() {
  await reader?.cancel();
  reader = null;
  await writer?.close();
  writer = null;
  await port?.close();
  port = null;
}

async function sendRaw(data: string) {
  if (!writer) throw new Error('Not connected');
  await writer.write(encoder.encode(data));
}

export function getLogTail(n: number): string {
  return logLines.slice(-n).join('\n');
}

export async function sendCommand(cmd: string) {
  console.log('Sending command:', cmd);
  await sendRaw(cmd + '\r');
}

export async function triggerFsMode() {
  await triggerReplMode()
  // Enter bootloader / mass storage mode
  await sendRaw('\x03import machine\nmachine.bootloader()\n');
}

export async function triggerReplMode() {
  // Send Ctrl-C to break to REPL
  await sendRaw('\x03');
}

export async function reboot() {
  await sendRaw('\x03import machine\nmachine.reset()\n');
}

export async function copyUF2(file: File) {
  const dir = await (window as any).showDirectoryPicker();
  const handle = await dir.getFileHandle(file.name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(await file.arrayBuffer());
  await writable.close();
}

export async function uploadPyFile(file: File) {
  const text = await file.text();
  // Enter paste mode Ctrl-E
  await sendRaw('\x05');
  await sendRaw(text);
  // Exit paste mode Ctrl-D
  await sendRaw('\x04');
}
