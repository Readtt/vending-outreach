"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { generateCallScriptAction, setCallOutcomeAction } from "./actions"
import {
  CALL_OUTCOME_LABELS,
  type CallListItem,
  type CallOutcome,
} from "./types"

const OUTCOME_ORDER: CallOutcome[] = [
  "reached",
  "left_voicemail",
  "interested",
  "not_interested",
]

export function CallCard({ item }: { item: CallListItem }) {
  const router = useRouter()
  const [script, setScript] = useState(item.callScript)
  const [generating, setGenerating] = useState(false)
  const [outcome, setOutcome] = useState<CallOutcome | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleGenerate() {
    setGenerating(true)
    generateCallScriptAction(item.id)
      .then((text) => setScript(text))
      .catch((err: unknown) =>
        toast.error(
          err instanceof Error ? err.message : "Failed to generate a script."
        )
      )
      .finally(() => setGenerating(false))
  }

  function handleOutcome(next: CallOutcome) {
    startTransition(() => {
      setCallOutcomeAction(item.id, next)
        .then(() => {
          setOutcome(next)
          toast.success(`Marked ${CALL_OUTCOME_LABELS[next].toLowerCase()}.`)
          router.refresh()
        })
        .catch((err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Failed to update.")
        )
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">
            {item.name ?? "Unnamed business"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {item.type ? `${item.type} · ` : ""}
            {item.hoursSinceContact}h since first contact
          </p>
        </div>
        <a
          href={`tel:${item.phone}`}
          className="shrink-0 text-sm font-medium text-primary underline underline-offset-2"
        >
          {item.phone}
        </a>
      </div>

      {item.fact && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          {item.fact}
        </p>
      )}

      {item.lastEmailBody && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Email sent — {item.lastEmailSubject ?? "no subject"}
          </summary>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
            {item.lastEmailBody}
          </p>
        </details>
      )}

      {script ? (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm whitespace-pre-wrap">
          {script}
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={handleGenerate}
          disabled={generating}
          className="self-start"
        >
          {generating ? "Writing…" : "Generate call script"}
        </Button>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        {outcome ? (
          <span className="text-xs text-muted-foreground">
            Marked: {CALL_OUTCOME_LABELS[outcome]}
          </span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {OUTCOME_ORDER.map((value) => (
              <Button
                key={value}
                size="xs"
                variant="outline"
                disabled={isPending}
                onClick={() => handleOutcome(value)}
              >
                {CALL_OUTCOME_LABELS[value]}
              </Button>
            ))}
          </div>
        )}
        <Button
          render={<Link href={`/packet/${item.id}`} target="_blank" />}
          nativeButton={false}
          size="xs"
          variant="ghost"
        >
          Printable packet
        </Button>
      </div>
    </div>
  )
}
