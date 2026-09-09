"use client"

import { useTheme } from "next-themes"
import { HugeiconsIcon } from "@hugeicons/react"
import { Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"

/**
 * Light/dark switch for the sidebar.
 *
 * The app has always had the `d` keyboard shortcut for this, which nobody can
 * be expected to guess. A visible control is the discoverable version of it.
 *
 * Which label shows is decided by CSS off the `dark` class the theme provider
 * puts on `<html>`, not by React state. The server cannot know the browser's
 * theme, so anything state-driven has to render blank until it mounts; letting
 * CSS do it means the right label is painted on the very first frame.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="sm"
      className="justify-start gap-2 px-2.5 font-normal text-sidebar-foreground/70"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <span className="contents dark:hidden">
        <HugeiconsIcon icon={Moon02Icon} strokeWidth={2} className="size-4" />
        Dark mode
      </span>
      <span className="hidden dark:contents">
        <HugeiconsIcon icon={Sun03Icon} strokeWidth={2} className="size-4" />
        Light mode
      </span>
    </Button>
  )
}
