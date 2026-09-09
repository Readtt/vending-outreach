"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { ThemeToggle } from "@/components/theme-toggle"

const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/leads", label: "Leads" },
  { href: "/inbox", label: "Inbox" },
  { href: "/calls", label: "Calls" },
  { href: "/settings", label: "Settings" },
] as const

function AppSidebar() {
  const pathname = usePathname()

  return (
    // `sticky top-0` + a viewport height, rather than the page height the
    // flex row would otherwise stretch this to. Without it the theme toggle
    // sits at the bottom of the *content* — on Leads, five hundred rows down —
    // so reaching it meant scrolling the whole table.
    <aside className="sticky top-0 flex h-svh w-52 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="px-4 py-5">
        <span className="text-sm font-medium">Vending Outreach</span>
      </div>
      {/* Scrolls on its own in a short window, so a cramped viewport pushes
          the links behind a scrollbar instead of pushing the toggle off. */}
      <nav className="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-2">
        {NAV_LINKS.map((link) => {
          const isActive =
            link.href === "/"
              ? pathname === "/"
              : pathname.startsWith(link.href)
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm transition-colors",
                isActive
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              )}
            >
              {link.label}
            </Link>
          )
        })}
      </nav>
      <div className="mt-auto flex flex-col items-start p-2">
        <ThemeToggle />
      </div>
    </aside>
  )
}

export { AppSidebar }
