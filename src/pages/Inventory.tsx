import { useEffect, useState } from 'react'
import type { Book } from '../../electron/db'

export function Inventory() {
  const [books, setBooks] = useState<Book[]>([])
  const [isAdding, setIsAdding] = useState(false)
  const [newBook, setNewBook] = useState<Partial<Book>>({ status: 'unread' })

  useEffect(() => {
    loadBooks()
  }, [])

  async function loadBooks() {
    const data = await window.db.getBooks()
    setBooks(data)
  }

  async function handleAddBook(e: React.FormEvent) {
    e.preventDefault()
    if (!newBook.title || !newBook.author) return

    const bookToAdd = {
      ...newBook,
      id: crypto.randomUUID(),
      addedAt: new Date().toISOString(),
    } as Book

    await window.db.addBook(bookToAdd)
    setNewBook({ status: 'unread' })
    setIsAdding(false)
    loadBooks()
  }

  async function handleDelete(id: string) {
    if (confirm('Are you sure you want to delete this book?')) {
      await window.db.deleteBook(id)
      loadBooks()
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">My Library</h2>
        <button
          onClick={() => setIsAdding(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Add Book
        </button>
      </div>

      {isAdding && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h3 className="text-lg font-semibold mb-4">Add New Book</h3>
          <form onSubmit={handleAddBook} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input
                  type="text"
                  required
                  value={newBook.title || ''}
                  onChange={e => setNewBook({ ...newBook, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Author</label>
                <input
                  type="text"
                  required
                  value={newBook.author || ''}
                  onChange={e => setNewBook({ ...newBook, author: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ISBN</label>
                <input
                  type="text"
                  value={newBook.isbn || ''}
                  onChange={e => setNewBook({ ...newBook, isbn: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={newBook.status}
                  onChange={e => setNewBook({ ...newBook, status: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="unread">Unread</option>
                  <option value="reading">Reading</option>
                  <option value="read">Read</option>
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
                Save Book
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {books.map(book => (
          <div key={book.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-semibold text-lg text-gray-900 line-clamp-1" title={book.title}>
                {book.title}
              </h3>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                book.status === 'read' ? 'bg-green-100 text-green-800' :
                book.status === 'reading' ? 'bg-yellow-100 text-yellow-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                {book.status}
              </span>
            </div>
            <p className="text-gray-600 mb-4">{book.author}</p>
            <div className="flex justify-between items-center text-sm text-gray-500">
              <span>{book.isbn || 'No ISBN'}</span>
              <button
                onClick={() => handleDelete(book.id)}
                className="text-red-500 hover:text-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      
      {books.length === 0 && !isAdding && (
        <div className="text-center py-12 text-gray-500">
          No books in your library yet. Click "Add Book" to get started!
        </div>
      )}
    </div>
  )
}
