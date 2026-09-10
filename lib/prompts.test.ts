import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildFirstEmailSystemPrompt,
  expandSpintax,
  fillTemplate,
  renderFixedReply,
  replyClassificationSchema,
  FIXED_REPLY_TEMPLATES,
  type SenderInfo,
} from "./prompts.ts"

test("expandSpintax: resolves every {a|b|c} group and leaves no braces behind", () => {
  const text = "{Hi|Hello} there, {this is a test|just testing}."
  for (let i = 0; i < 25; i++) {
    const result = expandSpintax(text)
    assert.ok(!/[{}]/.test(result), `left braces in: ${result}`)
    assert.ok(
      result === "Hi there, this is a test." ||
        result === "Hi there, just testing." ||
        result === "Hello there, this is a test." ||
        result === "Hello there, just testing."
    )
  }
})

test("expandSpintax: supports nesting", () => {
  const text = "{Hi|Hello {there|friend}}"
  for (let i = 0; i < 25; i++) {
    const result = expandSpintax(text)
    assert.ok(
      ["Hi", "Hello there", "Hello friend"].includes(result),
      `unexpected: ${result}`
    )
  }
})

test("expandSpintax: text with no spintax passes through unchanged", () => {
  assert.strictEqual(
    expandSpintax("plain text, no braces"),
    "plain text, no braces"
  )
})

test("fillTemplate: substitutes %%token%% and leaves unknown tokens untouched", () => {
  const result = fillTemplate(
    "Hi %%name%%, from %%company%%. Unknown: %%missing%%.",
    {
      name: "Alex",
      company: "Acme",
    }
  )
  assert.strictEqual(result, "Hi Alex, from Acme. Unknown: %%missing%%.")
})

test("fillTemplate and expandSpintax do not corrupt each other regardless of order", () => {
  const template = "{Hi|Hello} %%name%%, {welcome|hey}."
  const sender = { name: "Alex" }

  const spinFirst = fillTemplate(expandSpintax(template), sender)
  const fillFirst = expandSpintax(fillTemplate(template, sender))

  for (const result of [spinFirst, fillFirst]) {
    assert.ok(!/[{}]/.test(result), `left spintax braces in: ${result}`)
    assert.ok(!result.includes("%%"), `left an unresolved token in: ${result}`)
    assert.ok(
      result.includes("Alex"),
      `dropped the interpolated name: ${result}`
    )
  }
})

test("renderFixedReply: send_more_info includes the sender's identity and address verbatim, no leftover markup", () => {
  const sender: SenderInfo = {
    name: "Jordan Rivera",
    company: "Buckeye Vending Co.",
    address: "123 Main St, Columbus, OH 43215",
  }
  const rendered = renderFixedReply("send_more_info", sender)

  assert.ok(rendered.includes(sender.name))
  assert.ok(rendered.includes(sender.company))
  assert.ok(rendered.includes(sender.address))
  assert.ok(!/[{}]/.test(rendered), `left spintax braces in: ${rendered}`)
  assert.ok(
    !rendered.includes("%%"),
    `left an unresolved token in: ${rendered}`
  )
  // The whole point of FIXED_REPLY_TEMPLATES: verify the source is a literal
  // string, not something that could plausibly call out to a model.
  assert.strictEqual(typeof FIXED_REPLY_TEMPLATES.send_more_info, "string")
})

test("replyClassificationSchema: accepts a well-formed classification", () => {
  const parsed = replyClassificationSchema.parse({
    intent: "send_more_info",
    ready_to_talk: false,
    evidence_span: "can you send more details",
    reason: "They asked for more information before deciding.",
  })
  assert.strictEqual(parsed.intent, "send_more_info")
})

test("replyClassificationSchema: rejects an intent outside the fixed enum", () => {
  assert.throws(() =>
    replyClassificationSchema.parse({
      intent: "interested_but_needs_approval", // not in REPLY_INTENTS
      ready_to_talk: true,
      evidence_span: "quote",
      reason: "reason",
    })
  )
})

test("replyClassificationSchema: rejects a missing evidence_span", () => {
  assert.throws(() =>
    replyClassificationSchema.parse({
      intent: "not_interested",
      ready_to_talk: false,
      evidence_span: "",
      reason: "reason",
    })
  )
})

// ---------------------------------------------------------------------------
// The first email, with and without a fact
// ---------------------------------------------------------------------------

const OWNER: SenderInfo = {
  name: "Mudasir Ahmed",
  company: "Northview Supply Vending",
  address: "3070 Ellesmere Rd, Scarborough, ON M1E 4C2",
  phone: "6477679652",
  offerTerms:
    "a share of what the machine sells, no fees, no minimums, we stock it and fix it",
}

test("with a fact, the email is required to open on it", () => {
  const prompt = buildFirstEmailSystemPrompt(OWNER, "CA", { hasFact: true })

  assert.match(
    prompt,
    /first two sentences must reference the one verified fact/i
  )
})

test("with no fact, the model is never told to reference one", () => {
  // Left in, the instruction asks for something the model was not given —
  // which is an instruction to invent it.
  const prompt = buildFirstEmailSystemPrompt(OWNER, "CA", { hasFact: false })

  assert.doesNotMatch(prompt, /the one verified fact/i)
  assert.doesNotMatch(prompt, /fact you're given/i)
})

test("with no fact, inventing a detail is forbidden outright", () => {
  const prompt = buildFirstEmailSystemPrompt(OWNER, "CA", { hasFact: false })

  assert.match(prompt, /have not been given/i)
  assert.match(prompt, /do not invent/i)
})

test("the offer terms carry the email when nothing else can", () => {
  // This is what makes a fact-free email worth sending: the offer is
  // genuinely good and entirely true, so it can be stated plainly.
  const prompt = buildFirstEmailSystemPrompt(OWNER, "CA", { hasFact: false })

  assert.match(prompt, /no fees, no minimums/)
})

test("every rule that keeps the email lawful survives losing the fact", () => {
  const withFact = buildFirstEmailSystemPrompt(OWNER, "CA", { hasFact: true })
  const without = buildFirstEmailSystemPrompt(OWNER, "CA", { hasFact: false })

  for (const required of [
    /plain text only/i,
    /opt-out/i,
    /Northview Supply Vending/,
    /3070 Ellesmere Rd/,
  ]) {
    assert.match(withFact, required)
    assert.match(
      without,
      required,
      `lost from the fact-free prompt: ${required}`
    )
  }
})

test("a fact is assumed when the caller does not say", () => {
  // The old signature had two arguments and every existing caller still uses
  // it; defaulting the other way would quietly drop the grounding rule.
  assert.equal(
    buildFirstEmailSystemPrompt(OWNER, "CA"),
    buildFirstEmailSystemPrompt(OWNER, "CA", { hasFact: true })
  )
})

test("with no fact, the direction of the email is stated outright", () => {
  // A real draft from a weak model opened "Thank you for reaching out to
  // TEVA" — it wrote a reply *from* the business instead of a cold email
  // *to* them. With a fact in hand the model stays oriented; without one
  // there is nothing anchoring who is writing to whom, so the prompt says it.
  const prompt = buildFirstEmailSystemPrompt(OWNER, "CA", { hasFact: false })

  assert.match(prompt, /writing TO this business, cold/i)
  assert.match(prompt, /never write as though answering them/i)
})
