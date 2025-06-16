export let port: any = null;
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
let reader: ReadableStreamDefaultReader<string> | null = null;

const encoder = new TextEncoder();

export async function connect() {
  port = await (navigator as any).serial.requestPort();
  await port.open({ baudRate: 115200 });
  writer = port.writable?.getWriter() || null;
  reader = port.readable?.pipeThrough(new TextDecoderStream()).getReader() || null;
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

export async function sendCommand(cmd: string) {
  await sendRaw(cmd + '\r');
}

export async function triggerFsMode() {
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
