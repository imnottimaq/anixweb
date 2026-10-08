import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
 
if (/^((?!chrome|android).)*safari/i.test(navigator.userAgent)) {
  document.documentElement.classList.add('browser-safari');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
