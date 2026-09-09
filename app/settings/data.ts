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

import {
  engineStatus,
  getSetting,
  listMailboxes,
  listProviders,
  setSetting,
  taskQueueSummary,
} from "@/lib/db"
import { AI_ROLES, getRoleModel } from "@/lib/ai"
import { isCountry, type Country } from "@/lib/geo"
import { TARGET_TYPES, TYPE_LABELS, type LeadType } from "@/lib/osm"
import {
  defaultLabelForKind,
  type MailboxPublic,
  type ProviderPublic,
  type SettingsStatus,
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

/**
 * The kinds of business a search can ask for.
 *
 * This used to be its own list of ten, with its own ids (`gyms`,
 * `self_storage`) that did not match the twelve `LeadType` values the search
 * dialog and `lib/osm.ts` speak (`gym`, `storage`). The two never lined up, so
 * whatever was ticked here had no effect on any search — the dialog started
 * with all twelve selected and ignored the setting entirely. One vocabulary
 * now, straight from `lib/osm.ts`.
 */
export const BUSINESS_TYPES: readonly { id: LeadType; label: string }[] =
  TARGET_TYPES.map((id) => ({ id, label: TYPE_LABELS[id] }))

export type BusinessTypeId = LeadType

export const BUSINESS_TYPE_IDS: readonly LeadType[] = TARGET_TYPES

function isBusinessTypeId(value: string): value is BusinessTypeId {
  return (TARGET_TYPES as readonly string[]).includes(value)
}

export interface TargetingSettings {
  /** Town, ZIP, or postal code — free text; geocoding is the worker's job. */
  location: string
  radiusMiles: number
  businessTypes: BusinessTypeId[]
  /**
   * Which countries searches may reach into. Never empty — a saved setting
   * with nothing ticked would make every search throw.
   */
  countries: Country[]
}

export const DEFAULT_TARGETING_SETTINGS: TargetingSettings = {
  location: "",
  radiusMiles: 15,
  // The US alone, because the two countries are not interchangeable: a
  // Canadian lead is emailed under CASL, which needs consent the US does not
  // ask for. Adding Canada should be something someone chose.
  countries: ["US"],
  // Every type is a plausible vending site, so preselect them all rather
  // than an arbitrary subset and let the user narrow it.
  businessTypes: [...BUSINESS_TYPE_IDS],
}

const TARGETING_SETTINGS_KEY = "targeting"

export function getTargetingSettings(): TargetingSettings {
  const stored = getSetting<Partial<TargetingSettings>>(TARGETING_SETTINGS_KEY)
  const businessTypes = stored?.businessTypes?.filter(isBusinessTypeId)
  const countries = stored?.countries?.filter(isCountry)
  return {
    ...DEFAULT_TARGETING_SETTINGS,
    ...stored,
    businessTypes:
      businessTypes && businessTypes.length > 0
        ? businessTypes
        : DEFAULT_TARGETING_SETTINGS.businessTypes,
    countries:
      countries && countries.length > 0
        ? countries
        : DEFAULT_TARGETING_SETTINGS.countries,
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
  /** Stands in for the phone number when CASL wants a second contact detail. */
  website: string
  /** Required for CAN-SPAM and CASL — every commercial email must carry it. */
  address: string
  offerTerms: string
}

export const DEFAULT_ABOUT_SETTINGS: AboutSettings = {
  name: "",
  company: "",
  phone: "",
  website: "",
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

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * The "is this thing actually working?" readout at the top of Settings.
 *
 * Settings is where someone goes right after nothing happened, and until now
 * the page could not tell them whether the engine was even running or whether
 * they had finished setting up. Both answers already existed in the database;
 * they were just never shown.
 */
export function getSettingsStatus(): SettingsStatus {
  const providers = listProviders()
  const mailboxes = listMailboxes()
  const about = getAboutSettings()

  const missing: string[] = []
  if (providers.length === 0) {
    missing.push("an AI provider")
  } else if (AI_ROLES.some((role) => !getRoleModel(role))) {
    // A provider with no model chosen for a job looks finished but fails at
    // the moment that job runs, which is hours later and far from this page.
    missing.push("a model for each job")
  }
  if (mailboxes.length === 0) missing.push("a mailbox")
  if (!about.address.trim()) missing.push("your business address")
  // CASL wants a second way to reach you alongside the address, so composing
  // for a Canadian lead refuses without one. Said here rather than discovered
  // later, when a batch of Canadian drafts quietly fails to get written.
  if (
    getTargetingSettings().countries.includes("CA") &&
    !about.phone.trim() &&
    !about.website.trim()
  ) {
    missing.push("your phone or website (Canada asks for one)")
  }

  const jobs = taskQueueSummary()
  return {
    engine: engineStatus(),
    missing,
    jobs: {
      waiting: jobs.pending,
      working: jobs.running,
      failed: jobs.failed,
      done: jobs.done,
    },
  }
}
