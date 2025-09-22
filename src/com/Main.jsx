import React from 'react'
import CommandButton from '@/com/CommandButton'
import UploadFirmware from '@/com/UploadFirmware'
import UploadFile from '@/com/UploadFile'
import { useDevice } from '@/lib/DeviceContext'

export default function Main() {
  const {
    connect,
    disconnect,
    triggerFsMode,
    triggerReplMode,
    reboot,
    isConnected,
    isConnecting,
    error,
  } = useDevice()

  const handleConnect = async event => {
    event.preventDefault()
    try {
      await connect()
    } catch (err) {
      console.error('Error connecting to device:', err)
      alert(`Unable to connect: ${err.message || err}`)
    }
  }

  const handleDisconnect = async event => {
    event.preventDefault()
    try {
      await disconnect()
    } catch (err) {
      console.error('Error disconnecting from device:', err)
      alert(`Unable to disconnect: ${err.message || err}`)
    }
  }

  return (
    <main>
      <section>
        <h2>Connection</h2>
        <p>Status: {isConnected ? 'Connected' : isConnecting ? 'Connecting…' : 'Disconnected'}</p>
        <div>
          <button type="button" onClick={handleConnect} disabled={isConnecting || isConnected}>
            Connect
          </button>
          <button type="button" onClick={handleDisconnect} disabled={!isConnected}>
            Disconnect
          </button>
        </div>
        {error && <p role="alert">{`Error: ${error.message || error}`}</p>}
      </section>

      <section>
        <h2>Basic Functions:</h2>
        <CommandButton label="FS Mode" command={triggerFsMode} />
        <CommandButton label="REPL Mode" command={triggerReplMode} />
        <CommandButton label="Reboot" command={reboot} />

        <UploadFirmware />
        <UploadFile />
      </section>
    </main>
  )
}
