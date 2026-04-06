// src/App.tsx
// Root component: BrowserRouter + auth guard + route definitions.
//
// Admin and regular-user sessions are completely separate:
//   /admin/*  — guarded by RequireAdmin (reads tk_admin key)
//   /         — guarded by RequireAuth  (reads tk_user  key)
// An admin who is logged into the admin backend is NOT considered logged in
// on the regular user side, and vice-versa.

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { LangProvider } from './lib/i18n.tsx'
import { getStoredUser, getStoredAdmin } from './lib/auth.ts'
import { Layout } from './components/Layout.tsx'
import { AdminLayout } from './components/AdminLayout.tsx'
import { Login } from './pages/Login.tsx'
import { AdminLogin } from './pages/AdminLogin.tsx'
import { Register } from './pages/Register.tsx'
import { Inventory } from './pages/Inventory.tsx'
import { Wishlist } from './pages/Wishlist.tsx'
import { Settings } from './pages/Settings.tsx'
import { Admin } from './pages/Admin.tsx'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = getStoredUser()          // returns null if not logged in OR is admin
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const admin = getStoredAdmin()        // returns null if not logged in OR is not admin
  if (!admin) return <Navigate to="/admin/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <LangProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/admin/login" element={<AdminLogin />} />

          {/* Admin backend — fully isolated shell */}
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <AdminLayout />
              </RequireAdmin>
            }
          >
            <Route index element={<Admin />} />
          </Route>

          {/* Regular user app */}
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
            <Route path="settings" element={<Settings />} />
          </Route>

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </LangProvider>
  )
}
