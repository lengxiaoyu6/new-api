/* Copyright (C) 2023-2026 QuantumNous
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
export function App() {
  return (
    <main className='mx-auto flex min-h-svh max-w-5xl flex-col px-6 py-8'>
      <header className='flex items-center gap-3 border-b border-neutral-200 pb-6'>
        <img src='/logo.png' alt='New API' width={40} height={40} />
        <div className='min-w-0'>
          <h1 className='text-2xl font-semibold break-words'>Appica</h1>
          <p className='text-sm text-neutral-600'>new-api</p>
        </div>
      </header>
      <footer className='mt-auto pt-8 text-xs text-neutral-600'>
        Copyright (C) 2023-2026 QuantumNous
      </footer>
    </main>
  )
}
