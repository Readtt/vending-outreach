/**
 * Timezone-aware time helpers for the send scheduler.
 *
 * Everything in this app is stored and compared as UTC epoch-milliseconds.
 * The only place "local time" exists is inside these functions, and it is
 * always derived via `Intl.DateTimeFormat(..., { timeZone }).formatToParts()`
 * against an explicit IANA zone — never `new Date().getHours()`, and never
 * naive fixed-offset arithmetic (both break across DST transitions).
 *
 * Pure, no dependencies.
 */

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

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const dt = new Date(Date.UTC(date.y, date.m - 1, date.d + days))
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
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
// US federal holidays (observed-date rules)
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

function isUsFederalHolidayDate(date: CalendarDate): boolean {
  const candidates = [
    ...usFederalHolidaysForYear(date.y - 1),
    ...usFederalHolidaysForYear(date.y),
    ...usFederalHolidaysForYear(date.y + 1),
  ]
  return candidates.some(
    (h) => h.y === date.y && h.m === date.m && h.d === date.d
  )
}

/**
 * Whether the local calendar date of `epochMs` (in `timeZone`) is an
 * observed US federal holiday. Note this checks the *observed* date only —
 * e.g. when July 4th falls on a Saturday, the Friday before is flagged, not
 * the Saturday itself (which is already excluded by the weekend rule).
 */
export function isUsFederalHoliday(epochMs: number, timeZone: string): boolean {
  return isUsFederalHolidayDate(getLocalCalendarDate(timeZone, epochMs))
}

// ---------------------------------------------------------------------------

/**
 * The next epoch-ms instant at or after `epochMs` that falls inside the send
 * window, skipping weekends (if `weekdaysOnly`) and US federal holidays. If
 * `epochMs` is already inside a valid window, it is returned unchanged.
 */
export function nextSendWindowStart(
  epochMs: number,
  timeZone: string,
  opts: SendWindowRules
): number {
  if (
    isWithinSendWindow(epochMs, timeZone, opts) &&
    !isUsFederalHoliday(epochMs, timeZone)
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
      (opts.weekdaysOnly && isWeekend) || isUsFederalHolidayDate(date)

    if (!disqualified) {
      const windowStart = calendarDateAtHour(timeZone, date, opts.startHour)
      if (windowStart > epochMs) {
        return windowStart
      }
    }

    date = addCalendarDays(date, 1)
  }

  throw new Error(
    `nextSendWindowStart: no valid window found within ${maxIterations} days`
  )
}
