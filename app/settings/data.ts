/**
 * Server-only data shaping for the Settings page: typed section shapes with
 * defaults, and the redaction boundary between the database and the
 * browser. `page.tsx` and the server actions in `actions.ts` are the only
 * callers — nothing here is imported by a client component (client
 * components use `./types` instead, which has no `@/lib/db` value-import
 * and so never drags `node:sqlite` into the browser bundle).
 *
 * Constraint that matters: API keys and app passwords must never reach the
 * client. `listProviders()`/`listMailboxes()` return raw rows (secrets
 * included); `getProvidersForClient`/`getMailboxesForClient` are the only
 * functions in this app allowed to turn those into something a client
 * component can receive as props.
 */

import { getSetting, listMailboxes, listProviders, setSetting } from "@/lib/db"
import {
  defaultLabelForKind,
  type MailboxPublic,
  type ProviderPublic,
} from "./types"

export { defaultLabelForKind, type MailboxPublic, type ProviderPublic }

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------

function maskSecret(secret: string | null): string | null {
  if (!secret) return null
  if (secret.length <= 8) return "•".repeat(8)
  return `${secret.slice(0, 4)}${"•".repeat(6)}${secret.slice(-4)}`
}

/** Providers with secrets stripped/masked — safe to pass to a client component. */
export function getProvidersForClient(): ProviderPublic[] {
  return listProviders().map((p) => ({
    id: p.id,
    kind: p.kind,
    label: p.label?.trim() || defaultLabelForKind(p.kind),
    baseUrl: p.base_url,
    hasApiKey: Boolean(p.api_key),
    apiKeyMasked: maskSecret(p.api_key),
  }))
}

/** Mailboxes with the app password masked — safe to pass to a client component. */
export function getMailboxesForClient(): MailboxPublic[] {
  return listMailboxes().map((m) => ({
    id: m.id,
    email: m.email,
    dailyCap: m.daily_cap,
    status: m.status,
    appPasswordMasked: maskSecret(m.app_password) ?? "•".repeat(8),
  }))
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface SendingSettings {
  emailsPerDay: number
  sendGapMinMinutes: number
  sendGapMaxMinutes: number
  windowStartHour: number
  windowEndHour: number
  weekdaysOnly: boolean
}

export const DEFAULT_SENDING_SETTINGS: SendingSettings = {
  emailsPerDay: 25,
  sendGapMinMinutes: 6,
  sendGapMaxMinutes: 20,
  windowStartHour: 9,
  windowEndHour: 16,
  weekdaysOnly: true,
}

/** Above this many emails/day, the Sending section shows an inline warning. */
export const EMAILS_PER_DAY_WARN_ABOVE = 30

const SENDING_SETTINGS_KEY = "sending"

export function getSendingSettings(): SendingSettings {
  return {
    ...DEFAULT_SENDING_SETTINGS,
    ...getSetting<Partial<SendingSettings>>(SENDING_SETTINGS_KEY),
  }
}

export function saveSendingSettings(settings: SendingSettings): void {
  setSetting(SENDING_SETTINGS_KEY, settings)
}

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------

export const BUSINESS_TYPES = [
  { id: "gyms", label: "Gyms" },
  { id: "car_dealerships", label: "Car dealerships" },
  { id: "auto_repair", label: "Auto repair" },
  { id: "warehouses", label: "Warehouses" },
  { id: "offices", label: "Offices" },
  { id: "clinics", label: "Clinics" },
  { id: "hotels", label: "Hotels" },
  { id: "self_storage", label: "Self-storage" },
  { id: "laundromats", label: "Laundromats" },
  { id: "apartments", label: "Apartments" },
] as const

export type BusinessTypeId = (typeof BUSINESS_TYPES)[number]["id"]

export const BUSINESS_TYPE_IDS = BUSINESS_TYPES.map(
  (t) => t.id
) as BusinessTypeId[]

function isBusinessTypeId(value: string): value is BusinessTypeId {
  return (BUSINESS_TYPE_IDS as string[]).includes(value)
}

export interface TargetingSettings {
  /** City or ZIP — free text; geocoding into a US-only bbox is the worker's job. */
  location: string
  radiusMiles: number
  businessTypes: BusinessTypeId[]
}

export const DEFAULT_TARGETING_SETTINGS: TargetingSettings = {
  location: "",
  radiusMiles: 15,
  // All ten are sensible vending targets per the build spec's own ground
  // truth (§10) — preselect everything rather than an arbitrary subset.
  businessTypes: [...BUSINESS_TYPE_IDS],
}

const TARGETING_SETTINGS_KEY = "targeting"

export function getTargetingSettings(): TargetingSettings {
  const stored = getSetting<Partial<TargetingSettings>>(TARGETING_SETTINGS_KEY)
  const businessTypes = stored?.businessTypes?.filter(isBusinessTypeId)
  return {
    ...DEFAULT_TARGETING_SETTINGS,
    ...stored,
    businessTypes:
      businessTypes && businessTypes.length > 0
        ? businessTypes
        : DEFAULT_TARGETING_SETTINGS.businessTypes,
  }
}

export function saveTargetingSettings(settings: TargetingSettings): void {
  setSetting(TARGETING_SETTINGS_KEY, settings)
}

// ---------------------------------------------------------------------------
// About you
// ---------------------------------------------------------------------------

export interface AboutSettings {
  name: string
  company: string
  phone: string
  /** Required for CAN-SPAM — every commercial email must carry it. */
  address: string
  offerTerms: string
}

export const DEFAULT_ABOUT_SETTINGS: AboutSettings = {
  name: "",
  company: "",
  phone: "",
  address: "",
  offerTerms: "",
}

const ABOUT_SETTINGS_KEY = "about"

export function getAboutSettings(): AboutSettings {
  return {
    ...DEFAULT_ABOUT_SETTINGS,
    ...getSetting<Partial<AboutSettings>>(ABOUT_SETTINGS_KEY),
  }
}

export function saveAboutSettings(settings: AboutSettings): void {
  setSetting(ABOUT_SETTINGS_KEY, settings)
}
