/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createDeviceController } from './deviceController.js'
import { copyUF2 } from './firmware.js'

const DeviceContext = createContext(null)
const LogsContext = createContext(null)

export function DeviceProvider({ children }) {
  const [controller] = useState(() => createDeviceController({ copyFirmware: copyUF2 }))
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  // Cleanup is reusable, not a permanent dispose: StrictMode replays effects.
  useEffect(() => () => { void controller.disconnect() }, [controller])
  const value = useMemo(() => {
    const { logs: _logs, ...actions } = controller
    return { ...actions, ...state }
  }, [controller, state])
  return (
    <DeviceContext.Provider value={value}>
      <LogsContext.Provider value={controller.logs}>{children}</LogsContext.Provider>
    </DeviceContext.Provider>
  )
}

export function useDevice() {
  const context = useContext(DeviceContext)
  if (!context) throw new Error('useDevice must be used within a DeviceProvider')
  return context
}

export function useDeviceLogs() {
  const store = useContext(LogsContext)
  if (!store) throw new Error('useDeviceLogs must be used within a DeviceProvider')
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

export default DeviceContext
