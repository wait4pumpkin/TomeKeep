// src/App.tsx
// Root component: BrowserRouter + auth guard + route definitions.

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { LangProvider } from './lib/i18n.tsx'
import { getStoredUser } from './lib/auth.ts'
import { Layout } from './components/Layout.tsx'
import { Login } from './pages/Login.tsx'
import { Register } from './pages/Register.tsx'
import { Inventory } from './pages/Inventory.tsx'
import { Wishlist } from './pages/Wishlist.tsx'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = getStoredUser()
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <LangProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<Inventory />} />
            <Route path="wishlist" element={<Wishlist />} />
          </Route>
          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </LangProvider>
  )
}
