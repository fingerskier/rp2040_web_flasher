import { useRef, useState } from 'react'
import { useDevice } from '@/lib/DeviceContext'

export default function UploadFile() {
  const fileInput = useRef()
  const { uploadFile, isConnected, isBusy, isConnecting, isDisconnecting } = useDevice()
  const [selected, setSelected] = useState(false)
  const [overwrite, setOverwrite] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)
  const busy = pending || isBusy || isConnecting || isDisconnecting

  const upload = async event => {
    event.preventDefault()

    const file = fileInput.current?.files?.[0]
    if (!file || !overwrite || !isConnected || busy || inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError('')
    setStatus('')

    try {
      const result = await uploadFile(file)
      if (result?.status === 'success') {
        fileInput.current.value = ''
        setSelected(false)
        setOverwrite(false)
        setStatus(`Saved ${file.name}; not executed.`)
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || String(err))
      else setStatus('Save cancelled. File selection retained.')
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <section>
      <h3>Upload File</h3>
      <p>Save one file to MicroPython with its original filename. Saving does not execute it. Replacing main.py or boot.py changes startup behavior on the next reset.</p>
      <label>File to save <input type="file" ref={fileInput} disabled={busy || !isConnected} onChange={e => { setSelected(!!e.target.files?.length); setOverwrite(false); setStatus('') }} /></label>
      <label className="confirmation"><input type="checkbox" disabled={busy || !isConnected} checked={overwrite} onChange={e => setOverwrite(e.target.checked)} /> I agree to replace any existing file with the same name.</label>
      <button type="button" onClick={upload} disabled={!isConnected || busy || !selected || !overwrite}>Save file</button>
      <p role="status">{status}</p>
      {error && <div><p role="alert">{error}</p><button type="button" onClick={() => setError('')}>Clear file error</button></div>}
    </section>
  )
}
