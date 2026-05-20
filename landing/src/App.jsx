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

export default function App() {
  return (
    <div style={{ background: '#060E1A', minHeight: '100vh' }}>
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
