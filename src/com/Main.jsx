import { useRef, useState } from 'react'
import CommandButton from '@/com/CommandButton'
import UploadFirmware from '@/com/UploadFirmware'
import UploadFile from '@/com/UploadFile'
import { useDevice } from '@/lib/DeviceContext'

export default function Main() {
  const { connect, disconnect, triggerFsMode, triggerReplMode, reboot,
    isConnected, isConnecting, isDisconnecting, isBusy, error, operation,
    cancelOperation, clearError } = useDevice()
  const [msg, setMsg] = useState('')
  const [localError, setLocalError] = useState('')
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)
  const busy = pending || isBusy || isConnecting || isDisconnecting
  const serialSupported = window.isSecureContext && !!navigator.serial
  const runConnection = async action => {
    if (busy || inFlight.current) return
    inFlight.current = true
    setPending(true)
    setLocalError('')
    clearError()
    try {
      await action()
    } catch (err) {
      if (err.name !== 'AbortError') setLocalError(err.message || String(err))
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }
  const errorMessage = localError || error?.message

  return (
    <main id="main-content" tabIndex={-1}>
      <section>
        <h2>Connection</h2>
        <p>MicroPython only. Connect a board running MicroPython using Web Serial.</p>
        <p role="status" aria-label="Connection status">Status: {isDisconnecting ? 'Disconnecting…' : isConnecting ? 'Connecting…' : isConnected ? 'Connected' : 'Disconnected'}</p>
        {!serialSupported && <p>Web Serial requires HTTPS (or localhost) and a supported browser such as desktop Chrome or Edge.</p>}
        <div className="controls">
          <button type="button" onClick={() => runConnection(connect)} disabled={!serialSupported || busy || isConnected}>Connect</button>
          <button type="button" onClick={() => runConnection(disconnect)} disabled={busy || !isConnected}>Disconnect</button>
        </div>
        {errorMessage && <div><p role="alert">{errorMessage}</p><button type="button" onClick={() => { setLocalError(''); clearError() }}>Clear error</button></div>}
        {operation && <section aria-label="Current operation">
          <p role="status">{operation.label}{operation.total > 0 ? `: ${operation.completed} / ${operation.total}` : '…'}</p>
          <progress aria-label={operation.label} max={operation.total > 0 ? operation.total : 1} value={operation.total > 0 ? operation.completed : undefined} />
          <button type="button" onClick={cancelOperation}>Cancel operation</button>
        </section>}
      </section>
      <section>
        <h2>Basic functions</h2>
        <div className="controls">
          <CommandButton label="FS Mode" command={triggerFsMode} disabled={busy} />
          <CommandButton label="REPL Mode" command={triggerReplMode} disabled={busy} />
          <CommandButton label="Reboot" command={reboot} disabled={busy} />
        </div>
        <UploadFirmware />
        <UploadFile />
      </section>
      <section>
        <h2>Advanced</h2>
        <label htmlFor="custom-command">MicroPython command</label>
        <div className="controls">
          <input id="custom-command" type="text" value={msg} disabled={busy || !isConnected} onChange={e => setMsg(e.target.value)} />
          <CommandButton label="Send" command={msg} disabled={busy || !msg.trim()} />
        </div>
      </section>
    </main>
  )
}
