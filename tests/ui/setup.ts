import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })

  window.scrollTo = () => {}

  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = window.ResizeObserver || (MockResizeObserver as unknown as typeof ResizeObserver)

  class MockIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.IntersectionObserver = window.IntersectionObserver || (MockIntersectionObserver as unknown as typeof IntersectionObserver)
}
