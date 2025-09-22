import {useRef} from 'react'
import {uploadFile} from '@/device'


export default function UploadFile() {
  const fileInput = useRef()

  const upload = event=>{
    event.preventDefault()

    const file = fileInput.current.files[0]

    if (file) {
      uploadFile(file)
    }

    return false
  }
  

  return <>
    <h3>Upload File</h3>
    <input type="file" ref={fileInput} />

    <button onClick={upload}>Upload</button>
  </>
}