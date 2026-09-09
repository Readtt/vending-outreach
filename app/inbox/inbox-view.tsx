"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { setThreadOutcomeAction } from "./actions"
import { formatDateTime, type ThreadDetail, type ThreadOutcome } from "./types"

interface InboxViewProps {
  threads: ThreadDetail[]
}

export function InboxView({ threads }: InboxViewProps) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState<string | null>(
    threads[0]?.leadId ?? null
  )
  const [actingId, setActingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (threads.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-16 text-center">
        <p className="text-sm font-medium">Nothing needs you right now.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Every reply the bot could handle on its own, it did — this list only
          ever holds the ones it couldn&apos;t.
        </p>
      </div>
    )
  }

  const selected = threads.find((t) => t.leadId === selectedId) ?? threads[0]

  function handleOutcome(
    leadId: string,
    outcome: ThreadOutcome,
    label: string
  ) {
    setActingId(leadId)
    startTransition(() => {
      setThreadOutcomeAction(leadId, outcome)
        .then(() => {
          toast.success(`Marked ${label}.`)
          router.refresh()
        })
        .catch((err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Failed to update.")
        )
        .finally(() => setActingId(null))
    })
  }

  const originalSubject =
    selected.messages.find((m) => m.subject)?.subject ?? selected.name
  const mailtoHref = selected.email
    ? `mailto:${selected.email}?subject=${encodeURIComponent(`Re: ${originalSubject ?? "your inquiry"}`)}`
    : null

  const busy = isPending && actingId === selected.leadId

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,300px)_1fr]">
      <div className="flex flex-col gap-1.5">
        {threads.map((t) => (
          <button
            key={t.leadId}
            type="button"
            onClick={() => setSelectedId(t.leadId)}
            className={cn(
              "flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
              t.leadId === selected.leadId
                ? "border-primary/40 bg-primary/5"
                : "border-border hover:bg-muted/50"
            )}
          >
            <span className="font-medium">{t.name ?? "Unnamed business"}</span>
            <span className="truncate text-xs text-muted-foreground">
              {t.latestInboundSnippet || "No reply text on file."}
            </span>
            <span className="text-xs text-muted-foreground">
              {t.messageCount} message{t.messageCount === 1 ? "" : "s"}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-medium">
              {selected.name ?? "Unnamed business"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {[selected.type, selected.phone, selected.email]
                .filter(Boolean)
                .join(" · ") || "No contact details on file."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Escalated: {selected.escalationReason ?? "Flagged for you"}
            </p>
          </div>
          {mailtoHref && (
            <a
              href={mailtoHref}
              className="shrink-0 text-xs text-primary underline underline-offset-2"
            >
              Reply in your mail client
            </a>
          )}
        </div>

        <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          {selected.messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No messages on file.
            </p>
          ) : (
            selected.messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "max-w-[85%] rounded-lg border px-3 py-2 text-sm",
                  m.direction === "in"
                    ? "self-start border-border bg-background"
                    : "self-end border-transparent bg-primary/10"
                )}
              >
                <div className="text-xs text-muted-foreground">
                  {m.direction === "in" ? "Them" : "You"} ·{" "}
                  {formatDateTime(m.sentAt ?? m.createdAt)}
                </div>
                {m.subject && (
                  <div className="mt-0.5 font-medium">{m.subject}</div>
                )}
                {m.body && (
                  <p className="mt-0.5 whitespace-pre-wrap">{m.body}</p>
                )}
              </div>
            ))
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => handleOutcome(selected.leadId, "won", "won")}
          >
            Mark won
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              handleOutcome(selected.leadId, "nurture", "back to nurture")
            }
          >
            Back to nurture
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => handleOutcome(selected.leadId, "dead", "dead")}
          >
            Mark dead
          </Button>
        </div>
      </div>
    </div>
  )
}
