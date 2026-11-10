import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

async function bootstrap() {
  // Outside Electron (npm run dev:web) there is no preload: use a mock API.
  if (!window.api) {
    const mock = await import('./mockApi')
    window.api = mock.createMockApi()
    Object.assign(window, { resetMock: mock.resetMock })
    console.info('[job-search-rag] Browser mode: mock API (data in localStorage). Run resetMock() to clear it.')
  }
  // App is imported afterwards because its modules read window.api on load
  const { default: App } = await import('./App')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void bootstrap()
