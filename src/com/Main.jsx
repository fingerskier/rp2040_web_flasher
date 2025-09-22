import React from 'react'
import CommandButton from '@/com/CommandButton'
import UploadFirmware from '@/com/UploadFirmware'
import UploadFile from '@/com/UploadFile'
import {
  connect, disconnect,
  triggerFsMode, triggerReplMode, reboot,
} from '@/device'


export default function Main() {
  return <main>
    <button type="button" onClick={connect}>Connect</button>

    <section>
      <h2> Basic Functions: </h2>
      <CommandButton label="FS Mode" command={triggerFsMode} />
      <CommandButton label="REPL Mode" command={triggerReplMode} />
      <CommandButton label="Reboot" command={reboot} />

      <UploadFirmware />
      <UploadFile />
    </section>

    <button type="button" onClick={disconnect}>Disconnect</button>
  </main>
}