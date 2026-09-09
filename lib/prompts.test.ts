import { test } from "node:test"
import assert from "node:assert/strict"
import {
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
    assert.ok(result === "Hi there, this is a test." || result === "Hi there, just testing." ||
      result === "Hello there, this is a test." || result === "Hello there, just testing.")
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
  assert.strictEqual(expandSpintax("plain text, no braces"), "plain text, no braces")
})

test("fillTemplate: substitutes %%token%% and leaves unknown tokens untouched", () => {
  const result = fillTemplate("Hi %%name%%, from %%company%%. Unknown: %%missing%%.", {
    name: "Alex",
    company: "Acme",
  })
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
    assert.ok(result.includes("Alex"), `dropped the interpolated name: ${result}`)
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
  assert.ok(!rendered.includes("%%"), `left an unresolved token in: ${rendered}`)
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
