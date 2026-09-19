/* Copyright (C) 2023-2026 QuantumNous
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import i18nReady from './i18n/config'

import './styles/index.css'

const root = document.querySelector('#root')
if (!root) {
  throw new Error('Missing application root')
}

await i18nReady

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
