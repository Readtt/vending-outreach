/**
 * Tests for the per-role model suggestions.
 *
 * Pure functions over a list of model ids, so there is no database and no
 * network here. What is being pinned down is the matching rule: the same model
 * arrives under different ids depending on which provider you buy it from, and
 * a sloppy match quietly picks the wrong one.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import { AI_ROLES, suggestDefaultModelId } from "./ai-roles.ts"

test("picks a model straight from Anthropic", () => {
  const catalogue = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"]
  assert.equal(suggestDefaultModelId("writer", catalogue), "claude-opus-5")
  assert.equal(suggestDefaultModelId("triage", catalogue), "claude-haiku-4-5")
  assert.equal(suggestDefaultModelId("research", catalogue), "claude-haiku-4-5")
})

test("picks the same models behind OpenRouter's vendor prefix and dotted versions", () => {
  const catalogue = [
    "anthropic/claude-opus-5",
    "anthropic/claude-haiku-4.5",
    "openai/gpt-5.5",
  ]
  assert.equal(
    suggestDefaultModelId("writer", catalogue),
    "anthropic/claude-opus-5"
  )
  assert.equal(
    suggestDefaultModelId("triage", catalogue),
    "anthropic/claude-haiku-4.5"
  )
})

test("never picks a batch variant, which answers hours later", () => {
  // OpenRouter lists `:batch` alongside the normal id. Choosing one would hang
  // every email in the queue waiting for an answer that arrives tomorrow.
  const catalogue = ["anthropic/claude-opus-5:batch", "openai/gpt-4o"]
  assert.equal(suggestDefaultModelId("writer", catalogue), "openai/gpt-4o")
})

test("does not let a mini model stand in for the full one", () => {
  // A substring match would hand the writing job to gpt-4o-mini, which is a
  // silent downgrade of the only text a stranger ever reads.
  assert.equal(
    suggestDefaultModelId("writer", ["openai/gpt-4o-mini"]),
    undefined
  )
  assert.equal(
    suggestDefaultModelId("triage", ["openai/gpt-4o-mini"]),
    "openai/gpt-4o-mini"
  )
})

test("prefers the cheaper model for the two high-volume jobs", () => {
  const catalogue = ["gemini-2.5-pro", "gemini-2.5-flash-lite"]
  assert.equal(suggestDefaultModelId("writer", catalogue), "gemini-2.5-pro")
  assert.equal(
    suggestDefaultModelId("triage", catalogue),
    "gemini-2.5-flash-lite"
  )
})

test("returns nothing rather than guessing at an unknown catalogue", () => {
  const catalogue = ["some-local-model", "another-one:7b"]
  for (const role of AI_ROLES) {
    assert.equal(suggestDefaultModelId(role, catalogue), undefined)
  }
})

test("returns nothing for an empty catalogue", () => {
  for (const role of AI_ROLES) {
    assert.equal(suggestDefaultModelId(role, []), undefined)
  }
})
