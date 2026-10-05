import { useRef, useState } from 'react'
import { useDevice } from '@/lib/DeviceContext'

export default function UploadFirmware() {
  const fileInput = useRef()
  const inFlight = useRef(false)
  const { copyUF2, isBusy, isConnecting, isDisconnecting } = useDevice()
  const [selected, setSelected] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const supported = window.isSecureContext && typeof window.showDirectoryPicker === 'function'
  const disabled = !supported || pending || isBusy || isConnecting || isDisconnecting

  const upload = async () => {
    const file = fileInput.current?.files?.[0]
    if (!file || disabled || inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError('')
    setStatus('')
    try {
      const result = await copyUF2(file)
      if (result?.status === 'success') {
        fileInput.current.value = ''
        setSelected(false)
        setStatus(`Copied ${file.name}. The board should restart; reconnect to MicroPython when ready.`)
      } else if (result?.status === 'cancelled') {
        setStatus('Copy cancelled. File selection retained.')
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || String(err))
      else setStatus('Copy cancelled. File selection retained.')
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <section className="panel transfer-panel" aria-labelledby="firmware-heading">
      <h2 id="firmware-heading">MicroPython firmware</h2>
      <p id="firmware-warning">Choose MicroPython firmware for your exact board. UF2 cannot identify the runtime; use a trusted MicroPython download, not an arbitrary UF2.</p>
      <p id="firmware-help" className="helper-note">Hold BOOTSEL while plugging in the board, then release it. Choose the RPI-RP2 drive when prompted. No serial connection is needed.</p>
      {!supported && <p>Firmware copying requires HTTPS (or localhost) and a browser supporting showDirectoryPicker. Alternatively, copy the MicroPython UF2 to RPI-RP2 in your file manager.</p>}
      <label>MicroPython firmware (.uf2) <input type="file" aria-describedby="firmware-warning firmware-help" ref={fileInput} accept=".uf2" disabled={disabled} onChange={e => { setSelected(!!e.target.files?.length); setStatus('') }} /></label>
      <button type="button" onClick={upload} disabled={disabled || !selected}>Copy firmware</button>
      <p role="status">{status}</p>
      {error && <div><p role="alert">{error}</p><button type="button" onClick={() => setError('')}>Clear firmware error</button></div>}
    </section>
  )
}
