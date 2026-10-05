import { useDeviceLogs } from '@/lib/DeviceContext'

export default function Footer() {
  const { logs, partial, clearLogs } = useDeviceLogs()
  const logLines = logs.slice(-20)
  const text = [...logLines, ...(partial ? [partial] : [])].join('\n')

  return (
    <footer>
      <section className="device-log">
        <h2 id="device-log-heading">Device log</h2>
        <button type="button" onClick={clearLogs}>Clear logs</button>
        <pre role="log" aria-labelledby="device-log-heading" aria-live="polite" aria-relevant="additions text" tabIndex={0}>{text || 'No device output yet.'}</pre>
      </section>
      <p>© 2025 fingerskier</p>
    </footer>
  )
}
