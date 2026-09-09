/**
 * Timezone-aware time helpers for the send scheduler.
 *
 * The holiday tables are the one country-dependent part: a business in Ottawa
 * is shut on Canada Day and open on the Fourth of July, and mail arriving on
 * either is mail nobody reads.
 *
 * Everything in this app is stored and compared as UTC epoch-milliseconds.
 * The only place "local time" exists is inside these functions, and it is
 * always derived via `Intl.DateTimeFormat(..., { timeZone }).formatToParts()`
 * against an explicit IANA zone — never `new Date().getHours()`, and never
 * naive fixed-offset arithmetic (both break across DST transitions).
 *
 * Pure, no dependencies.
 */

import type { Country } from "./geo.ts"

type PartMap = Partial<Record<Intl.DateTimeFormatPartTypes, string>>

function formatParts(
  timeZone: string,
  epochMs: number,
  options: Intl.DateTimeFormatOptions
): PartMap {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone, ...options })
  const map: PartMap = {}
  for (const part of dtf.formatToParts(new Date(epochMs))) {
    map[part.type] = part.value
  }
  return map
}

interface CalendarDate {
  y: number
  m: number // 1-12
  d: number
}

/** The (year, month, day) that `epochMs` falls on in `timeZone`. */
function getLocalCalendarDate(timeZone: string, epochMs: number): CalendarDate {
  const map = formatParts(timeZone, epochMs, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  return { y: Number(map.year), m: Number(map.month), d: Number(map.day) }
}

/** The wall-clock hour (0-23) that `epochMs` falls on in `timeZone`. */
function getLocalHour(timeZone: string, epochMs: number): number {
  const map = formatParts(timeZone, epochMs, {
    hour12: false,
    hourCycle: "h23",
    hour: "2-digit",
  })
  const hour = Number(map.hour)
  // Guard against the historical ICU quirk where h23 + 2-digit renders
  // midnight as "24" instead of "00" on some engine versions.
  return hour === 24 ? 0 : hour
}

/** 0 = Sunday ... 6 = Saturday. Pure calendar math — not timezone-dependent. */
function calendarWeekday(date: CalendarDate): number {
  return new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay()
}

/**
 * The UTC-offset (in ms, such that `localWallClock = epochMs + offset`) that
 * `timeZone` is at, at the instant `epochMs`.
 */
function getOffsetMs(timeZone: string, epochMs: number): number {
  const map = formatParts(timeZone, epochMs, {
    hour12: false,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const hour = Number(map.hour) === 24 ? 0 : Number(map.hour)
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second)
  )
  return asUtc - epochMs
}

/**
 * Converts a wall-clock date/time in `timeZone` to a UTC epoch-ms instant.
 * DST-safe: resolves the zone's actual offset at (approximately) that
 * instant rather than assuming a fixed offset.
 */
function zonedTimeToUtc(
  timeZone: string,
  y: number,
  m: number,
  d: number,
  h: number,
  mi: number,
  s: number
): number {
  const utcGuess = Date.UTC(y, m - 1, d, h, mi, s)
  const offset1 = getOffsetMs(timeZone, utcGuess)
  const candidate1 = utcGuess - offset1
  const offset2 = getOffsetMs(timeZone, candidate1)
  // One correction pass is enough except right at a transition, where the
  // offset at the corrected instant can differ from the offset at the guess;
  // in that case re-derive from the guess using the settled offset.
  return offset2 === offset1 ? candidate1 : utcGuess - offset2
}

function calendarDateAtHour(
  timeZone: string,
  date: CalendarDate,
  hour: number
): number {
  return zonedTimeToUtc(timeZone, date.y, date.m, date.d, hour, 0, 0)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The epoch-ms instant of local midnight (00:00:00.000), in `timeZone`, on
 * the calendar day that `now` falls on in that zone.
 */
export function localMidnightEpochMs(timeZone: string, now: number): number {
  const date = getLocalCalendarDate(timeZone, now)
  return calendarDateAtHour(timeZone, date, 0)
}

export interface SendWindowRules {
  /** Inclusive local hour the window opens, 0-23. */
  startHour: number
  /** Exclusive local hour the window closes, 0-23. */
  endHour: number
  /** If true, Saturday and Sunday (local) are never within the window. */
  weekdaysOnly: boolean
}

/** Whether `epochMs` falls inside the send window, evaluated in `timeZone`. */
export function isWithinSendWindow(
  epochMs: number,
  timeZone: string,
  opts: SendWindowRules
): boolean {
  if (opts.weekdaysOnly) {
    const weekday = calendarWeekday(getLocalCalendarDate(timeZone, epochMs))
    if (weekday === 0 || weekday === 6) return false
  }
  const hour = getLocalHour(timeZone, epochMs)
  return hour >= opts.startHour && hour < opts.endHour
}

// ---------------------------------------------------------------------------
// Public holidays (observed-date rules)
// ---------------------------------------------------------------------------

/** The nth (1-indexed) occurrence of `weekday` (0=Sun..6=Sat) in a month. */
function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  n: number
): CalendarDate {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const day = 1 + ((weekday - firstWeekday + 7) % 7) + (n - 1) * 7
  return { y: year, m: month, d: day }
}

/** The last occurrence of `weekday` (0=Sun..6=Sat) in a month. */
function lastWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number
): CalendarDate {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const lastWeekdayOfLastDay = new Date(
    Date.UTC(year, month - 1, lastDay)
  ).getUTCDay()
  const day = lastDay - ((lastWeekdayOfLastDay - weekday + 7) % 7)
  return { y: year, m: month, d: day }
}

/** Applies the federal observed-date shift: Sat -> preceding Fri, Sun -> following Mon. */
function observedDate(year: number, month: number, day: number): CalendarDate {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  const shift = weekday === 6 ? -1 : weekday === 0 ? 1 : 0
  if (shift === 0) return { y: year, m: month, d: day }
  const shifted = new Date(Date.UTC(year, month - 1, day + shift))
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
  }
}

/** Adds days to a calendar date without going through a timezone. */
function shiftDate(date: CalendarDate, days: number): CalendarDate {
  const dt = new Date(Date.UTC(date.y, date.m - 1, date.d + days))
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
}

/**
 * Easter Sunday, by the anonymous Gregorian algorithm.
 *
 * Needed only because Good Friday is a statutory holiday across Canada and is
 * the one North American holiday that does not fall on a fixed date or an
 * nth-weekday rule.
 */
function easterSunday(year: number): CalendarDate {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return { y: year, m: month, d: day }
}

/** The 11 US federal holidays (5 U.S.C. § 6103), with observed-date shifts applied. */
function usFederalHolidaysForYear(year: number): CalendarDate[] {
  return [
    observedDate(year, 1, 1), // New Year's Day
    nthWeekdayOfMonth(year, 1, 1, 3), // Martin Luther King Jr. Day: 3rd Mon of Jan
    nthWeekdayOfMonth(year, 2, 1, 3), // Washington's Birthday: 3rd Mon of Feb
    lastWeekdayOfMonth(year, 5, 1), // Memorial Day: last Mon of May
    observedDate(year, 6, 19), // Juneteenth
    observedDate(year, 7, 4), // Independence Day
    nthWeekdayOfMonth(year, 9, 1, 1), // Labor Day: 1st Mon of Sep
    nthWeekdayOfMonth(year, 10, 1, 2), // Columbus Day: 2nd Mon of Oct
    observedDate(year, 11, 11), // Veterans Day
    nthWeekdayOfMonth(year, 11, 4, 4), // Thanksgiving: 4th Thu of Nov
    observedDate(year, 12, 25), // Christmas Day
  ]
}

/**
 * Canadian holidays on which a small business is likely closed.
 *
 * Wider than the federal list on purpose. The question this answers is "is
 * anyone there to read this", not "is this a paid day off under the Canada
 * Labour Code", so Family Day and the August civic holiday are in even though
 * neither is federal and neither is observed in every province. Sending on a
 * day half the country is shut costs an email; skipping a day it turns out
 * some provinces work costs a few hours of delay.
 */
function canadianHolidaysForYear(year: number): CalendarDate[] {
  const easter = easterSunday(year)
  return [
    observedDate(year, 1, 1), // New Year's Day
    nthWeekdayOfMonth(year, 2, 1, 3), // Family Day: 3rd Mon of Feb (ON/AB/SK/BC/NB)
    shiftDate(easter, -2), // Good Friday
    // Victoria Day: the Monday before May 25, so the last Monday on or
    // before the 24th.
    (() => {
      const may24 = { y: year, m: 5, d: 24 }
      const weekday = new Date(Date.UTC(year, 4, 24)).getUTCDay()
      return shiftDate(may24, -((weekday + 6) % 7))
    })(),
    observedDate(year, 7, 1), // Canada Day
    nthWeekdayOfMonth(year, 8, 1, 1), // Civic Holiday: 1st Mon of Aug
    nthWeekdayOfMonth(year, 9, 1, 1), // Labour Day: 1st Mon of Sep
    observedDate(year, 9, 30), // National Day for Truth and Reconciliation
    nthWeekdayOfMonth(year, 10, 1, 2), // Thanksgiving: 2nd Mon of Oct
    observedDate(year, 11, 11), // Remembrance Day
    observedDate(year, 12, 25), // Christmas Day
    observedDate(year, 12, 26), // Boxing Day
  ]
}

function holidaysForYear(year: number, country: Country): CalendarDate[] {
  return country === "CA"
    ? canadianHolidaysForYear(year)
    : usFederalHolidaysForYear(year)
}

function isHolidayDate(date: CalendarDate, country: Country): boolean {
  // The neighbouring years are included because an observed date can shift
  // across a year boundary — New Year's Day on a Saturday is observed on
  // December 31st of the year before.
  const candidates = [
    ...holidaysForYear(date.y - 1, country),
    ...holidaysForYear(date.y, country),
    ...holidaysForYear(date.y + 1, country),
  ]
  return candidates.some(
    (h) => h.y === date.y && h.m === date.m && h.d === date.d
  )
}

/**
 * Whether the local calendar date of `epochMs` (in `timeZone`) is a public
 * holiday in `country`.
 *
 * Note this checks the *observed* date only — when July 4th falls on a
 * Saturday, the Friday before is flagged, not the Saturday itself, which the
 * weekend rule has already excluded.
 */
export function isPublicHoliday(
  epochMs: number,
  timeZone: string,
  country: Country = "US"
): boolean {
  return isHolidayDate(getLocalCalendarDate(timeZone, epochMs), country)
}

// ---------------------------------------------------------------------------

/**
 * The next epoch-ms instant at or after `epochMs` that falls inside the send
 * window, skipping weekends (if `weekdaysOnly`) and `country`'s public
 * holidays. If `epochMs` is already inside a valid window, it is returned
 * unchanged.
 */
export function nextSendWindowStart(
  epochMs: number,
  timeZone: string,
  opts: SendWindowRules,
  country: Country = "US"
): number {
  if (
    isWithinSendWindow(epochMs, timeZone, opts) &&
    !isPublicHoliday(epochMs, timeZone, country)
  ) {
    return epochMs
  }

  let date = getLocalCalendarDate(timeZone, epochMs)

  // Defensive bound: comfortably more than any realistic run of consecutive
  // disqualified days (weekends + holidays never come close to this).
  const maxIterations = 3660
  for (let i = 0; i < maxIterations; i++) {
    const weekday = calendarWeekday(date)
    const isWeekend = weekday === 0 || weekday === 6
    const disqualified =
      (opts.weekdaysOnly && isWeekend) || isHolidayDate(date, country)

    if (!disqualified) {
      const windowStart = calendarDateAtHour(timeZone, date, opts.startHour)
      if (windowStart > epochMs) {
        return windowStart
      }
    }

    date = shiftDate(date, 1)
  }

  throw new Error(
    `nextSendWindowStart: no valid window found within ${maxIterations} days`
  )
}
