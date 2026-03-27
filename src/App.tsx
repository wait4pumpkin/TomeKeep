import { HashRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Inventory } from './pages/Inventory'
import { Wishlist } from './pages/Wishlist'
import { LangProvider } from './lib/i18n'

function App() {
  return (
    <LangProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Inventory />} />
            <Route path="wishlist" element={<Wishlist />} />
          </Route>
        </Routes>
      </HashRouter>
    </LangProvider>
  )
}

export default App
