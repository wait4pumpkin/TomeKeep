import { BrowserWindow, ipcMain, session, shell } from 'electron'

export type StoreChannel = 'jd' | 'bookschina' | 'dangdang'

export function setupStores() {
  ipcMain.handle('stores:open-login', async (_event, channel: StoreChannel) => {
    const { url } = getStoreConfig(channel)
    const win = new BrowserWindow({
      width: 1100,
      height: 850,
      webPreferences: {
        partition: getStoresPartition(),
      },
    })
    await win.loadURL(url)
    return true
  })

  ipcMain.handle('stores:open-page', async (_event, url: string) => {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return { ok: false, error: 'invalid_url' } as const
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    const allowed =
      host === 'www.bookschina.com' ||
      host === 'm.bookschina.com' ||
      host.endsWith('.bookschina.com') ||
      host === 'passport.jd.com' ||
      host === 'search.jd.com' ||
      host === 'item.jd.com' ||
      host.endsWith('.jd.com') ||
      host === 'login.dangdang.com' ||
      host === 'search.dangdang.com' ||
      host === 'product.dangdang.com' ||
      host.endsWith('.dangdang.com')
    if (!allowed) return { ok: false, error: 'not_allowed' } as const

    const win = new BrowserWindow({
      width: 1100,
      height: 850,
      webPreferences: {
        partition: getStoresPartition(),
      },
    })
    await win.loadURL(url)
    return { ok: true } as const
  })

  ipcMain.handle('stores:get-status', async (_event, channel: StoreChannel) => {
    const ses = session.fromPartition(getStoresPartition())
    const { cookieDomains, cookieUrls } = getStoreConfig(channel)

    const byUrlCounts = await Promise.all(cookieUrls.map(u => ses.cookies.get({ url: u }).then(c => c.length)))
    if (byUrlCounts.some(n => n > 0)) return { ok: true, loggedIn: true } as const

    const candidates = cookieDomains.flatMap(d => [d, d.replace(/^\./, '')])
    const byDomainCounts = await Promise.all(candidates.map(d => ses.cookies.get({ domain: d }).then(c => c.length)))
    return { ok: true, loggedIn: byDomainCounts.some(n => n > 0) } as const
  })

  ipcMain.handle('stores:clear-cookies', async (_event, channel: StoreChannel) => {
    const ses = session.fromPartition(getStoresPartition())
    const { cookieDomains } = getStoreConfig(channel)

    for (const domain of cookieDomains) {
      const cookies = await ses.cookies.get({ domain })
      for (const cookie of cookies) {
        const httpsUrl = `https://${cookie.domain?.replace(/^\./, '') ?? domain}${cookie.path ?? '/'}`
        const httpUrl = `http://${cookie.domain?.replace(/^\./, '') ?? domain}${cookie.path ?? '/'}`
        await ses.cookies.remove(httpsUrl, cookie.name)
        await ses.cookies.remove(httpUrl, cookie.name)
      }
    }
    return { ok: true } as const
  })

  ipcMain.handle('app:open-external', async (_event, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { ok: false, error: 'invalid_url' } as const
    await shell.openExternal(url)
    return { ok: true } as const
  })
}

export function getStoresPartition(): string {
  return 'persist:bookstores'
}

function getStoreConfig(channel: StoreChannel): { url: string; cookieDomains: string[]; cookieUrls: string[] } {
  switch (channel) {
    case 'jd':
      return {
        url: 'https://passport.jd.com/new/login.aspx',
        cookieDomains: ['.jd.com', '.passport.jd.com', 'passport.jd.com', 'search.jd.com', 'item.jd.com'],
        cookieUrls: ['https://passport.jd.com/', 'https://search.jd.com/', 'https://item.jd.com/', 'https://www.jd.com/'],
      }
    case 'bookschina':
      return {
        url: 'https://www.bookschina.com/RegUser/login.aspx',
        cookieDomains: ['.bookschina.com', 'www.bookschina.com', 'm.bookschina.com'],
        cookieUrls: ['https://www.bookschina.com/', 'https://m.bookschina.com/'],
      }
    case 'dangdang':
      return {
        url: 'https://login.dangdang.com/signin.aspx',
        cookieDomains: ['.dangdang.com', 'login.dangdang.com', 'search.dangdang.com', 'product.dangdang.com'],
        cookieUrls: ['https://login.dangdang.com/', 'https://search.dangdang.com/', 'https://product.dangdang.com/'],
      }
  }
}
