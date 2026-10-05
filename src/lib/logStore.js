// Keep one bounded text tail, including unterminated prompts. Publish independently
// of device state so high-volume output cannot rerender action/status consumers.
export function createLogStore({ maxChars = 32_768, maxLines = 200, batchMs = 16 } = {}) {
  let text = ''
  let timer = null
  const listeners = new Set()
  let snapshot = { logs: [], partial: '', clearLogs }
  function publish() {
    timer = null
    const lines = text.split('\n')
    snapshot = { logs: lines.slice(0, -1).map(line => line.replace(/\r$/, '')), partial: lines.at(-1), clearLogs }
    listeners.forEach(listener => listener())
  }
  function clearLogs() {
    clearTimeout(timer)
    text = ''
    publish()
  }
  return {
    append(chunk) {
      text = (text + String(chunk).slice(-maxChars)).slice(-maxChars)
      const lines = text.split('\n')
      if (lines.length > maxLines) text = lines.slice(-maxLines).join('\n')
      if (timer === null) timer = setTimeout(publish, batchMs)
    },
    clearLogs,
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
  }
}
