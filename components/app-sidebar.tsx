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
    <aside className="flex w-52 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="px-4 py-5">
        <span className="text-sm font-medium">Vending Outreach</span>
      </div>
      <nav className="flex flex-col gap-0.5 px-2">
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
