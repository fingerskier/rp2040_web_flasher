import { useRef } from 'react'
import { useDevice } from '@/lib/DeviceContext'

export default function UploadFirmware() {
  const fileInput = useRef()
  const { copyUF2 } = useDevice()

  const upload = async event => {
    event.preventDefault()

    const file = fileInput.current?.files?.[0]
    if (!file) return false

    try {
      await copyUF2(file)
    } catch (err) {
      console.error('Failed to copy UF2 file', err)
      alert(`Firmware upload failed: ${err.message || err}`)
    }

    return false
  }

  return (
    <section>
      <h3>Upload Firmware</h3>
      <input type="file" ref={fileInput} accept=".uf2" />
      <button type="button" onClick={upload}>
        Upload
      </button>
    </section>
  )
}
