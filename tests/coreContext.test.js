// @vitest-environment jsdom
import { it, expect, vi } from 'vitest'
import { createElement, StrictMode } from 'react'
import { render, act, cleanup } from '@testing-library/react'
import { DeviceProvider, useDevice, useDeviceLogs } from '../src/lib/DeviceContext.jsx'

it('survives StrictMode effect replay, isolates log subscriptions, and releases on unmount', async () => {
  let controller, enqueue
  let renders = 0
  const close = vi.fn(async () => {})
  const readable = new ReadableStream({ start(c) { enqueue = value => c.enqueue(new TextEncoder().encode(value)) } })
  const writable = new WritableStream()
  Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort: async () => ({ open: async () => {}, close, readable, writable }) } })
  function Actions() { controller = useDevice(); renders++; return null }
  function Logs() { const snapshot = useDeviceLogs(); return createElement('pre', null, snapshot.partial) }
  const view = render(createElement(StrictMode, null, createElement(DeviceProvider, null, createElement(Actions), createElement(Logs))))
  await act(() => controller.connectSerial())
  expect(controller.isConnected).toBe(true)
  const before = renders
  await act(async () => { enqueue('prompt'); await new Promise(resolve => setTimeout(resolve, 25)) })
  expect(view.getByText('prompt')).toBeTruthy()
  expect(renders).toBe(before)
  cleanup()
  await new Promise(resolve => setTimeout(resolve, 25))
  expect(close).toHaveBeenCalledTimes(1)
})
