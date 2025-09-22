import { createContext, useCallback, useContext, useMemo, useReducer, useRef } from 'react'

const DeviceContext = createContext(null)

const MAX_LOG_LINES = 200
const SERIAL_BAUD_RATE = 115_200

const initialState = {
  transport: null,
  isConnecting: false,
  error: null,
  logs: [],
}

function reducer(state, action) {
  switch (action.type) {
    case 'CONNECT_START':
      return { ...state, isConnecting: true, error: null }
    case 'CONNECT_SUCCESS':
      return {
        ...state,
        isConnecting: false,
        error: null,
        transport: action.transport,
      }
    case 'CONNECT_FAILURE':
      return { ...state, isConnecting: false, error: action.error ?? null }
    case 'DISCONNECT':
      return {
        ...state,
        isConnecting: false,
        transport: null,
        error: action.error ?? null,
      }
    case 'APPEND_LOG_LINES': {
      if (!action.lines?.length) return state
      const combined = state.logs.concat(action.lines)
      const overflow = Math.max(0, combined.length - MAX_LOG_LINES)
      return { ...state, logs: overflow > 0 ? combined.slice(overflow) : combined }
    }
    case 'CLEAR_LOGS':
      return { ...state, logs: [] }
    default:
      return state
  }
}

const encoder = new TextEncoder()
const usbDecoder = new TextDecoder()

function resolveUsbInterface(device, options = {}) {
  const { interfaceNumber: preferredInterface, endpointIn: preferredIn, endpointOut: preferredOut } = options
  let interfaceNumber = preferredInterface
  let endpointIn = preferredIn
  let endpointOut = preferredOut

  const configuration = device.configuration
  if (!configuration) {
    throw new Error('USB device must be configured before resolving interfaces')
  }

  if (interfaceNumber !== undefined && endpointIn !== undefined && endpointOut !== undefined) {
    return { interfaceNumber, endpointIn, endpointOut }
  }

  for (const iface of configuration.interfaces ?? []) {
    for (const alternate of iface.alternates ?? []) {
      if (!alternate.endpoints?.length) continue
      const inEndpoint = alternate.endpoints.find(endpoint => endpoint.direction === 'in')
      const outEndpoint = alternate.endpoints.find(endpoint => endpoint.direction === 'out')
      if (!inEndpoint || !outEndpoint) continue

      interfaceNumber ??= iface.interfaceNumber
      endpointIn ??= inEndpoint.endpointNumber
      endpointOut ??= outEndpoint.endpointNumber
      if (interfaceNumber !== undefined && endpointIn !== undefined && endpointOut !== undefined) {
        return { interfaceNumber, endpointIn, endpointOut }
      }
    }
  }

  throw new Error('Unable to determine USB interface and endpoints. Provide interfaceNumber, endpointIn, and endpointOut.')
}

export function DeviceProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const transportRef = useRef(null)
  const usbReadActiveRef = useRef(false)
  const partialRef = useRef('')

  const appendLogLines = useCallback(lines => {
    dispatch({ type: 'APPEND_LOG_LINES', lines })
  }, [])

  const resetLogBuffer = useCallback(() => {
    partialRef.current = ''
    dispatch({ type: 'CLEAR_LOGS' })
  }, [])

  const startSerialReader = useCallback(reader => {
    partialRef.current = ''

    const loop = async() => {
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (!value) continue

          partialRef.current += value
          const segments = partialRef.current.split(/\r?\n/)
          partialRef.current = segments.pop() ?? ''
          if (segments.length) appendLogLines(segments)
        }
      } catch (error) {
        if (error?.name !== 'AbortError') {
          console.error('Serial read error', error)
          dispatch({ type: 'CONNECT_FAILURE', error })
        }
      } finally {
        if (partialRef.current) {
          appendLogLines([partialRef.current])
          partialRef.current = ''
        }
      }
    }

    loop()
  }, [appendLogLines])

  const startUsbReader = useCallback((device, endpointIn, packetSize = 64) => {
    partialRef.current = ''
    usbReadActiveRef.current = true

    const loop = async() => {
      try {
        while (usbReadActiveRef.current) {
          const result = await device.transferIn(endpointIn, packetSize)
          if (!usbReadActiveRef.current) break

          if (result?.status === 'stall') {
            await device.clearHalt('in', endpointIn)
            continue
          }

          if (result?.status === 'ok' && result.data) {
            partialRef.current += usbDecoder.decode(result.data)
            const segments = partialRef.current.split(/\r?\n/)
            partialRef.current = segments.pop() ?? ''
            if (segments.length) appendLogLines(segments)
          }
        }
      } catch (error) {
        if (usbReadActiveRef.current) {
          console.error('USB read error', error)
          dispatch({ type: 'CONNECT_FAILURE', error })
        }
      } finally {
        if (partialRef.current) {
          appendLogLines([partialRef.current])
          partialRef.current = ''
        }
        usbReadActiveRef.current = false
      }
    }

    loop()
  }, [appendLogLines])

  const disconnect = useCallback(async() => {
    const active = transportRef.current
    transportRef.current = null
    usbReadActiveRef.current = false

    try {
      if (!active) return
      if (active.type === 'serial') {
        await active.reader?.cancel()
        await active.writer?.close()
        await active.port?.close()
      } else if (active.type === 'usb') {
        if (active.device) {
          if (active.device.opened) {
            try {
              await active.device.releaseInterface(active.interfaceNumber)
            } catch (error) {
              console.warn('Failed to release USB interface', error)
            }
            await active.device.close()
          }
        }
      }
    } catch (error) {
      console.error('Error while disconnecting', error)
      dispatch({ type: 'DISCONNECT', error })
      throw error
    }

    dispatch({ type: 'DISCONNECT' })
  }, [])

  const connectSerial = useCallback(async(options = {}) => {
    dispatch({ type: 'CONNECT_START' })

    try {
      if (!('serial' in navigator)) {
        throw new Error('Web Serial API is not available in this browser')
      }

      const port = await navigator.serial.requestPort(options.requestPortOptions)
      await port.open({ baudRate: options.baudRate ?? SERIAL_BAUD_RATE, ...options.openOptions })
      const writer = port.writable?.getWriter() ?? null
      const reader = port.readable?.pipeThrough(new TextDecoderStream()).getReader() ?? null

      if (!reader || !writer) {
        throw new Error('Unable to obtain reader/writer for the serial port')
      }

      resetLogBuffer()
      transportRef.current = { type: 'serial', port, reader, writer }
      dispatch({
        type: 'CONNECT_SUCCESS',
        transport: {
          type: 'serial',
          info: typeof port.getInfo === 'function' ? port.getInfo() : undefined,
        },
      })

      startSerialReader(reader)
      return port
    } catch (error) {
      transportRef.current = null
      console.error('Failed to connect over Web Serial', error)
      dispatch({ type: 'CONNECT_FAILURE', error })
      throw error
    }
  }, [resetLogBuffer, startSerialReader])

  const connectUsb = useCallback(async(options = {}) => {
    dispatch({ type: 'CONNECT_START' })

    try {
      if (!('usb' in navigator)) {
        throw new Error('WebUSB API is not available in this browser')
      }

      const filters = options.filters ?? []
      const requestOptions = filters.length
        ? { filters }
        : { acceptAllDevices: options.acceptAllDevices ?? true }
      const device = await navigator.usb.requestDevice(requestOptions)

      await device.open()
      if (device.configuration == null) {
        await device.selectConfiguration(options.configurationValue ?? 1)
      }

      const { interfaceNumber, endpointIn, endpointOut } = resolveUsbInterface(device, options)
      await device.claimInterface(interfaceNumber)
      if (options.alternateSetting !== undefined) {
        await device.selectAlternateInterface(interfaceNumber, options.alternateSetting)
      }

      resetLogBuffer()
      transportRef.current = {
        type: 'usb',
        device,
        interfaceNumber,
        endpointIn,
        endpointOut,
        packetSize: options.packetSize ?? 64,
      }

      dispatch({
        type: 'CONNECT_SUCCESS',
        transport: {
          type: 'usb',
          productName: device.productName,
          manufacturerName: device.manufacturerName,
        },
      })

      startUsbReader(device, endpointIn, options.packetSize ?? 64)
      return device
    } catch (error) {
      transportRef.current = null
      console.error('Failed to connect over WebUSB', error)
      dispatch({ type: 'CONNECT_FAILURE', error })
      throw error
    }
  }, [resetLogBuffer, startUsbReader])

  const sendRaw = useCallback(async data => {
    const active = transportRef.current
    if (!active) throw new Error('Not connected to a device')

    if (typeof data !== 'string') {
      throw new Error('sendRaw expects string data')
    }

    const payload = encoder.encode(data)

    if (active.type === 'serial') {
      await active.writer.write(payload)
    } else if (active.type === 'usb') {
      if (!active.endpointOut) {
        throw new Error('USB OUT endpoint is not configured')
      }
      await active.device.transferOut(active.endpointOut, payload)
    } else {
      throw new Error(`Unsupported transport type: ${String(active.type)}`)
    }
  }, [])

  const sendCommand = useCallback(async cmd => {
    if (!cmd) return
    await sendRaw(`${cmd}\r`)
  }, [sendRaw])

  const triggerFsMode = useCallback(async() => {
    await sendRaw('\x03import machine\nmachine.bootloader()\n')
  }, [sendRaw])

  const triggerReplMode = useCallback(async() => {
    await sendRaw('\x03')
  }, [sendRaw])

  const reboot = useCallback(async() => {
    await sendRaw('\x03import machine\nmachine.reset()\n')
  }, [sendRaw])

  const copyUF2 = useCallback(async file => {
    const dir = await window.showDirectoryPicker({ mode: 'readwrite' })
    const handle = await dir.getFileHandle(file.name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(await file.arrayBuffer())
    await writable.close()
  }, [])

  const uploadFile = useCallback(async file => {
    const text = await file.text()
    await sendRaw('\x05')
    await sendRaw(text)
    await sendRaw('\x04')
  }, [sendRaw])

  const getLogTail = useCallback((count = MAX_LOG_LINES) => {
    if (!count || count < 0) return []
    return state.logs.slice(-count)
  }, [state.logs])

  const value = useMemo(() => {
    const isConnected = Boolean(state.transport)
    return {
      connect: connectSerial,
      connectSerial,
      connectUsb,
      disconnect,
      sendCommand,
      sendRaw,
      triggerFsMode,
      triggerReplMode,
      reboot,
      uploadFile,
      copyUF2,
      logs: state.logs,
      getLogTail,
      isConnected,
      isConnecting: state.isConnecting,
      error: state.error,
      transport: state.transport,
    }
  }, [connectSerial, connectUsb, disconnect, sendCommand, sendRaw, triggerFsMode, triggerReplMode, reboot, uploadFile, copyUF2, getLogTail, state.logs, state.transport, state.isConnecting, state.error])

  return (
    <DeviceContext.Provider value={value}>
      {children}
    </DeviceContext.Provider>
  )
}

export function useDevice() {
  const context = useContext(DeviceContext)
  if (!context) {
    throw new Error('useDevice must be used within a DeviceProvider')
  }
  return context
}

export default DeviceContext
