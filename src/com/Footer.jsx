import {useEffect, useState} from 'react'
import {getLogTail} from '@/device'


export default function Footer() {
  const [log, setLog] = useState('')

  const refreshLog = async()=>{
    const newLog = getLogTail()
    setLog(newLog)
  }


  useEffect(()=>{
    const interval = setInterval(refreshLog, 1234)
    return ()=>clearInterval(interval)
  }, [])


  return <footer>
    <p>{JSON.stringify(log,null,2)}</p>
    <p>© 2024 fingerskier</p>
  </footer>
}
