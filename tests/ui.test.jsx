// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UploadFile from '../src/com/UploadFile'
import UploadFirmware from '../src/com/UploadFirmware'
import Main from '../src/com/Main'
import Footer from '../src/com/Footer'
import CommandButton from '../src/com/CommandButton'
import Header from '../src/com/Header'

const { device, logState } = vi.hoisted(() => ({ device: {}, logState: {} }))
vi.mock('@/lib/DeviceContext', () => ({ useDevice: () => device, useDeviceLogs: () => logState }))
beforeEach(() => {
  Object.assign(device, { isConnected: true, isConnecting: false, isDisconnecting: false, isBusy: false,
    error: null, operation: null, connect: vi.fn(), disconnect: vi.fn(), uploadFile: vi.fn(), copyUF2: vi.fn(),
    sendCommand: vi.fn(), triggerFsMode: vi.fn(), triggerReplMode: vi.fn(), reboot: vi.fn(), cancelOperation: vi.fn(), clearError: vi.fn() })
  Object.assign(logState, { logs: [], partial: '', clearLogs: vi.fn() })
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('showDirectoryPicker', vi.fn())
  Object.defineProperty(navigator, 'serial', { configurable: true, value: {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('accessible page and log', () => {
  it('renders bounded log lines and the partial prompt with a clear control', async () => {
    logState.logs = Array.from({ length: 30 }, (_, i) => `line-${i}`)
    logState.partial = '>>> '
    render(<Footer />)
    const log = screen.getByRole('log', { name: 'Device log' })
    expect(log.textContent).not.toContain('line-9\n')
    expect(log.textContent).toContain('line-29\n>>> ')
    expect(log.tabIndex).toBe(0)
    await userEvent.click(screen.getByRole('button', { name: 'Clear logs' }))
    expect(logState.clearLogs).toHaveBeenCalledTimes(1)
  })
  it('reserves the logo aspect ratio and provides a skip link', () => {
    render(<Header />)
    const image = screen.getByRole('img', { name: 'RP2040' })
    expect(image.getAttribute('width')).toBe('131')
    expect(image.getAttribute('height')).toBe('96')
    expect(screen.getByRole('link', { name: 'Skip to main content' }).getAttribute('href')).toBe('#main-content')
  })
  it('makes the skip-link destination programmatically focusable', () => {
    render(<Main />)
    expect(screen.getByRole('main').tabIndex).toBe(-1)
    screen.getByRole('main').focus()
    expect(document.activeElement).toBe(screen.getByRole('main'))
  })
  it('warns that saving main.py changes startup behavior', () => {
    render(<UploadFile />)
    expect(screen.getByText(/main.py/).textContent).toMatch(/startup/i)
  })
})

describe('command controls', () => {
  it('does not claim a requested reset has completed or booted', async () => {
    device.reboot.mockResolvedValue({ status: 'requested' })
    render(<CommandButton label="Reboot" command={device.reboot} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reboot' }))
    expect(screen.getByRole('status').textContent).toContain('Reboot requested')
    expect(screen.getByRole('status').textContent).not.toContain('complete')
    expect(screen.getByRole('status').textContent).toContain('Reconnect')
  })
  it('locks synchronous duplicate commands and reports failures inline', async () => {
    let reject
    device.sendCommand.mockImplementation(() => new Promise((_, r) => { reject = r }))
    render(<CommandButton label="Send" command="print(1)" />)
    const button = screen.getByRole('button', { name: 'Send' })
    act(() => { fireEvent.click(button); fireEvent.click(button) })
    expect(device.sendCommand).toHaveBeenCalledTimes(1)
    expect(button.disabled).toBe(true)
    await act(async () => reject(new Error('Command failed')))
    expect(screen.getByRole('alert').textContent).toContain('Command failed')
    await userEvent.click(screen.getByRole('button', { name: 'Clear Send error' }))
    expect(screen.queryByRole('alert')).toBeNull()
    device.sendCommand.mockRejectedValue(new DOMException('Cancelled', 'AbortError'))
    await userEvent.click(button)
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('disables commands during a device operation', () => {
    device.isBusy = true
    render(<CommandButton label="Send" command="print(1)" />)
    expect(screen.getByRole('button', { name: 'Send' }).disabled).toBe(true)
  })
  it('reports function command success', async () => {
    render(<CommandButton label="Reboot" command={device.reboot} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reboot' }))
    expect(device.reboot).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toContain('Reboot complete')
  })
})

describe('connection and operation controls', () => {
  it.each(['insecure', 'no serial', 'busy', 'connecting', 'disconnecting'])('disables Connect when %s', reason => {
    device.isConnected = false
    if (reason === 'insecure') vi.stubGlobal('isSecureContext', false)
    if (reason === 'no serial') Object.defineProperty(navigator, 'serial', { configurable: true, value: undefined })
    if (reason === 'busy') device.isBusy = true
    if (reason === 'connecting') device.isConnecting = true
    if (reason === 'disconnecting') device.isDisconnecting = true
    render(<Main />)
    expect(screen.getByRole('button', { name: 'Connect' }).disabled).toBe(true)
    expect(screen.getByLabelText('MicroPython command').disabled).toBe(true)
  })
  it('shows progress and cancellation while disabling competing actions', async () => {
    device.isBusy = true
    device.operation = { label: 'Saving hello.py', completed: 5, total: 10 }
    render(<Main />)
    expect(screen.getByRole('progressbar', { name: 'Saving hello.py' }).value).toBe(5)
    expect(screen.getByRole('progressbar').max).toBe(10)
    expect(screen.getByRole('button', { name: 'Disconnect' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Reboot' }).disabled).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel operation' }))
    expect(device.cancelOperation).toHaveBeenCalledTimes(1)
  })
  it('shows and clears context errors', async () => {
    device.error = new Error('Device lost')
    render(<Main />)
    expect(screen.getByRole('alert').textContent).toContain('Device lost')
    await userEvent.click(screen.getByRole('button', { name: 'Clear error' }))
    expect(device.clearError).toHaveBeenCalledTimes(1)
  })
  it('locks connection submissions synchronously and reports failures inline', async () => {
    device.isConnected = false
    let reject
    device.connect.mockImplementation(() => new Promise((_, r) => { reject = r }))
    render(<Main />)
    const button = screen.getByRole('button', { name: 'Connect' })
    act(() => { fireEvent.click(button); fireEvent.click(button) })
    expect(device.connect).toHaveBeenCalledTimes(1)
    expect(button.disabled).toBe(true)
    await act(async () => reject(new Error('Port unavailable')))
    expect(screen.getByRole('alert').textContent).toContain('Port unavailable')
    await userEvent.click(screen.getByRole('button', { name: 'Clear error' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('firmware copy', () => {
  it('works disconnected, retains the picker selection on cancellation, resets on success', async () => {
    device.isConnected = false
    device.copyUF2.mockResolvedValueOnce({ status: 'cancelled' }).mockResolvedValueOnce({ status: 'success' })
    const user = userEvent.setup()
    render(<UploadFirmware />)
    const input = screen.getByLabelText('MicroPython firmware (.uf2)')
    await user.upload(input, new File(['firmware'], 'micropython.uf2'))
    const button = screen.getByRole('button', { name: 'Copy firmware' })
    expect(button.disabled).toBe(false)
    await user.click(button)
    expect(input.files.length).toBe(1)
    expect(screen.getByRole('status').textContent).toMatch(/cancelled/i)
    await user.click(button)
    expect(input.files.length).toBe(0)
    expect(screen.getByRole('status').textContent).toMatch(/copied/i)
    expect(screen.getByText(/UF2 cannot identify/i)).toBeTruthy()
    expect(screen.getByText(/BOOTSEL/).textContent).toContain('RPI-RP2')
  })
  it.each(['insecure', 'no picker', 'busy'])('disables firmware controls when %s', reason => {
    if (reason === 'insecure') vi.stubGlobal('isSecureContext', false)
    if (reason === 'no picker') vi.stubGlobal('showDirectoryPicker', undefined)
    if (reason === 'busy') device.isBusy = true
    render(<UploadFirmware />)
    expect(screen.getByLabelText('MicroPython firmware (.uf2)').disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Copy firmware' }).disabled).toBe(true)
  })
  it('locks duplicate copies and reports errors without clearing the file', async () => {
    let reject
    device.copyUF2.mockImplementation(() => new Promise((_, r) => { reject = r }))
    const user = userEvent.setup()
    render(<UploadFirmware />)
    const input = screen.getByLabelText('MicroPython firmware (.uf2)')
    await user.upload(input, new File(['firmware'], 'micropython.uf2'))
    const button = screen.getByRole('button', { name: 'Copy firmware' })
    act(() => { fireEvent.click(button); fireEvent.click(button) })
    expect(device.copyUF2).toHaveBeenCalledTimes(1)
    expect(input.disabled).toBe(true)
    await act(async () => reject(new Error('Copy failed')))
    expect(screen.getByRole('alert').textContent).toContain('Copy failed')
    expect(input.files.length).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Clear firmware error' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

const file = () => new File(['print(1)'], 'hello.py', { type: 'text/plain' })
describe('single file transfer', () => {
  it('retains selection on abort, reports errors inline and prevents duplicate saves', async () => {
    const user = userEvent.setup()
    let reject
    device.uploadFile.mockImplementation(() => new Promise((_, r) => { reject = r }))
    render(<UploadFile />)
    const input = screen.getByLabelText('File to save')
    await user.upload(input, file())
    await user.click(screen.getByRole('checkbox'))
    const button = screen.getByRole('button', { name: 'Save file' })
    act(() => { fireEvent.click(button); fireEvent.click(button) })
    expect(device.uploadFile).toHaveBeenCalledTimes(1)
    expect(input.disabled).toBe(true)
    await act(async () => reject(new DOMException('Cancelled', 'AbortError')))
    expect(input.files.length).toBe(1)
    expect(screen.queryByRole('alert')).toBeNull()
    device.uploadFile.mockRejectedValue(new Error('Transfer failed'))
    await user.click(button)
    expect(screen.getByRole('alert').textContent).toContain('Transfer failed')
    await user.click(screen.getByRole('button', { name: 'Clear file error' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(input.files.length).toBe(1)
  })
  it('disables file controls while device is busy', () => {
    device.isBusy = true
    render(<UploadFile />)
    expect(screen.getByLabelText('File to save').disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Save file' }).disabled).toBe(true)
  })
  it('requires explicit overwrite consent, saves original file and only resets on success', async () => {
    const user = userEvent.setup()
    device.uploadFile.mockResolvedValue({ status: 'success', name: 'hello.py', bytes: 8 })
    render(<UploadFile />)
    const input = screen.getByLabelText('File to save')
    await user.upload(input, file())
    expect(screen.getByRole('button', { name: 'Save file' }).disabled).toBe(true)
    await user.click(screen.getByRole('checkbox', { name: /replace any existing file/i }))
    await user.click(screen.getByRole('button', { name: 'Save file' }))
    expect(device.uploadFile.mock.calls[0][0].name).toBe('hello.py')
    expect(input.files.length).toBe(0)
    expect(screen.getByRole('status').textContent).toMatch(/Saved hello.py.*not executed/i)
  })
})
