import './style.css'
import {
  connect,
  triggerFsMode,
  triggerReplMode,
  reboot,
  sendCommand,
  copyUF2,
  uploadPyFile,
  getLogTail,
} from './lib.ts'

const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement
const cmdInput = document.getElementById('cmd-input') as HTMLTextAreaElement
const sendCmdBtn = document.getElementById('send-cmd') as HTMLButtonElement
const fsBtn = document.getElementById('fs-btn') as HTMLButtonElement
const replBtn = document.getElementById('repl-btn') as HTMLButtonElement
const rebootBtn = document.getElementById('reboot-btn') as HTMLButtonElement
const uf2Input = document.getElementById('uf2-file') as HTMLInputElement
const uf2Btn = document.getElementById('upload-uf2') as HTMLButtonElement
const pyInput = document.getElementById('py-file') as HTMLInputElement
const pyBtn = document.getElementById('upload-py') as HTMLButtonElement
const tailInput = document.getElementById('tail-lines') as HTMLInputElement
const tailBtn = document.getElementById('show-tail') as HTMLButtonElement
const logPre = document.getElementById('output-log') as HTMLPreElement

connectBtn?.addEventListener('click', async () => {
  await connect()
})

sendCmdBtn?.addEventListener('click', async () => {
  if (cmdInput?.value) await sendCommand(cmdInput.value)
})

fsBtn?.addEventListener('click', triggerFsMode)
replBtn?.addEventListener('click', triggerReplMode)
rebootBtn?.addEventListener('click', reboot)

uf2Btn?.addEventListener('click', async () => {
  if (uf2Input.files?.length) {
    await copyUF2(uf2Input.files[0])
  }
})

pyBtn?.addEventListener('click', async () => {
  if (pyInput.files?.length) {
    await uploadPyFile(pyInput.files[0])
  }
})

tailBtn?.addEventListener('click', () => {
  const n = parseInt(tailInput.value) || 20
  logPre.textContent = getLogTail(n)
})

