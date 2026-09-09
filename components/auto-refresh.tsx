"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

/**
 * Re-fetches the page's server data on a timer, so screens that watch the
 * engine stay current without anyone pressing reload.
 *
 * The engine works in a separate process and writes straight to SQLite, so
 * nothing about a finished job reaches an open browser tab on its own. Before
 * this, importing leads left the page frozen on "0 done" until a manual
 * refresh, which reads exactly like a broken app.
 *
 * `router.refresh()` re-renders the server components and leaves client state
 * alone — open dialogs, half-typed search boxes and scroll position all
 * survive it.
 */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter()

  useEffect(() => {
    const timer = setInterval(() => {
      // A background tab is not being read by anyone; polling it just spends
      // battery and hits SQLite for nothing.
      if (document.visibilityState === "visible") router.refresh()
    }, seconds * 1000)
    return () => clearInterval(timer)
  }, [router, seconds])

  return null
}
