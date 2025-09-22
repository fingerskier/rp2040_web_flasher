import React from 'react'

import logo from '@/assets/logo.svg'


export default function Header() {
  return <header>
    <h1>
      <img src={logo} className="logo" alt="logo" />
      RP2040 Web Flasher
    </h1>
  </header>
}