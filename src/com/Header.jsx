import logo from '@/assets/logo.png'


export default function Header() {
  return <header>
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <div className="brand">
      <img src={logo} className="logo" alt="RP2040" width="131" height="96" />
      <div>
        <h1>RP2040 Web Flasher</h1>
        <p>MicroPython device workbench</p>
      </div>
    </div>
  </header>
}