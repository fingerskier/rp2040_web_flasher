import { useRef, useState } from 'react'
import { useDevice } from '@/lib/DeviceContext'

export default function CommandButton({ label, command, disabled = false }) {
  const { sendCommand, isConnected, isBusy, isConnecting, isDisconnecting } = useDevice()
  const inFlight = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const unavailable = disabled || !isConnected || isBusy || isConnecting || isDisconnecting || pending

  const run = async () => {
    if (unavailable || inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError('')
    setStatus('')
    try {
      const result = typeof command === 'string' ? await sendCommand(command) : await command()
      setStatus(result?.status === 'requested'
        ? `${label} requested. Reconnect when the board is ready; startup has not been verified.`
        : `${label} complete.`)
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || String(err))
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <div className="command-control">
      <button type="button" onClick={run} disabled={unavailable}>{label}</button>
      <span role="status">{status}</span>
      {error && <div><p role="alert">{error}</p><button type="button" onClick={() => setError('')}>Clear {label} error</button></div>}
    </div>
  )
}
