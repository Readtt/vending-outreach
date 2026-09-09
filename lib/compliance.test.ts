/**
 * What the two countries make us put in an email, and what refuses to write
 * one without it.
 *
 * These are the checks that keep the Canadian half of the app honest. The
 * bounding strips decide who gets emailed; this decides what the email has to
 * say once it is written.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  buildFirstEmailSystemPrompt,
  buildFollowUpDay4SystemPrompt,
  buildFollowUpDay9SystemPrompt,
  complianceInstruction,
  type SenderInfo,
} from "./prompts.ts"
import { loadSenderInfo } from "../worker/handlers/common.ts"

const SENDER: SenderInfo = {
  name: "Jordan Rivera",
  company: "Buckeye Vending Co.",
  address: "1200 N High St, Suite 240, Columbus, OH 43201",
  phone: "(614) 555-0100",
}

test("a US email is told to carry the postal address and nothing more", () => {
  const text = complianceInstruction(SENDER, "US")
  assert.match(text, /1200 N High St/)
  assert.match(text, /CAN-SPAM/)
  assert.doesNotMatch(text, /CASL/)
})

test("a Canadian email is told to carry a second contact detail too", () => {
  const text = complianceInstruction(SENDER, "CA")
  assert.match(text, /1200 N High St/)
  assert.match(text, /CASL/)
  // CASL s.6(2)(a): the address plus at least one of phone, email or web.
  assert.match(text, /\(614\) 555-0100/)
  assert.match(text, /sender's name and their business name/)
})

test("a Canadian email falls back to the website when there is no phone", () => {
  const web: SenderInfo = {
    ...SENDER,
    phone: undefined,
    website: "https://buckeyevending.example",
  }
  assert.match(complianceInstruction(web, "CA"), /buckeyevending\.example/)
})

test("every message in the sequence carries the compliance lines", () => {
  // A follow-up is a commercial electronic message in its own right. Carrying
  // the address on the first email only is the mistake worth a test.
  const builders = [
    buildFirstEmailSystemPrompt,
    buildFollowUpDay4SystemPrompt,
    buildFollowUpDay9SystemPrompt,
  ]
  for (const build of builders) {
    for (const country of ["US", "CA"] as const) {
      const prompt = build(SENDER, country)
      assert.match(prompt, /1200 N High St/, `${build.name} / ${country}`)
      assert.match(prompt, /opt-out/i, `${build.name} / ${country}`)
    }
  }
})

test("the country defaults to the US, so an old call site keeps its meaning", () => {
  assert.equal(
    complianceInstruction(SENDER),
    complianceInstruction(SENDER, "US")
  )
})

// ---------------------------------------------------------------------------
// loadSenderInfo
// ---------------------------------------------------------------------------

/** Stands in for the `about` settings row. */
function reader(about: Record<string, string>) {
  return <T>(key: string): T | undefined =>
    key === "about" ? (about as unknown as T) : undefined
}

const COMPLETE = {
  name: "Jordan Rivera",
  company: "Buckeye Vending Co.",
  address: "1200 N High St, Columbus, OH 43201",
}

test("composing for a Canadian lead refuses without a phone or a website", () => {
  const result = loadSenderInfo(reader(COMPLETE), "CA")
  assert.equal(result.sender, undefined)
  assert.equal(result.missing.length, 1)
  assert.match(result.missing[0], /Phone or Website/)
  assert.match(result.missing[0], /CASL/)
})

test("the same settings are enough for a US lead", () => {
  // The point of the check above is that it adds a requirement rather than
  // changing one: CAN-SPAM asks for the address and nothing else.
  const result = loadSenderInfo(reader(COMPLETE), "US")
  assert.equal(result.missing.length, 0)
  assert.equal(result.sender?.address, COMPLETE.address)
})

test("either a phone or a website satisfies the Canadian requirement", () => {
  for (const extra of [
    { phone: "(614) 555-0100" },
    { website: "https://buckeyevending.example" },
  ]) {
    const result = loadSenderInfo(reader({ ...COMPLETE, ...extra }), "CA")
    assert.equal(result.missing.length, 0, JSON.stringify(extra))
    assert.ok(result.sender)
  }
})

test("a missing address is still refused for both countries", () => {
  for (const country of ["US", "CA"] as const) {
    const result = loadSenderInfo(
      reader({ name: "Jordan", company: "Buckeye", phone: "(614) 555-0100" }),
      country
    )
    assert.equal(result.sender, undefined)
    assert.ok(result.missing.some((m) => /address/i.test(m)))
  }
})
