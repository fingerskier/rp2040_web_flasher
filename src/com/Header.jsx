import logo from '@/assets/logo.png'


export default function Header() {
  return <header>
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <h1>
      <img src={logo} className="logo" alt="RP2040" width="131" height="96" />
      RP2040 Web Flasher
    </h1>
  </header>
}