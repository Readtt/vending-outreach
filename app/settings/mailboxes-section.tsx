"use client"

import { useState, useTransition, type FormEvent } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  deleteMailboxAction,
  saveMailboxAction,
  testMailboxConnectionAction,
} from "./actions"
import type { MailboxPublic } from "./types"

interface MailboxesSectionProps {
  mailboxes: MailboxPublic[]
}

export function MailboxesSection({ mailboxes }: MailboxesSectionProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Mailboxes</CardTitle>
          <CardDescription>
            Gmail address and app password. Test the connection before your
            first send — it checks sending and receiving separately, because an
            account can send fine while IMAP is switched off, and then every
            reply is silently lost.
          </CardDescription>
        </div>
        <MailboxDialog triggerLabel="Add mailbox" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {mailboxes.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No mailboxes configured yet.
          </p>
        )}
        {mailboxes.map((m) => (
          <MailboxRow key={m.id} mailbox={m} />
        ))}
      </CardContent>
    </Card>
  )
}

function MailboxRow({ mailbox }: { mailbox: MailboxPublic }) {
  const [isPending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [testing, setTesting] = useState(false)

  function handleDelete() {
    startTransition(() => {
      deleteMailboxAction(mailbox.id)
        .then(() => toast.success(`Deleted "${mailbox.email}".`))
        .catch((err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Failed to delete.")
        )
    })
  }

  function handleTestConnection() {
    setTesting(true)
    testMailboxConnectionAction(mailbox.id)
      .then((result) => {
        if (result.ok) {
          toast.success(
            `${mailbox.email} is ready — sending and receiving both work.`
          )
          return
        }
        // Report each leg separately. "It failed" is useless when SMTP is fine
        // and IMAP is switched off in the Gmail account, which is a common and
        // very confusing state: mail goes out, replies never come back.
        const failures = [
          result.smtp.ok ? null : `Sending (SMTP): ${result.smtp.error}`,
          result.imap.ok ? null : `Receiving (IMAP): ${result.imap.error}`,
        ].filter((line): line is string => line !== null)
        toast.error(failures.join("\n\n"), { duration: 15_000 })
      })
      .catch((err: unknown) =>
        toast.error(
          err instanceof Error ? err.message : "Connection test failed."
        )
      )
      .finally(() => setTesting(false))
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <Badge variant={mailbox.status === "active" ? "outline" : "secondary"}>
          {mailbox.status}
        </Badge>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{mailbox.email}</div>
          <div className="truncate text-xs text-muted-foreground">
            {mailbox.appPasswordMasked} · {mailbox.dailyCap}/day
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleTestConnection}
          disabled={testing}
        >
          {testing ? "Testing…" : "Test connection"}
        </Button>
        <MailboxDialog
          mailbox={mailbox}
          triggerLabel="Edit"
          triggerVariant="ghost"
        />
        {confirming ? (
          <>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={isPending}
            >
              Confirm
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
            Delete
          </Button>
        )}
      </div>
    </div>
  )
}

function MailboxDialog({
  mailbox,
  triggerLabel,
  triggerVariant = "default",
}: {
  mailbox?: MailboxPublic
  triggerLabel: string
  triggerVariant?: "default" | "ghost"
}) {
  const isEdit = Boolean(mailbox)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState(mailbox?.email ?? "")
  const [appPassword, setAppPassword] = useState("")
  const [dailyCap, setDailyCap] = useState(String(mailbox?.dailyCap ?? 25))
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    startTransition(() => {
      saveMailboxAction({
        id: mailbox?.id,
        email,
        appPassword,
        dailyCap: Number(dailyCap),
      })
        .then(() => {
          toast.success(isEdit ? "Mailbox updated." : "Mailbox added.")
          setOpen(false)
          setAppPassword("")
        })
        .catch((err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Failed to save.")
        )
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={triggerVariant} size="sm" />}>
        {triggerLabel}
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit mailbox" : "Add mailbox"}</DialogTitle>
            <DialogDescription>
              Use a Gmail{" "}
              <a
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noreferrer"
              >
                app password
              </a>
              , not the account password.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mailbox-email">Gmail address</Label>
            <Input
              id="mailbox-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@gmail.com"
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mailbox-app-password">App password</Label>
            <Input
              id="mailbox-app-password"
              type="password"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              placeholder={
                isEdit
                  ? "Leave blank to keep unchanged"
                  : "16-character app password"
              }
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mailbox-daily-cap">Daily cap</Label>
            <Input
              id="mailbox-daily-cap"
              type="number"
              min={1}
              max={200}
              value={dailyCap}
              onChange={(e) => setDailyCap(e.target.value)}
            />
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
