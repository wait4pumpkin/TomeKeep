import { useEffect, useState } from 'react'
import type { WishlistItem } from '../../electron/db'

export function Wishlist() {
  const [items, setItems] = useState<WishlistItem[]>([])
  const [isAdding, setIsAdding] = useState(false)
  const [newItem, setNewItem] = useState<Partial<WishlistItem>>({ priority: 'medium' })
  const [prices, setPrices] = useState<Record<string, string>>({})

  useEffect(() => {
    loadWishlist()
  }, [])

  async function loadWishlist() {
    const data = await window.db.getWishlist()
    setItems(data)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newItem.title || !newItem.author) return

    const itemToAdd = {
      ...newItem,
      id: crypto.randomUUID(),
      addedAt: new Date().toISOString(),
    } as WishlistItem

    await window.db.addWishlistItem(itemToAdd)
    setNewItem({ priority: 'medium' })
    setIsAdding(false)
    loadWishlist()
  }

  async function handleDelete(id: string) {
    if (confirm('Remove from wishlist?')) {
      await window.db.deleteWishlistItem(id)
      loadWishlist()
    }
  }

  async function checkPrice(item: WishlistItem) {
    if (!item.isbn) {
      alert('Please add ISBN to check price')
      return
    }
    // Mock price check
    setPrices(prev => ({ ...prev, [item.id]: 'Checking...' }))
    setTimeout(() => {
      const mockPrice = (Math.random() * 50 + 20).toFixed(2)
      setPrices(prev => ({ ...prev, [item.id]: `¥${mockPrice}` }))
    }, 1000)
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">Wishlist</h2>
        <button
          onClick={() => setIsAdding(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Add Item
        </button>
      </div>

      {isAdding && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h3 className="text-lg font-semibold mb-4">Add to Wishlist</h3>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input
                  type="text"
                  required
                  value={newItem.title || ''}
                  onChange={e => setNewItem({ ...newItem, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Author</label>
                <input
                  type="text"
                  required
                  value={newItem.author || ''}
                  onChange={e => setNewItem({ ...newItem, author: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ISBN</label>
                <input
                  type="text"
                  value={newItem.isbn || ''}
                  onChange={e => setNewItem({ ...newItem, isbn: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                <select
                  value={newItem.priority}
                  onChange={e => setNewItem({ ...newItem, priority: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-4">
        {items.map(item => (
          <div key={item.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex items-center justify-between hover:shadow-md transition-shadow">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1">
                <h3 className="font-semibold text-lg text-gray-900">{item.title}</h3>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  item.priority === 'high' ? 'bg-red-100 text-red-800' :
                  item.priority === 'medium' ? 'bg-blue-100 text-blue-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {item.priority}
                </span>
              </div>
              <p className="text-gray-600">{item.author}</p>
              <p className="text-sm text-gray-400 font-mono mt-1">{item.isbn}</p>
            </div>
            
            <div className="flex items-center gap-4">
              {prices[item.id] && (
                <span className="font-bold text-green-600">{prices[item.id]}</span>
              )}
              <button
                onClick={() => checkPrice(item)}
                className="px-3 py-1 text-sm bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100"
              >
                Check Price
              </button>
              <button
                onClick={() => handleDelete(item.id)}
                className="text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      {items.length === 0 && !isAdding && (
        <div className="text-center py-12 text-gray-500">
          Your wishlist is empty.
        </div>
      )}
    </div>
  )
}
