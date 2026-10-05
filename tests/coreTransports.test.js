import { it, expect, vi } from 'vitest'
import { openSerial, openUsb, resolveUsbInterface } from '../src/lib/deviceTransports.js'

it('rolls back partial serial setup and attempts every cleanup even on cancellation failure', async () => {
  const close = vi.fn(async () => {})
  const writer = { abort: vi.fn(async () => { throw Error('abort failed') }), releaseLock: vi.fn() }
  const port = { open: async () => {}, close, writable: { getWriter: () => writer }, readable: { getReader: () => { throw Error('reader setup failed') } } }
  await expect(openSerial({ serial: { requestPort: async () => port } })).rejects.toThrow('reader setup failed')
  expect(writer.abort).toHaveBeenCalled()
  expect(writer.releaseLock).toHaveBeenCalled()
  expect(close).toHaveBeenCalled()
})

it('selects endpoints from the same alternate and rejects mismatched overrides', () => {
  const device = { configuration: { interfaces: [{ interfaceNumber: 2, alternates: [{ alternateSetting: 1, endpoints: [{ direction: 'in', endpointNumber: 3, type: 'bulk' }, { direction: 'out', endpointNumber: 4, type: 'bulk' }] }] }] } }
  expect(resolveUsbInterface(device)).toMatchObject({ interfaceNumber: 2, alternateSetting: 1, endpointIn: 3, endpointOut: 4 })
  expect(() => resolveUsbInterface(device, { endpointIn: 8 })).toThrow()
})

it('requires USB filters and checks transferOut status and byte count', async () => {
  const requestDevice = vi.fn()
  await expect(openUsb({ usb: { requestDevice } })).rejects.toThrow(/filters/i)
  expect(requestDevice).not.toHaveBeenCalled()
  const device = { configuration: { interfaces: [{ interfaceNumber: 2, alternates: [{ alternateSetting: 1, endpoints: [{ direction: 'in', endpointNumber: 3, type: 'bulk' }, { direction: 'out', endpointNumber: 4, type: 'bulk' }] }] }] }, open: async () => {}, claimInterface: vi.fn(async () => {}), selectAlternateInterface: vi.fn(async () => {}), transferOut: async () => ({ status: 'ok', bytesWritten: 0 }), releaseInterface: vi.fn(async () => { throw Error('release') }), close: vi.fn(async () => {}) }
  const io = await openUsb({ usb: { requestDevice: async () => device } }, { filters: [{ vendorId: 1 }] })
  expect(device.selectAlternateInterface).toHaveBeenCalledWith(2, 1)
  await expect(io.write(new Uint8Array([1]))).rejects.toThrow(/transfer/i)
  await io.close()
  expect(device.releaseInterface).toHaveBeenCalled()
  expect(device.close).toHaveBeenCalled()
})
