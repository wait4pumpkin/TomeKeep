import { NavLink, Outlet } from 'react-router-dom'

export function Layout() {
  return (
    <div className="flex h-screen bg-gray-100">
      <aside className="w-64 bg-white shadow-md flex flex-col">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            📚 TomeKeep
          </h1>
        </div>
        <nav className="flex-1 px-4 space-y-2">
          <NavLink
            to="/"
            className={({ isActive }) =>
              `block px-4 py-2 rounded-lg transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-600 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              }`
            }
          >
            Inventory
          </NavLink>
          <NavLink
            to="/wishlist"
            className={({ isActive }) =>
              `block px-4 py-2 rounded-lg transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-600 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              }`
            }
          >
            Wishlist
          </NavLink>
        </nav>
        <div className="p-4 border-t border-gray-100">
          <p className="text-xs text-gray-400 text-center">v0.1.0 (MVP)</p>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  )
}
