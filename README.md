# RP2040 Web Flasher

A browser-based tool for flashing and interacting with RP2040 microcontrollers running MicroPython or CircuitPython.

**[Launch App](https://fingerskier.github.io/rp2040_web_flasher/)**

## Requirements

- Chrome, Edge, or another browser with Web Serial API support
- RP2040-based device connected via USB

## Usage

1. **Connect** - Click the Connect button and select your RP2040 device from the browser prompt
2. **FS Mode** - Enter bootloader/filesystem mode to flash new firmware
3. **REPL Mode** - Access the MicroPython/CircuitPython REPL (sends Ctrl+C)
4. **Reboot** - Restart the device
5. **Upload Firmware** - Select a .uf2 file to copy to the device (requires FS Mode first)
6. **Upload File** - Upload Python or text files directly to the device
7. **Custom Commands** - Use the text input to send raw commands to the device

## Development

```bash
npm install
npm run dev
```

## Deployment

```bash
npm run deploy
```
