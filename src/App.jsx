import { useState } from 'react'
import Header from './com/Header'
import Main from './com/Main'
import Footer from './com/Footer'

import './App.css'


export default function App() {
  const [count, setCount] = useState(0)

  return <>
    <Header />
    <Main />
    <Footer />
  </>
}