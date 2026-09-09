"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { approveLeadAction, getLeadDetailAction } from "./actions"
import {
  formatDateTime,
  LEAD_STATUS_BADGE_VARIANT,
  LEAD_STATUS_LABELS,
  type LeadDetail,
} from "./types"

interface LeadDetailDialogProps {
  /** Null closes the dialog. */
  leadId: string | null
  onOpenChange: (open: boolean) => void
}

/**
 * The outcome of the most recent fetch, tagged with which lead it's for —
 * same shape as `app/settings/role-model-picker.tsx`'s `FetchedModels`, and
 * for the same reason: it lets "loading" be derived (`fetched?.leadId !==
 * leadId`) instead of set synchronously inside the effect, which is what
 * `react-hooks/set-state-in-effect` wants.
 */
type FetchedDetail =
  | { leadId: string; status: "ok"; detail: LeadDetail }
  | { leadId: string; status: "error"; message: string }

export function LeadDetailDialog({
  leadId,
  onOpenChange,
}: LeadDetailDialogProps) {
  const [fetched, setFetched] = useState<FetchedDetail | null>(null)
  const [approving, startApproving] = useTransition()
  const [approved, setApproved] = useState<string | null>(null)

  const current =
    fetched && leadId && fetched.leadId === leadId ? fetched : undefined
  const loading = leadId !== null && current === undefined
  const detail = current?.status === "ok" ? current.detail : null
  const error = current?.status === "error" ? current.message : null

  useEffect(() => {
    if (!leadId) return
    let cancelled = false
    getLeadDetailAction(leadId)
      .then((result) => {
        if (cancelled) return
        setFetched(
          result
            ? { leadId, status: "ok", detail: result }
            : {
                leadId,
                status: "error",
                message: "This lead no longer exists.",
              }
        )
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setFetched({
          leadId,
          status: "error",
          message:
            err instanceof Error ? err.message : "Failed to load this lead.",
        })
      })
    return () => {
      cancelled = true
    }
  }, [leadId])

  return (
    <Dialog open={leadId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        {loading && !detail && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        )}
        {error && (
          <p className="py-8 text-center text-sm text-destructive">{error}</p>
        )}
        {detail && (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle>{detail.name ?? "Unnamed business"}</DialogTitle>
                <Badge variant={LEAD_STATUS_BADGE_VARIANT[detail.status]}>
                  {LEAD_STATUS_LABELS[detail.status]}
                </Badge>
              </div>
              <DialogDescription>
                {[detail.type, detail.address].filter(Boolean).join(" · ") ||
                  "No details on file yet."}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">Score</dt>
                <dd className="tabular-nums">{detail.score}</dd>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="truncate">{detail.email ?? "—"}</dd>
                <dt className="text-muted-foreground">Phone</dt>
                <dd>{detail.phone ?? "—"}</dd>
                <dt className="text-muted-foreground">Website</dt>
                <dd className="truncate">
                  {detail.website ? (
                    <a
                      href={detail.website}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      {detail.website}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </dl>

              {detail.fact && (
                <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                  <div className="text-xs text-muted-foreground">
                    Personalization fact
                    {detail.factCategory ? ` · ${detail.factCategory}` : ""}
                  </div>
                  <p className="mt-1">{detail.fact}</p>
                </div>
              )}

              {(detail.status === "held" || approved === detail.id) && (
                <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                  {approved === detail.id ? (
                    <p className="text-sm text-muted-foreground">
                      Approved. It will go out on the normal schedule.
                    </p>
                  ) : (
                    <>
                      <p className="text-sm font-medium">
                        Waiting for your approval
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        The draft below is written and queued, but nothing sends
                        until you release it.
                      </p>
                      <Button
                        size="sm"
                        className="mt-2.5"
                        disabled={approving}
                        onClick={() => {
                          const id = detail.id
                          startApproving(() => {
                            approveLeadAction(id)
                              .then(() => {
                                setApproved(id)
                                toast.success(
                                  "Approved — it will send on schedule."
                                )
                              })
                              .catch((err: unknown) =>
                                toast.error(
                                  err instanceof Error
                                    ? err.message
                                    : "Could not approve."
                                )
                              )
                          })
                        }}
                      >
                        {approving ? "Approving…" : "Approve and send"}
                      </Button>
                    </>
                  )}
                </div>
              )}

              <div>
                <h3 className="text-sm font-medium">Message thread</h3>
                {detail.messages.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    No messages yet.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-col gap-2">
                    {detail.messages.map((m) => (
                      <div
                        key={m.id}
                        className={
                          m.direction === "in"
                            ? "rounded-lg border border-border bg-background px-3 py-2 text-sm"
                            : "rounded-lg border border-transparent bg-muted/50 px-3 py-2 text-sm"
                        }
                      >
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>
                            {m.direction === "in" ? "Received" : "Sent"}
                            {m.dryRun ? " · rehearsal" : ""}
                          </span>
                          <span>{formatDateTime(m.sentAt ?? m.createdAt)}</span>
                        </div>
                        {m.subject && (
                          <div className="mt-1 font-medium">{m.subject}</div>
                        )}
                        {m.body && (
                          <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-medium">Activity</h3>
                {detail.events.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Nothing logged yet.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-col divide-y divide-border">
                    {detail.events.map((e) => (
                      <div
                        key={e.id}
                        className="flex items-center justify-between gap-2 py-1.5 text-sm"
                      >
                        <span>
                          {e.text}
                          {e.extra && (
                            <span className="text-muted-foreground">
                              {" "}
                              — {e.extra}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {formatDateTime(e.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
