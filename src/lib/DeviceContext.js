/**
 * This module provides a React context for managing RP2040 device-related state and actions.
 */
import React, { createContext, useContext, useState } from 'react'

let reader, writer, port


async function sendRaw(data) {
  console.log('Sending command:', data)
  if (!writer) throw new Error('Not connected')
  await writer.write(encoder.encode(data))
}

export function getLogTail(n) {
  return logLines.slice(-n).join('\n')
}

export async function sendCommand(cmd) {
  await sendRaw(cmd + '\r')
}

export async function triggerFsMode() {
  // Enter bootloader / mass storage mode
  await sendRaw('\x03import machine\nmachine.bootloader()\n')
}

export async function triggerReplMode() {
  // Send Ctrl-C to break to REPL
  await sendRaw('\x03')
}

export async function reboot() {
  await sendRaw('\x03import machine\nmachine.reset()\n')
}

export async function copyUF2(file) {
  const dir = await (window).showDirectoryPicker()
  const handle = await dir.getFileHandle(file.name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(await file.arrayBuffer())
  await writable.close()
}

export async function uploadPyFile(file) {
  const text = await file.text()
  // Enter paste mode Ctrl-E
  await sendRaw('\x05')
  await sendRaw(text)
  // Exit paste mode Ctrl-D
  await sendRaw('\x04')
}


// Create a context for device-related state and actions
const DeviceContext = createContext()

// Create a provider component
export function DeviceProvider({ children }) {
  const [device, setDevice] = useState(null)

  const connect = async() => {
    port = await (navigator).serial.requestPort()
    await port.open({ baudRate: 115200 })
    writer = port.writable?.getWriter() || null
    reader = port.readable?.pipeThrough(new TextDecoderStream()).getReader() || null
    readLoop()
    console.log('Connected to RP2040', port)
  }

  const disconnect = async() => {
    await reader?.cancel()
    reader = null
    await writer?.close()
    writer = null
    await port?.close()
    port = null
  }

  return (
    <DeviceContext.Provider value={{ device, connect, disconnect }}>
      {children}
    </DeviceContext.Provider>
  )
}

// Create a custom hook for accessing the device context
export function useDevice() {
  return useContext(DeviceContext)
}
// Export the context for potential direct use
export default DeviceContext