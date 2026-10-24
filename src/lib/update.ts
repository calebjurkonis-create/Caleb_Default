import { useEffect, useState } from 'react'

/** The app's current build, from the script tag Vite writes (e.g. /assets/index-AbC123.js). */
function currentBuild(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')
  return s ? new URL(s.src).pathname : null
}

async function latestBuild(): Promise<string | null> {
  try {
    const res = await fetch(`/?check=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    return /\/assets\/index-[\w-]+\.js/.exec(await res.text())?.[0] ?? null
  } catch {
    return null
  }
}

/**
 * True once a newer version of KnockRoute is live. Phones keep home-screen apps paused in
 * memory, so without this people can stay on an old version for days. Checks when the app
 * comes back to the front and every 15 minutes. If the app was away 10+ minutes when a new
 * version is found, it simply reloads (nothing is mid-way then); otherwise it offers a button.
 */
export function useUpdateAvailable(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const mine = currentBuild()
    if (!mine) return // development server: nothing to compare
    let hiddenAt = 0
    const check = async (autoReload: boolean) => {
      const live = await latestBuild()
      if (!live || live === mine) return
      if (autoReload) location.reload()
      else setReady(true)
    }
    const onVisible = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now()
      else check(!!hiddenAt && Date.now() - hiddenAt > 10 * 60_000)
    }
    document.addEventListener('visibilitychange', onVisible)
    const t = setInterval(() => document.visibilityState === 'visible' && check(false), 15 * 60_000)
    check(false)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(t)
    }
  }, [])
  return ready
}
