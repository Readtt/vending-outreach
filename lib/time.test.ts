import { test } from "node:test"
import assert from "node:assert/strict"
import {
  isUsFederalHoliday,
  isWithinSendWindow,
  localMidnightEpochMs,
  nextSendWindowStart,
} from "./time.ts"

const NY = "America/New_York"
const CHICAGO = "America/Chicago"

test("localMidnightEpochMs: spring-forward DST boundary (America/New_York, Mar 10 2024)", () => {
  // Clocks spring forward 2am -> 3am on Mar 10, 2024, so Mar 10 local midnight
  // is still EST (UTC-5) but Mar 11 local midnight is already EDT (UTC-4).
  // Naive "add 24h" or fixed-offset arithmetic gets one of these wrong.
  const midnight10 = localMidnightEpochMs(NY, Date.UTC(2024, 2, 10, 18, 0, 0))
  const midnight11 = localMidnightEpochMs(NY, Date.UTC(2024, 2, 11, 18, 0, 0))

  assert.strictEqual(midnight10, Date.UTC(2024, 2, 10, 5, 0, 0)) // 00:00 EST = 05:00Z
  assert.strictEqual(midnight11, Date.UTC(2024, 2, 11, 4, 0, 0)) // 00:00 EDT = 04:00Z
  assert.strictEqual(midnight11 - midnight10, 23 * 60 * 60 * 1000) // that day was only 23h long
})

test("localMidnightEpochMs: fall-back DST boundary (America/New_York, Nov 3 2024)", () => {
  // Clocks fall back 2am -> 1am on Nov 3, 2024, so Nov 3 local midnight is
  // still EDT (UTC-4) but Nov 4 local midnight is already EST (UTC-5).
  const midnight3 = localMidnightEpochMs(NY, Date.UTC(2024, 10, 3, 18, 0, 0))
  const midnight4 = localMidnightEpochMs(NY, Date.UTC(2024, 10, 4, 18, 0, 0))

  assert.strictEqual(midnight3, Date.UTC(2024, 10, 3, 4, 0, 0)) // 00:00 EDT = 04:00Z
  assert.strictEqual(midnight4, Date.UTC(2024, 10, 4, 5, 0, 0)) // 00:00 EST = 05:00Z
  assert.strictEqual(midnight4 - midnight3, 25 * 60 * 60 * 1000) // that day was 25h long
})

test("isUsFederalHoliday: observed-date shift (New Year's Day 2023, a Sunday)", () => {
  // Jan 1, 2023 was a Sunday, so the observed holiday shifts to Monday Jan 2.
  const observedMonday = Date.UTC(2023, 0, 2, 17, 0, 0) // Jan 2 noon EST
  const actualSunday = Date.UTC(2023, 0, 1, 17, 0, 0) // Jan 1 noon EST

  assert.strictEqual(isUsFederalHoliday(observedMonday, NY), true)
  // The actual Jan 1 is a Sunday, not the *observed* date, and Sundays are
  // already excluded elsewhere by the weekend rule — so this function
  // correctly reports it as not the (shifted) holiday date.
  assert.strictEqual(isUsFederalHoliday(actualSunday, NY), false)
})

test("isUsFederalHoliday: direct date, no shift (Independence Day 2024, a Thursday)", () => {
  const july4 = Date.UTC(2024, 6, 4, 17, 0, 0) // Jul 4 2024, 13:00 EDT
  assert.strictEqual(isUsFederalHoliday(july4, NY), true)

  const july5 = Date.UTC(2024, 6, 5, 17, 0, 0)
  assert.strictEqual(isUsFederalHoliday(july5, NY), false)
})

test("isWithinSendWindow: hour and weekend rules (America/Chicago)", () => {
  const rules = { startHour: 9, endHour: 17, weekdaysOnly: true }

  // Monday Jan 8, 2024, 10:00 CST — inside the window.
  assert.strictEqual(
    isWithinSendWindow(Date.UTC(2024, 0, 8, 16, 0, 0), CHICAGO, rules),
    true
  )

  // Monday Jan 8, 2024, 06:00 CST — before the window opens.
  assert.strictEqual(
    isWithinSendWindow(Date.UTC(2024, 0, 8, 12, 0, 0), CHICAGO, rules),
    false
  )

  // Saturday Jan 6, 2024, 10:00 CST — weekend, excluded regardless of hour.
  assert.strictEqual(
    isWithinSendWindow(Date.UTC(2024, 0, 6, 16, 0, 0), CHICAGO, rules),
    false
  )
})

test("nextSendWindowStart: already inside the window returns the same instant", () => {
  const rules = { startHour: 9, endHour: 17, weekdaysOnly: true }
  const withinWindow = Date.UTC(2024, 0, 8, 16, 0, 0) // Mon Jan 8 2024, 10:00 CST
  assert.strictEqual(
    nextSendWindowStart(withinWindow, CHICAGO, rules),
    withinWindow
  )
})

test("nextSendWindowStart: weekend rollover skips Sat/Sun to Monday (America/Chicago)", () => {
  const rules = { startHour: 9, endHour: 17, weekdaysOnly: true }
  // Friday Jan 5, 2024, 18:00 CST — after hours.
  const fridayEvening = Date.UTC(2024, 0, 6, 0, 0, 0)
  const result = nextSendWindowStart(fridayEvening, CHICAGO, rules)
  // Should land on Monday Jan 8, 2024, 09:00 CST, skipping Sat/Sun entirely.
  assert.strictEqual(result, Date.UTC(2024, 0, 8, 15, 0, 0))
})

test("nextSendWindowStart: holiday is skipped even on an otherwise valid weekday", () => {
  const rules = { startHour: 9, endHour: 17, weekdaysOnly: true }
  // Wed Jul 3, 2024, 20:00 EDT — after hours, day before the Jul 4 holiday.
  const wedEvening = Date.UTC(2024, 6, 4, 0, 0, 0)
  const result = nextSendWindowStart(wedEvening, NY, rules)
  // Jul 4 (Thu) is a federal holiday, so the next window is Fri Jul 5, 09:00 EDT.
  assert.strictEqual(result, Date.UTC(2024, 6, 5, 13, 0, 0))
})
