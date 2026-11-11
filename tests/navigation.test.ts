import { describe, expect, it } from 'vitest'
import { resolveAddress, routeNavigation, routeWindowOpen } from '../src/main/linkedin/navigation'

describe('LinkedIn window navigation policy', () => {
  it('opens "Sign in with Google/Apple/Microsoft" popups inside the app (not the system browser)', () => {
    expect(routeWindowOpen('https://accounts.google.com/gsi/select?client_id=x', { disposition: 'new-window' })).toBe('popup')
    expect(routeWindowOpen('https://accounts.google.com/o/oauth2/v2/auth?x=1')).toBe('popup')
    expect(routeWindowOpen('https://appleid.apple.com/auth/authorize')).toBe('popup')
    expect(routeWindowOpen('https://login.microsoftonline.com/common/oauth2')).toBe('popup')
    expect(routeWindowOpen('about:blank', { disposition: 'new-window' })).toBe('popup')
  })

  it('keeps a scripted LinkedIn popup as a popup (first hop of the Google sign-in), but ordinary links in the window', () => {
    expect(routeWindowOpen('https://www.linkedin.com/uas/login-submit', { disposition: 'new-window' })).toBe('popup')
    expect(routeWindowOpen('https://www.linkedin.com/jobs/view/1/', { disposition: 'foreground-tab' })).toBe('same-window')
    expect(routeWindowOpen('https://www.linkedin.com/feed/', { fromPopup: true })).toBe('popup')
  })

  it('sends other sites to the system browser and denies non-web schemes', () => {
    expect(routeWindowOpen('https://example.com/careers', { disposition: 'foreground-tab' })).toBe('external')
    expect(routeWindowOpen('http://accounts.google.com/')).toBe('external') // sign-in only over https
    expect(routeWindowOpen('javascript:alert(1)')).toBe('deny')
    expect(routeWindowOpen('https://evilgoogle.com/')).toBe('external')
  })

  it('lets the window and popups navigate through LinkedIn and sign-in providers only', () => {
    expect(routeNavigation('https://accounts.google.com/signin/v2/identifier')).toBe('allow')
    expect(routeNavigation('https://www.linkedin.com/checkpoint/lg/login-submit')).toBe('allow')
    expect(routeNavigation('https://www.google.com/accounts/SetSID')).toBe('allow')
    expect(routeNavigation('https://example.com/')).toBe('external')
    expect(routeNavigation('file:///etc/passwd')).toBe('deny')
  })
})

describe('LinkedIn window address bar', () => {
  it('loads LinkedIn addresses in the window, with or without https://', () => {
    expect(resolveAddress('https://www.linkedin.com/jobs/view/123/')).toEqual({ kind: 'load', url: 'https://www.linkedin.com/jobs/view/123/' })
    expect(resolveAddress('linkedin.com/jobs')).toEqual({ kind: 'load', url: 'https://linkedin.com/jobs' })
    expect(resolveAddress('  http://www.linkedin.com/feed/ ')).toEqual({ kind: 'load', url: 'https://www.linkedin.com/feed/' })
  })

  it('opens other sites in the system browser', () => {
    expect(resolveAddress('example.com/careers')).toEqual({ kind: 'external', url: 'https://example.com/careers' })
    expect(resolveAddress('https://evil-linkedin.com/')).toEqual({ kind: 'external', url: 'https://evil-linkedin.com/' })
  })

  it('turns plain words into a LinkedIn job search, and ignores blank input', () => {
    expect(resolveAddress('senior react developer')).toEqual({
      kind: 'load',
      url: 'https://www.linkedin.com/jobs/search/?keywords=senior%20react%20developer'
    })
    expect(resolveAddress('node.js')).toEqual({ kind: 'load', url: 'https://www.linkedin.com/jobs/search/?keywords=node.js' })
    expect(resolveAddress('www.example.com')).toEqual({ kind: 'external', url: 'https://www.example.com/' })
    expect(resolveAddress('   ')).toEqual({ kind: 'none' })
  })
})
