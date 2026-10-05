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
      <section className="panel connection-panel" aria-labelledby="connection-heading">
        <div className="section-heading">
          <h2 id="connection-heading">Connection</h2>
          <p className={`connection-status ${isConnected && !isDisconnecting ? 'is-connected' : ''}`} role="status" aria-label="Connection status">Status: {isDisconnecting ? 'Disconnecting…' : isConnecting ? 'Connecting…' : isConnected ? 'Connected' : 'Disconnected'}</p>
        </div>
        <p>Connect a board running MicroPython via USB to get started.</p>
        {!serialSupported && <p>Web Serial requires HTTPS (or localhost) and a supported browser such as desktop Chrome or Edge.</p>}
        <div className="controls">
          <button className="primary-button" type="button" onClick={() => runConnection(connect)} disabled={!serialSupported || busy || isConnected}>Connect</button>
          <button type="button" onClick={() => runConnection(disconnect)} disabled={busy || !isConnected}>Disconnect</button>
        </div>
        {errorMessage && <div><p role="alert">{errorMessage}</p><button type="button" onClick={() => { setLocalError(''); clearError() }}>Clear error</button></div>}
        {operation && <section className="operation-panel" aria-label="Current operation">
          <p role="status">{operation.label}{operation.total > 0 ? `: ${operation.completed} / ${operation.total}` : '…'}</p>
          <progress aria-label={operation.label} max={operation.total > 0 ? operation.total : 1} value={operation.total > 0 ? operation.completed : undefined} />
          <button type="button" onClick={cancelOperation}>Cancel operation</button>
        </section>}
      </section>
      <div className="transfer-grid">
        <UploadFile />
        <UploadFirmware />
      </div>
      <section className="panel secondary-panel" aria-labelledby="actions-heading">
        <h2 id="actions-heading">Device actions</h2>
        <p>Switch modes or request a restart. Reconnect after rebooting.</p>
        <div className="controls">
          <CommandButton label="FS Mode" command={triggerFsMode} disabled={busy} />
          <CommandButton label="REPL Mode" command={triggerReplMode} disabled={busy} />
          <CommandButton label="Reboot" command={reboot} disabled={busy} />
        </div>
      </section>
      <section className="panel secondary-panel" aria-labelledby="advanced-heading">
        <h2 id="advanced-heading">Advanced</h2>
        <p id="command-help">Runs immediately on the connected board. Use with care.</p>
        <label htmlFor="custom-command">MicroPython command</label>
        <div className="controls">
          <input id="custom-command" aria-describedby="command-help" type="text" value={msg} disabled={busy || !isConnected} onChange={e => setMsg(e.target.value)} />
          <CommandButton label="Send" command={msg} disabled={busy || !msg.trim()} />
        </div>
      </section>
    </main>
  )
}
