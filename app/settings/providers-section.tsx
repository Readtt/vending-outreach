"use client"

import {
  useState,
  useTransition,
  type ComponentProps,
  type FormEvent,
} from "react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import type { ProviderKind } from "@/lib/db"
import { AI_ROLES, type AiRole, type RoleModelSetting } from "@/lib/ai-roles"
import { deleteProviderAction, saveProviderAction } from "./actions"
import { defaultLabelForKind, type ProviderPublic } from "./types"
import { RoleModelPicker } from "./role-model-picker"

const PROVIDER_KINDS: ProviderKind[] = [
  "anthropic",
  "google",
  "openai_compatible",
]

interface ProvidersSectionProps {
  providers: ProviderPublic[]
  roleModels: Record<AiRole, RoleModelSetting | null>
}

export function ProvidersSection({
  providers,
  roleModels,
}: ProvidersSectionProps) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Providers</CardTitle>
            <CardDescription>
              Anthropic, Google, or anything OpenAI-compatible — OpenRouter,
              Groq, DeepSeek, xAI, Together, Fireworks, Ollama, LM Studio.
            </CardDescription>
          </div>
          <ProviderDialog triggerLabel="Add provider" />
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {providers.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No providers configured yet.
            </p>
          )}
          {providers.map((p) => (
            <ProviderRow key={p.id} provider={p} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Model assignment</CardTitle>
          <CardDescription>
            Pick the provider and model for each job. The model list is fetched
            live from that provider&apos;s own catalogue.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {AI_ROLES.map((role) => (
            <RoleModelPicker
              key={role}
              role={role}
              providers={providers}
              initial={roleModels[role]}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function ProviderRow({ provider }: { provider: ProviderPublic }) {
  const [isPending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)

  function handleDelete() {
    startTransition(() => {
      deleteProviderAction(provider.id)
        .then(() => toast.success(`Deleted "${provider.label}".`))
        .catch((err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Failed to delete.")
        )
    })
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <Badge variant="outline">{defaultLabelForKind(provider.kind)}</Badge>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{provider.label}</div>
          <div className="truncate text-xs text-muted-foreground">
            {provider.hasApiKey ? provider.apiKeyMasked : "No API key"}
            {provider.baseUrl ? ` · ${provider.baseUrl}` : ""}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <ProviderDialog
          provider={provider}
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

function ProviderDialog({
  provider,
  triggerLabel,
  triggerVariant = "default",
}: {
  provider?: ProviderPublic
  triggerLabel: string
  triggerVariant?: ComponentProps<typeof Button>["variant"]
}) {
  const isEdit = Boolean(provider)
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<ProviderKind>(provider?.kind ?? "anthropic")
  const [label, setLabel] = useState(provider?.label ?? "")
  const [apiKey, setApiKey] = useState("")
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "")
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    startTransition(() => {
      saveProviderAction({ id: provider?.id, kind, label, apiKey, baseUrl })
        .then(() => {
          toast.success(isEdit ? "Provider updated." : "Provider added.")
          setOpen(false)
          setApiKey("")
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
            <DialogTitle>
              {isEdit ? "Edit provider" : "Add provider"}
            </DialogTitle>
            <DialogDescription>
              Keys are stored locally and never sent to the browser once saved.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-kind">Kind</Label>
            <Select
              value={kind}
              onValueChange={(v) => {
                if (v) setKind(v as ProviderKind)
              }}
            >
              <SelectTrigger id="provider-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {defaultLabelForKind(k)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-label">Label</Label>
            <Input
              id="provider-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={defaultLabelForKind(kind)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-key">API key</Label>
            <Input
              id="provider-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                isEdit
                  ? (provider?.apiKeyMasked ?? "Leave blank to keep unchanged")
                  : "sk-..."
              }
              autoComplete="off"
            />
            {isEdit && (
              <p className="text-xs text-muted-foreground">
                Leave blank to keep the saved key.
              </p>
            )}
          </div>

          {kind === "openai_compatible" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="provider-base-url">Base URL</Label>
              <Input
                id="provider-base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://openrouter.ai/api/v1"
              />
              <p className="text-xs text-muted-foreground">
                OpenRouter: https://openrouter.ai/api/v1 &middot; Ollama:
                http://localhost:11434/v1
              </p>
            </div>
          )}

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
