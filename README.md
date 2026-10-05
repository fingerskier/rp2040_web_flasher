# RP2040 Web Flasher

A browser-based tool for copying firmware and transferring individual files to RP2040 microcontrollers running **MicroPython**. CircuitPython is not supported. Files and serial traffic stay in your browser; there is no upload server.

**[Launch App](https://fingerskier.github.io/rp2040_web_flasher/)**

## Requirements

- Desktop Chrome or Edge with Web Serial support, on HTTPS or localhost
- RP2040-based device connected via a USB data cable
- MicroPython installed on the device for serial commands and file transfers
- File System Access (`showDirectoryPicker`) support to copy firmware from the browser

## Usage

1. **Connect** — Select the device's serial port. MicroPython operations interrupt a running program; save any important state first.
2. **Upload File** — Select one file, acknowledge replacement of a same-named file, and upload. This saves the file's bytes under its filename; it does **not** execute the file. Python, text, and binary files are supported. An upload of `main.py` changes what runs on the next boot.
3. **REPL Mode / custom commands** — Interrupt a program and interact with MicroPython. Commands verify the runtime and wait for a device response; silent devices and Python errors are failures, not successful sends. Only run commands you trust.
4. **Reboot** — Restart MicroPython. Resetting or unplugging a device ends its session; reconnect when it is available again.
5. **FS Mode** — Enter the RP2040 ROM bootloader. This ends the serial connection. Alternatively, hold **BOOTSEL** while plugging in the board.
6. **Upload Firmware** — Obtain the correct MicroPython `.uf2` for your exact board from [micropython.org/download](https://micropython.org/download/). Select it, then choose the mounted **RPI-RP2** drive. A serial connection is not required for this step.

### Transfer safety and limitations

- File uploads use acknowledged, bounded chunks and a temporary file before replacing the destination. A failed or cancelled transfer is not reported as success; reconnect after a connection-ending cancellation. An interrupted transfer can leave a temporary file requiring cleanup.
- Device operations are serialized and bound to their original connection. Disconnecting cancels pending work rather than silently continuing on another device.
- Reset and bootloader actions report a **request**, not verified startup. Reconnect and inspect the device after it restarts.
- Firmware copying checks UF2 structure, RP2040 family and the destination's `INFO_UF2.TXT`. **UF2 format does not prove that firmware is MicroPython or that it matches your exact board.** Use a trusted board-specific download.
- Copy completion means the browser finished writing, not that the firmware booted successfully. The drive normally disappears as the board reboots. A disappearing drive or write error cannot safely be treated as verified success; check the device and retry through BOOTSEL if needed.
- Browser/OS support for writing a bootloader volume varies. If the browser refuses the drive, copy the trusted UF2 using your operating system's file manager instead.
- Cancellation cannot undo firmware blocks already consumed by the bootloader. If native filesystem I/O does not settle safely, the app blocks further device work and asks you to reload before retrying; check the drive/device first.
- Logs are bounded and batched for responsiveness; older output may be discarded. The log is not a durable capture.
- The UI uses Web Serial. The WebUSB transport is an internal API, not a second connection button or a browser-support workaround.

## Development

```bash
npm ci --include=dev
npm run dev
```

Use Node.js **24.15 or newer** (CI uses Node 24) and `python3` for the generated-filesystem-command regression test. The test scripts explicitly select React's test environment, even when your shell exports `NODE_ENV=production`.

```bash
npm test          # protocol, lifecycle, firmware, log, UI, and asset regressions
npm run check    # lint + tests + production build
npm run preview  # serve the production build for browser checks
```

Tests use simulated transports/filesystems and do not flash real hardware. Hardware acceptance still requires a MicroPython RP2040: transfer and read back a binary file, reconnect after unplug/reset, cancel a transfer, and copy a known-good board-specific UF2. Do not use a board with irreplaceable data for initial validation.

The production page has a self-hosted Content Security Policy. Vite removes it only from the development HTML to support hot reload; check the production preview when testing CSP behavior.

## Deployment

```bash
npm run deploy
```
GitHub Actions runs lint, tests and build for pull requests and main; only main can deploy to Pages. The optional local `deploy` command also runs the full check first. `gh-pages` is a development-only tool; review `npm audit` findings separately from browser runtime dependencies (`npm audit --omit=dev`). Do not apply forced audit upgrades without checking behavior.
