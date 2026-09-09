import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * The one page frame every screen uses, so margins, widths and the size of a
 * heading never drift apart from one screen to the next.
 */
export function Page({
  children,
  width = "default",
}: {
  children: ReactNode
  /**
   * `wide` suits a page with two columns of cards. `full` is for the Leads
   * table alone, which has eight columns and would otherwise spend its life
   * scrolled sideways on a laptop.
   */
  width?: "default" | "wide" | "full"
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-6 py-10",
        width === "full"
          ? "max-w-[1600px]"
          : width === "wide"
            ? "max-w-6xl"
            : "max-w-4xl"
      )}
    >
      {children}
    </div>
  )
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  /** A single button, shown on the right of the title. */
  action?: ReactNode
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-lg font-medium">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/** The dashed box shown where a list has nothing in it yet. */
export function EmptyState({
  title,
  children,
}: {
  title: string
  children?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && (
        <div className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  )
}
