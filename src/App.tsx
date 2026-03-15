import { HashRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Inventory } from './pages/Inventory'
import { Wishlist } from './pages/Wishlist'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Inventory />} />
          <Route path="wishlist" element={<Wishlist />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export default App
