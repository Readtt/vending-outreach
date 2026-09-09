"use client"

import { Button } from "@/components/ui/button"

/** The only interactive bit of the packet page. Hidden on the printed
 * output itself (`print:hidden`) — on paper this button obviously does
 * nothing. */
export function PrintButton() {
  return (
    <div className="mb-8 flex items-center justify-between gap-3 print:hidden">
      <p className="text-xs text-neutral-500">
        Press Ctrl+P (or Cmd+P), or use the button.
      </p>
      <Button size="sm" onClick={() => window.print()}>
        Print
      </Button>
    </div>
  )
}
