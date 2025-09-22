import { useRef } from 'react'
import { useDevice } from '@/lib/DeviceContext'

export default function UploadFile() {
  const fileInput = useRef()
  const { uploadFile, isConnected } = useDevice()

  const upload = async event => {
    event.preventDefault()

    const file = fileInput.current?.files?.[0]
    if (!file) return false

    try {
      await uploadFile(file)
    } catch (err) {
      console.error('Failed to upload file', err)
      alert(`Upload failed: ${err.message || err}`)
    }

    return false
  }

  return (
    <section>
      <h3>Upload File</h3>
      <input type="file" ref={fileInput} />
      <button type="button" onClick={upload} disabled={!isConnected}>
        Upload
      </button>
    </section>
  )
}
