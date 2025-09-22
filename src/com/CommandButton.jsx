import React from 'react'
import { useDevice } from '@/lib/DeviceContext'

export default function CommandButton({ label, command }) {
  const { sendCommand, isConnected } = useDevice()

  const run = async event => {
    event.preventDefault()

    const handleError = err => {
      console.error('Error sending command:', err)
      alert(`Error sending command: ${err.message || err}`)
    }

    if (typeof command === 'string') {
      try {
        await sendCommand(command)
      } catch (err) {
        handleError(err)
      }
      return
    }

    if (typeof command === 'function') {
      try {
        await command()
      } catch (err) {
        handleError(err)
      }
      return
    }

    console.warn('CommandButton received unsupported command type:', typeof command)
  }

  return (
    <button type="button" onClick={run} disabled={!isConnected}>
      {label}
    </button>
  )
}
