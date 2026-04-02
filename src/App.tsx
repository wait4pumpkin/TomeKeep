import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { Layout } from './components/Layout'
import { Inventory } from './pages/Inventory'
import { Wishlist } from './pages/Wishlist'
import { LangProvider } from './lib/i18n'

// Restores and persists the last active page per user.
function PagePersistence() {
  const navigate = useNavigate()
  const location = useLocation()

  // On mount: navigate to the user's last active page
  useEffect(() => {
    void window.db.getActiveUser().then(user => {
      if (!user?.uiPrefs?.activePage) return
      const target = user.uiPrefs.activePage === 'wishlist' ? '/wishlist' : '/'
      if (location.pathname !== target) navigate(target, { replace: true })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // On route change: save the new active page
  useEffect(() => {
    void window.db.getActiveUser().then(user => {
      if (!user) return
      const page = location.pathname === '/wishlist' ? 'wishlist' : 'library'
      void window.db.setUiPrefs(user.id, { activePage: page })
    })
  }, [location.pathname])

  // On user switch: navigate to the new user's last active page
  useEffect(() => {
    function handleUserChange(e: Event) {
      const user = (e as CustomEvent<import('../electron/db').UserProfile | null>).detail
      if (!user) return
      const target = user.uiPrefs?.activePage === 'wishlist' ? '/wishlist' : '/'
      navigate(target, { replace: true })
    }
    window.addEventListener('active-user-changed', handleUserChange)
    return () => window.removeEventListener('active-user-changed', handleUserChange)
  }, [navigate])

  return null
}

function App() {
  return (
    <LangProvider>
      <HashRouter>
        <PagePersistence />
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
