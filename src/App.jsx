import Header from '@/com/Header'
import Main from '@/com/Main'
import Footer from '@/com/Footer'
import { DeviceProvider } from '@/lib/DeviceContext'

import './App.css'


export default function App() {
  return (
    <DeviceProvider>
      <Header />
      <Main />
      <Footer />
    </DeviceProvider>
  )
}