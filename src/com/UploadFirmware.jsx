import {useRef} from 'react'
import {copyUF2} from '@/device'


export default function UploadFirmware() {
  const fileInput = useRef()

  const upload = event=>{
    event.preventDefault()

    const file = fileInput.current.files[0]

    if (file) {
      copyUF2(file)
    }

    return false
  }
  

  return <>
    <h3>Upload Firmware</h3>
    <input type="file" ref={fileInput} />

    <button onClick={upload}>Upload</button>
  </>
}