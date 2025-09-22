import React from 'react'
import {sendCommand} from '@/device'


export default function CommandButton({label, command}) {
  const run = async(event)=>{
    event.preventDefault()

    // if command is a string, use `sendCommand`, otherwise call it as a function
    if (typeof command === 'string') {
      const res = await sendCommand(command).catch(err=>{
        console.error('Error sending command:', err)
        alert('Error sending command: ' + err.message)
      })
      return
    } else if (typeof command === 'function') {
      command().catch(err=>{
        console.error('Error sending command:', err)
        alert('Error sending command: ' + err.message)
      })
      return
    }

    return false
  }

  return <button onClick={run}>{label}</button>
}