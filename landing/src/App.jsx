import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Nav        from './components/Nav'
import Hero       from './sections/Hero'
import Ticker     from './sections/Ticker'
import WhatYouGet from './sections/WhatYouGet'
import Comparison from './sections/Comparison'
import HowItWorks from './sections/HowItWorks'
import Pricing    from './sections/Pricing'
import ComingSoon from './sections/ComingSoon'
import FinalCTA   from './sections/FinalCTA'
import Footer     from './sections/Footer'
import Terms      from './pages/Terms'
import Privacy    from './pages/Privacy'

function Home() {
  return (
    <div style={{ background: '#06080D', minHeight: '100vh' }}>
      <Nav />
      <Hero />
      <Ticker />
      <WhatYouGet />
      <Comparison />
      <HowItWorks />
      <Pricing />
      <ComingSoon />
      <FinalCTA />
      <Footer />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"        element={<Home />} />
        <Route path="/terms"   element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
      </Routes>
    </BrowserRouter>
  )
}
