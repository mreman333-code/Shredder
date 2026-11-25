import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { loadInitialStore } from './blend/storage'
import './styles.css'

async function start() {
  const initial = await loadInitialStore()
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App initial={initial} />
    </React.StrictMode>,
  )
}

void start()
