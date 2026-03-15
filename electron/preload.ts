import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
})

contextBridge.exposeInMainWorld('db', {
  getBooks: () => ipcRenderer.invoke('db:get-books'),
  addBook: (book: any) => ipcRenderer.invoke('db:add-book', book),
  updateBook: (book: any) => ipcRenderer.invoke('db:update-book', book),
  deleteBook: (id: string) => ipcRenderer.invoke('db:delete-book', id),
  getWishlist: () => ipcRenderer.invoke('db:get-wishlist'),
  addWishlistItem: (item: any) => ipcRenderer.invoke('db:add-wishlist-item', item),
  deleteWishlistItem: (id: string) => ipcRenderer.invoke('db:delete-wishlist-item', id),
})
