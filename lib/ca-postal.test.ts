/**
 * Tests for Canadian postal code lookup.
 *
 * The bug these exist for: every Canadian postal code failed to geocode,
 * because Nominatim has none of them and nothing else was tried. The first
 * test is the exact string that was reported.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  describeFsa,
  findPostalCodeIn,
  fsaTableSize,
  locateCanadianPostalCode,
  locateEmbeddedPostalCode,
  lookupFsa,
  parsePostalCode,
} from "./ca-postal.ts"

test("the reported postal code resolves to Scarborough", () => {
  const found = locateCanadianPostalCode("M1E 4C2")
  assert.ok(found, '"M1E 4C2" must resolve — this is the reported bug')
  assert.equal(found.fsa, "M1E")
  assert.equal(found.province, "ON")
  // Scarborough is around 43.77 N, 79.19 W. A degree of latitude is ~69
  // miles, so this tolerance is about 7 miles — tight enough to catch a
  // transposed sign or a swapped lat/lng, loose enough not to break when
  // GeoNames nudges a centroid.
  assert.ok(Math.abs(found.lat - 43.77) < 0.1, `latitude was ${found.lat}`)
  assert.ok(Math.abs(found.lng - -79.19) < 0.1, `longitude was ${found.lng}`)
})

test("the whole country is covered", () => {
  // Canada has ~1,650 FSAs. A table that had silently shrunk would show up
  // as "some postal codes don't work", which is exactly the failure this
  // module was written to end.
  assert.ok(
    fsaTableSize() > 1600,
    `only ${fsaTableSize()} FSAs in the table, expected ~1650`
  )

  // One from each province and territory, so a regional gap cannot pass.
  const perProvince: Record<string, string> = {
    NL: "A1C",
    NS: "B3H",
    PE: "C1A",
    NB: "E3B",
    QC: "H3B",
    ON: "M5V",
    MB: "R3C",
    SK: "S7K",
    AB: "T2P",
    BC: "V6B",
    NT: "X1A",
    NU: "X0A",
    YT: "Y1A",
  }
  for (const [province, fsa] of Object.entries(perProvince)) {
    const found = lookupFsa(fsa)
    assert.ok(found, `${fsa} (${province}) is missing from the table`)
    assert.equal(found.province, province, `${fsa} is in the wrong province`)
    assert.ok(
      found.lat > 41 && found.lat < 84,
      `${fsa} has a latitude outside Canada: ${found.lat}`
    )
    assert.ok(
      found.lng > -142 && found.lng < -52,
      `${fsa} has a longitude outside Canada: ${found.lng}`
    )
  }
})

test("postal codes are accepted however they are typed", () => {
  for (const written of [
    "M1E 4C2",
    "m1e 4c2",
    "M1E4C2",
    "m1e4c2",
    "M1E-4C2",
    "  M1E 4C2  ",
    "M1E",
    "m1e",
  ]) {
    assert.equal(
      parsePostalCode(written),
      "M1E",
      `"${written}" should parse to M1E`
    )
  }
})

test("ordinary place names are not mistaken for postal codes", () => {
  // The cost of a false positive here is a search silently centred on the
  // wrong city, so this is the more important direction to get right.
  for (const notAPostalCode of [
    "London, ON",
    "Columbus, OH",
    "43215",
    "43215-1234",
    "Toronto",
    "Scarborough",
    "M1",
    "M1E 4C",
    "M1E 4C22",
    "1M1 E4C",
    "",
    "   ",
    // D, F, I, O, Q and U are never issued by Canada Post, so these are
    // shaped like postal codes without being possible ones.
    "D1E 4C2",
    "F1E 4C2",
    "I1E 4C2",
    "O1E 4C2",
    "Q1E 4C2",
    "U1E 4C2",
    // W and Z are legal later but never first.
    "W1E 4C2",
    "Z1E 4C2",
  ]) {
    assert.equal(
      parsePostalCode(notAPostalCode),
      undefined,
      `"${notAPostalCode}" must not parse as a postal code`
    )
  }
})

test("a postal code pasted inside an address is found", () => {
  for (const pasted of [
    "Toronto, ON M1E 4C2",
    "M1E 4C2, Canada",
    "123 Main St, Scarborough, ON, M1E 4C2",
    "M1E 4C2 Canada",
  ]) {
    assert.equal(
      findPostalCodeIn(pasted),
      "M1E",
      `"${pasted}" should yield M1E`
    )
  }

  const found = locateEmbeddedPostalCode("Toronto, ON M1E 4C2")
  assert.ok(found)
  assert.equal(found.fsa, "M1E")
})

test("a bare FSA inside a sentence is not treated as a postal code", () => {
  // Three characters loose in a longer string is a coincidence waiting to
  // happen, so the embedded form insists on all six.
  assert.equal(findPostalCodeIn("Some Place M1E Road"), undefined)
  assert.equal(findPostalCodeIn("London, ON"), undefined)
})

test("a well-formed code for an FSA that does not exist returns nothing", () => {
  // Shaped correctly, and Canada Post has never issued it. The caller has to
  // be able to tell this apart from a hit, so it must not throw.
  assert.equal(parsePostalCode("B9Z 9Z9"), "B9Z")
  assert.equal(locateCanadianPostalCode("B9Z 9Z9"), undefined)
})

test("the resolved place is described as a neighbourhood, not an address", () => {
  const found = locateCanadianPostalCode("M1E 4C2")
  assert.ok(found)
  const described = describeFsa(found)
  assert.match(described, /Scarborough/)
  assert.match(described, /ON/)
  // Naming the FSA is what stops "found your postal code" from reading as
  // "found your building".
  assert.match(described, /M1E/)
})
