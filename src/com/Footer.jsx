import { useMemo } from 'react'
import { useDevice } from '@/lib/DeviceContext'

export default function Footer() {
  const { getLogTail, isConnected } = useDevice()
  const logLines = useMemo(() => getLogTail(20), [getLogTail])

  return (
    <footer>
      <section>
        <h2>Device Log</h2>
        <pre>
          {logLines.length
            ? logLines.join('\n')
            : isConnected
              ? 'Awaiting data…'
              : 'Connect to a device to view logs.'}
        </pre>
      </section>
      <p>© 2024 fingerskier</p>
    </footer>
  )
}
