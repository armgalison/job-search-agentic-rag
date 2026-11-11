import type { BaseWindow, BrowserWindow, BrowserWindowConstructorOptions, WebContents } from 'electron'

/**
 * Navigation policy for the LinkedIn window.
 *
 * - LinkedIn pages stay in the LinkedIn window.
 * - "Sign in with Apple/Microsoft/Google" opens a popup (window.open) that must stay connected to the page that
 *   opened it (window.opener / postMessage) to hand the login back. So those popups open as child windows of the
 *   LinkedIn window, in the same session — sending them to the system browser breaks the flow (blank page).
 *   Note: Google deliberately refuses sign-in inside embedded browsers ("This browser or app may not be secure");
 *   that is a security policy and is not worked around — the LinkedIn panel tells the user to use email + password.
 * - Anything else opens in the system browser.
 */

const LINKEDIN = /(^|\.)(linkedin\.com|licdn\.com)$/i
const SIGN_IN = [
  /^accounts\.google\.com$/i,
  /(^|\.)google\.com$/i, // accounts.google.com redirects through e.g. www.google.com/accounts, myaccount.google.com
  /(^|\.)gstatic\.com$/i,
  /(^|\.)googleusercontent\.com$/i,
  /^appleid\.apple\.com$/i,
  /^(login|account)\.live\.com$/i,
  /^login\.microsoftonline\.com$/i
]

const hostOf = (url: string): string | null => {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' ? u.hostname : null
  } catch {
    return null
  }
}

export const isLinkedIn = (url: string): boolean => {
  const h = hostOf(url)
  return !!h && LINKEDIN.test(h)
}

export const isSignInProvider = (url: string): boolean => {
  const h = hostOf(url)
  return !!h && SIGN_IN.some((re) => re.test(h))
}

export type OpenRoute = 'same-window' | 'popup' | 'external' | 'deny'

/**
 * What to do with a window.open / target=_blank from a LinkedIn or sign-in page.
 * `disposition` comes from Electron: 'new-window' = a scripted popup (window.open with features, as sign-in
 * buttons do), 'foreground-tab'/'background-tab' = an ordinary link that wants a new tab.
 */
export function routeWindowOpen(url: string, opts: { fromPopup?: boolean; disposition?: string } = {}): OpenRoute {
  const scriptedPopup = opts.disposition === 'new-window'
  if (url === 'about:blank') return 'popup' // some sign-in flows open a blank popup and then set its location
  if (isSignInProvider(url)) return 'popup'
  // A LinkedIn popup may be the first hop of "Sign in with Google" (it then redirects to Google): keep it a popup
  if (isLinkedIn(url)) return opts.fromPopup || scriptedPopup ? 'popup' : 'same-window'
  if (/^https?:\/\//i.test(url)) return 'external'
  return 'deny'
}

/** Whether an in-page navigation is allowed to proceed in the LinkedIn window or a sign-in popup. */
export function routeNavigation(url: string): 'allow' | 'external' | 'deny' {
  if (isLinkedIn(url) || isSignInProvider(url) || url === 'about:blank') return 'allow'
  if (/^https?:\/\//i.test(url)) return 'external'
  return 'deny'
}

export interface PolicyOptions {
  openExternal: (url: string) => void
  /** Window options for sign-in popups (they inherit the opener's session) */
  popupOptions?: BrowserWindowConstructorOptions
}

/**
 * What the address bar does with what the user typed:
 * - a LinkedIn address loads in the window ("linkedin.com/jobs" works without https://)
 * - another site's address opens in the system browser (same rule as links)
 * - anything else is a LinkedIn job search for those words
 */
export type AddressAction = { kind: 'load' | 'external'; url: string } | { kind: 'none' }

export function resolveAddress(input: string): AddressAction {
  const text = input.trim()
  if (!text) return { kind: 'none' }
  // Bare words with a dot ("node.js", "vue.js") are searches; an address needs a scheme, "www.", a path or linkedin.com
  const host = text.match(/^([^\s/]+\.[a-z]{2,})(?::\d+)?(\/\S*)?$/i)
  const looksLikeUrl =
    /^https?:\/\/\S+$/i.test(text) || (!!host && (/^www\./i.test(host[1]) || !!host[2] || /(^|\.)linkedin\.com$/i.test(host[1])))
  if (looksLikeUrl) {
    const url = /^https?:\/\//i.test(text) ? text : `https://${text}`
    try {
      const u = new URL(url)
      if (isLinkedIn(u.href.replace(/^http:/i, 'https:'))) return { kind: 'load', url: u.href.replace(/^http:/i, 'https:') }
      return { kind: 'external', url: u.href }
    } catch {
      /* not a valid address: treat it as a search */
    }
  }
  return { kind: 'load', url: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(text)}` }
}

/**
 * Wires the policy into a page and, recursively, into every popup it opens.
 * `parent` is the window popups are attached to (the LinkedIn window, or the popup that opened them).
 */
export function attachNavigationPolicy(wc: WebContents, parent: BaseWindow, opts: PolicyOptions, isPopup = false): void {
  wc.setWindowOpenHandler(({ url, disposition }) => {
    switch (routeWindowOpen(url, { fromPopup: isPopup, disposition })) {
      case 'same-window':
        void wc.loadURL(url)
        return { action: 'deny' }
      case 'popup':
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 520,
            height: 720,
            parent: parent as BrowserWindow,
            autoHideMenuBar: true,
            title: 'Sign in',
            ...opts.popupOptions
          }
        }
      case 'external':
        opts.openExternal(url)
        return { action: 'deny' }
      default:
        return { action: 'deny' }
    }
  })

  wc.on('will-navigate', (e, url) => {
    const r = routeNavigation(url)
    if (r === 'allow') return
    e.preventDefault()
    if (r === 'external') opts.openExternal(url)
  })

  wc.on('did-create-window', (child) => attachNavigationPolicy(child.webContents, child, opts, true))
}
