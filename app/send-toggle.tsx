"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { clearDryRunMessagesAction, setSendEnabledAction } from "./actions"

interface SendToggleProps {
  initialEnabled: boolean
  initialDryRunCount: number
}

export function SendToggle({
  initialEnabled,
  initialDryRunCount,
}: SendToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [dryRunCount, setDryRunCount] = useState(initialDryRunCount)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleCheckedChange(next: boolean) {
    if (next) {
      // Turning ON always goes through the confirmation dialog below —
      // never flips straight from a switch click.
      setConfirmOpen(true)
      return
    }
    startTransition(() => {
      setSendEnabledAction(false)
        .then(() => {
          setEnabled(false)
          toast.success(
            "Sending turned off. Drafts go to outbox-dryrun/ from now on."
          )
        })
        .catch((err: unknown) =>
          toast.error(
            err instanceof Error ? err.message : "Failed to turn sending off."
          )
        )
    })
  }

  function handleConfirmEnable() {
    startTransition(() => {
      setSendEnabledAction(true)
        .then(() => {
          setEnabled(true)
          setConfirmOpen(false)
          toast.success("Sending is live.")
        })
        .catch((err: unknown) =>
          toast.error(
            err instanceof Error ? err.message : "Failed to turn sending on."
          )
        )
    })
  }

  function handleClearDryRun() {
    startTransition(() => {
      clearDryRunMessagesAction()
        .then((count) => {
          setDryRunCount(0)
          toast.success(
            count > 0
              ? `Cleared ${count} rehearsal message${count === 1 ? "" : "s"}.`
              : "No rehearsal messages to clear."
          )
        })
        .catch((err: unknown) =>
          toast.error(
            err instanceof Error
              ? err.message
              : "Failed to clear rehearsal drafts."
          )
        )
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label htmlFor="send-enabled">Live sending</Label>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? "Real email is going out through your configured mailboxes."
              : "Dry run — nothing leaves this machine."}
          </p>
        </div>
        <Switch
          id="send-enabled"
          checked={enabled}
          onCheckedChange={handleCheckedChange}
          disabled={isPending}
        />
      </div>

      {!enabled && (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Nothing is being sent. Drafts are written to{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            outbox-dryrun/
          </code>{" "}
          as <code className="rounded bg-muted px-1 py-0.5 text-xs">.eml</code>{" "}
          files you can open in any mail client.
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Turn on live sending?</DialogTitle>
            <DialogDescription>
              Real email will go out through your configured mailboxes from now
              on.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-border px-3 py-2.5 text-sm">
            <p>
              {dryRunCount > 0 ? (
                <>
                  There {dryRunCount === 1 ? "is" : "are"}{" "}
                  <strong>
                    {dryRunCount} rehearsal message
                    {dryRunCount === 1 ? "" : "s"}
                  </strong>{" "}
                  sitting in <code className="text-xs">outbox-dryrun/</code>.
                </>
              ) : (
                "No rehearsal messages are sitting in outbox-dryrun/ right now."
              )}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Rehearsal and real sends use separate uniqueness keys, so leftover
              rehearsal drafts will not block a real send — clearing them is
              just tidying up, not required.
            </p>
            {dryRunCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={handleClearDryRun}
                disabled={isPending}
              >
                Clear rehearsal drafts
              </Button>
            )}
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancel
            </DialogClose>
            <Button onClick={handleConfirmEnable} disabled={isPending}>
              {isPending ? "Turning on…" : "Turn on live sending"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
