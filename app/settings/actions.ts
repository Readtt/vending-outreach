"use server"

/**
 * Server actions backing the Settings page. Every mutation ends with
 * `revalidatePath("/settings")` so the page's server-rendered data — and
 * anything derived from it that's passed down as props (provider lists,
 * masked keys, role model selections) — reflects the write immediately,
 * without a manual refresh.
 */

import { revalidatePath } from "next/cache"
import { isCountry } from "@/lib/geo"
import {
  deleteMailbox as deleteMailboxRow,
  deleteProvider as deleteProviderRow,
  getMailboxById,
  upsertMailbox,
  upsertProvider,
  type ProviderKind,
} from "@/lib/db"
import {
  verifyMailboxCredentials,
  type MailboxCheckResult,
} from "@/lib/mail-verify"
import {
  AI_ROLES,
  clearRoleModel,
  getRoleModel,
  setRoleModel,
  type AiRole,
} from "@/lib/ai"
import {
  BUSINESS_TYPE_IDS,
  DEFAULT_ABOUT_SETTINGS,
  DEFAULT_SENDING_SETTINGS,
  DEFAULT_TARGETING_SETTINGS,
  defaultLabelForKind,
  getSettingsStatus,
  saveAboutSettings,
  saveSendingSettings,
  saveTargetingSettings,
  type AboutSettings,
  type BusinessTypeId,
  type SendingSettings,
  type TargetingSettings,
} from "./data"
import type { SettingsStatus } from "./types"

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function formString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === "string" ? value.trim() : ""
}

function formNumber(formData: FormData, key: string, fallback: number): number {
  const value = formData.get(key)
  const n = typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(n) ? n : fallback
}

// ---------------------------------------------------------------------------
// AI Providers
// ---------------------------------------------------------------------------

export interface SaveProviderInput {
  /** Omit to create a new provider. */
  id?: string
  kind: ProviderKind
  label: string
  /** Empty when editing means "leave the stored key untouched." */
  apiKey: string
  baseUrl: string
}

export async function saveProviderAction(
  input: SaveProviderInput
): Promise<void> {
  const kind = input.kind
  const label = input.label.trim() || defaultLabelForKind(kind)
  const baseUrl = input.baseUrl.trim()
  const apiKey = input.apiKey.trim()
  const isNew = !input.id

  if (isNew && (kind === "anthropic" || kind === "google") && !apiKey) {
    throw new Error(
      `${defaultLabelForKind(kind)} providers need an API key to be created.`
    )
  }
  if (kind === "openai_compatible" && !baseUrl) {
    throw new Error("OpenAI-compatible providers need a base URL.")
  }

  upsertProvider({
    id: input.id,
    kind,
    label,
    apiKey: apiKey || undefined,
    baseUrl: kind === "openai_compatible" ? baseUrl : null,
  })

  revalidatePath("/settings")
}

export async function deleteProviderAction(id: string): Promise<void> {
  deleteProviderRow(id)
  // Don't leave a role pointed at a provider that no longer exists — the
  // next generateGuarded() call for that role would otherwise fail with a
  // confusing error instead of the picker just showing "not set."
  for (const role of AI_ROLES) {
    if (getRoleModel(role)?.providerId === id) clearRoleModel(role)
  }
  revalidatePath("/settings")
}

export async function saveRoleModelAction(
  role: AiRole,
  providerId: string,
  modelId: string
): Promise<void> {
  if (!providerId || !modelId) {
    throw new Error("Pick both a provider and a model.")
  }
  setRoleModel(role, providerId, modelId)
  revalidatePath("/settings")
}

// ---------------------------------------------------------------------------
// Mailboxes
// ---------------------------------------------------------------------------

export interface SaveMailboxInput {
  /** Omit to create a new mailbox. */
  id?: string
  email: string
  /** Empty when editing means "leave the stored app password untouched." */
  appPassword: string
  dailyCap: number
}

export async function saveMailboxAction(
  input: SaveMailboxInput
): Promise<void> {
  const email = input.email.trim().toLowerCase()
  const appPassword = input.appPassword.trim()
  const isNew = !input.id

  if (!email || !email.includes("@")) {
    throw new Error("Enter a valid Gmail address.")
  }
  if (isNew && !appPassword) {
    throw new Error("Enter the Gmail app password.")
  }

  const dailyCap = Number.isFinite(input.dailyCap)
    ? clamp(Math.round(input.dailyCap), 1, 200)
    : 25

  upsertMailbox({
    id: input.id,
    email,
    appPassword: appPassword || undefined,
    dailyCap,
  })

  revalidatePath("/settings")
}

export async function deleteMailboxAction(id: string): Promise<void> {
  deleteMailboxRow(id)
  revalidatePath("/settings")
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export async function saveSendingSettingsAction(
  formData: FormData
): Promise<void> {
  const emailsPerDay = clamp(
    formNumber(formData, "emailsPerDay", DEFAULT_SENDING_SETTINGS.emailsPerDay),
    1,
    500
  )

  const gaps = formData
    .getAll("sendGapMinutes")
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
  const sendGapMinMinutes = clamp(
    gaps[0] ?? DEFAULT_SENDING_SETTINGS.sendGapMinMinutes,
    1,
    180
  )
  const sendGapMaxMinutes = clamp(
    gaps[1] ?? DEFAULT_SENDING_SETTINGS.sendGapMaxMinutes,
    sendGapMinMinutes,
    180
  )

  const hours = formData
    .getAll("sendWindowHours")
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
  const windowStartHour = clamp(
    hours[0] ?? DEFAULT_SENDING_SETTINGS.windowStartHour,
    0,
    23
  )
  const windowEndHour = clamp(
    hours[1] ?? DEFAULT_SENDING_SETTINGS.windowEndHour,
    windowStartHour + 1,
    24
  )

  const weekdaysOnly = formData.get("weekdaysOnly") === "on"

  const settings: SendingSettings = {
    emailsPerDay,
    sendGapMinMinutes,
    sendGapMaxMinutes,
    windowStartHour,
    windowEndHour,
    weekdaysOnly,
  }
  saveSendingSettings(settings)
  revalidatePath("/settings")
}

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------

export async function saveTargetingSettingsAction(
  formData: FormData
): Promise<void> {
  const location = formString(formData, "location")
  const radiusMiles = clamp(
    formNumber(formData, "radiusMiles", DEFAULT_TARGETING_SETTINGS.radiusMiles),
    1,
    100
  )
  const businessTypes = formData
    .getAll("businessTypes")
    .filter((v): v is string => typeof v === "string")
    .filter((v): v is BusinessTypeId =>
      (BUSINESS_TYPE_IDS as string[]).includes(v)
    )

  const countries = formData.getAll("countries").filter(isCountry)

  const settings: TargetingSettings = {
    location,
    radiusMiles,
    businessTypes:
      businessTypes.length > 0
        ? businessTypes
        : DEFAULT_TARGETING_SETTINGS.businessTypes,
    // Unticking both would make every search throw. Falling back beats
    // saving a setting that only fails later, somewhere else.
    countries:
      countries.length > 0 ? countries : DEFAULT_TARGETING_SETTINGS.countries,
  }
  saveTargetingSettings(settings)
  revalidatePath("/settings")
}

// ---------------------------------------------------------------------------
// About you
// ---------------------------------------------------------------------------

export async function saveAboutSettingsAction(
  formData: FormData
): Promise<void> {
  const address = formString(formData, "address")
  if (!address) {
    // Required for CAN-SPAM — every commercial email must carry a physical
    // address. The form also marks this field `required` client-side; this
    // is the server-side backstop.
    throw new Error(
      "Physical address is required (CAN-SPAM requires it on every email)."
    )
  }

  const settings: AboutSettings = {
    name: formString(formData, "name"),
    company: formString(formData, "company"),
    phone: formString(formData, "phone"),
    website: formString(formData, "website"),
    address,
    offerTerms:
      formString(formData, "offerTerms") || DEFAULT_ABOUT_SETTINGS.offerTerms,
  }
  saveAboutSettings(settings)
  revalidatePath("/settings")
}

/**
 * Authenticates a saved mailbox against Gmail SMTP and IMAP.
 *
 * Runs server-side so the app password never leaves the machine, and checks
 * both legs because they fail independently: sending can work while IMAP is
 * switched off in the account, and that combination looks fine right up until
 * every reply and every bounce is silently lost.
 *
 * Sends nothing. There is no path from here to an outgoing message.
 */
export async function testMailboxConnectionAction(
  mailboxId: string
): Promise<MailboxCheckResult> {
  const mailbox = getMailboxById(mailboxId)
  if (!mailbox) {
    const error = "That mailbox is no longer saved. Reload the page."
    return { smtp: { ok: false, error }, imap: { ok: false, error }, ok: false }
  }
  return verifyMailboxCredentials(mailbox.email, mailbox.app_password)
}

/**
 * Reads the status bar's numbers. Polled by `status-bar.tsx` on a timer so
 * only that strip updates — refreshing the whole page here would fight with
 * anyone half-way through filling in a form.
 */
export async function getSettingsStatusAction(): Promise<SettingsStatus> {
  return getSettingsStatus()
}
