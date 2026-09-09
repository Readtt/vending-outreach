import { test } from "node:test"
import assert from "node:assert/strict"
import {
  bodyRequestsOptOut,
  detectLoopSignal,
  extractAddress,
  getHeader,
  getHeaderAll,
  outboundLoopHeaders,
  triage,
  type InboundMessage,
  type RawHeaders,
} from "./triage.ts"

const LEAD = "owner@acme.example"
const OUR_MAILBOX = "sales@vendingco.example"

function msg(
  headers: RawHeaders,
  body = "Thanks for the note.",
  overrides: Partial<InboundMessage> = {}
): InboundMessage {
  return {
    headers,
    body,
    leadEmail: LEAD,
    ourMailboxes: [OUR_MAILBOX],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Header access
// ---------------------------------------------------------------------------

test("header lookup is case-insensitive and handles repeated headers", () => {
  const headers: RawHeaders = {
    "MESSAGE-ID": "<a@b>",
    received: ["from one", "from two"],
    "  Subject  ": "  Re: hello  ",
  }
  assert.equal(getHeader(headers, "message-id"), "<a@b>")
  assert.equal(getHeader(headers, "Message-Id"), "<a@b>")
  assert.deepEqual(getHeaderAll(headers, "RECEIVED"), ["from one", "from two"])
  assert.equal(getHeader(headers, "subject"), "Re: hello")
  assert.equal(getHeader(headers, "nope"), undefined)
})

test("extractAddress pulls a bare lowercase address out of any From shape", () => {
  assert.equal(
    extractAddress('"Dana Owner" <Dana@Acme.Example>'),
    "dana@acme.example"
  )
  assert.equal(extractAddress("dana@acme.example"), "dana@acme.example")
  assert.equal(extractAddress("<>"), undefined)
  assert.equal(extractAddress(undefined), undefined)
})

// ---------------------------------------------------------------------------
// Rules 1 + 2 — bounces
// ---------------------------------------------------------------------------

function dsnBody(
  status: string,
  recipient: string,
  diagnostic: string
): string {
  return [
    "This is an automatically generated Delivery Status Notification.",
    "",
    "--000000000000abcd",
    "Content-Type: message/delivery-status",
    "",
    "Reporting-MTA: dns; mail.example.com",
    "",
    `Final-Recipient: rfc822; ${recipient}`,
    "Action: failed",
    `Status: ${status}`,
    `Diagnostic-Code: smtp; ${diagnostic}`,
    "",
    "--000000000000abcd--",
  ].join("\n")
}

test("rule 2: a DSN with Status 5.1.1 is a HARD bounce and names the recipient", () => {
  const verdict = triage(
    msg(
      {
        "Content-Type":
          'multipart/report; report-type=delivery-status; boundary="000000000000abcd"',
        From: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
        Subject: "Delivery Status Notification (Failure)",
      },
      dsnBody(
        "5.1.1",
        "gone@dead-domain.example",
        "550 5.1.1 The email account does not exist."
      )
    )
  )

  assert.equal(verdict.action, "bounce")
  assert.equal(verdict.action === "bounce" && verdict.hard, true)
  assert.equal(
    verdict.action === "bounce" && verdict.recipient,
    "gone@dead-domain.example"
  )
})

test("rule 2: a DSN with Status 4.2.2 is a SOFT bounce", () => {
  const verdict = triage(
    msg(
      {
        "content-type": "multipart/report; report-type=delivery-status",
        from: "postmaster@example.com",
      },
      dsnBody("4.2.2", "full@acme.example", "452 4.2.2 Mailbox full")
    )
  )

  assert.equal(verdict.action, "bounce")
  assert.equal(verdict.action === "bounce" && verdict.hard, false)
  assert.equal(
    verdict.action === "bounce" && verdict.recipient,
    "full@acme.example"
  )
})

test("rule 2: X-Failed-Recipients alone is enough to call it a bounce", () => {
  const verdict = triage(
    msg(
      {
        From: "mailer-daemon@googlemail.com",
        "X-Failed-Recipients": "gone@acme.example",
      },
      "Your message wasn't delivered to gone@acme.example."
    )
  )
  assert.equal(verdict.action, "bounce")
  assert.equal(
    verdict.action === "bounce" && verdict.recipient,
    "gone@acme.example"
  )
})

test("rule 1: a null Return-Path still yields the DSN's hard/soft classification", () => {
  // Rule 1 sits above rule 2 and every real DSN carries BOTH. Returning early
  // without parsing would throw away hard-vs-soft on every bounce we see.
  const verdict = triage(
    msg(
      {
        "Return-Path": "<>",
        "Content-Type": "multipart/report; report-type=delivery-status",
        From: "MAILER-DAEMON@example.com",
      },
      dsnBody("5.7.1", "blocked@acme.example", "550 5.7.1 Message rejected")
    )
  )
  assert.equal(verdict.action, "bounce")
  assert.equal(verdict.action === "bounce" && verdict.hard, true)
  assert.equal(
    verdict.action === "bounce" && verdict.recipient,
    "blocked@acme.example"
  )
})

test("rule 1: an unparseable bounce defaults to SOFT rather than suppressing a live lead", () => {
  const verdict = triage(
    msg(
      { "Return-Path": "<>" },
      "Your message could not be delivered at this time."
    )
  )
  assert.equal(verdict.action, "bounce")
  assert.equal(verdict.action === "bounce" && verdict.hard, false)
  assert.match(verdict.reason, /defaulted to soft/)
})

// ---------------------------------------------------------------------------
// Rules 3-6 — machine mail
// ---------------------------------------------------------------------------

test("rule 3: an Exchange out-of-office (Auto-Submitted: auto-replied) is ignored, never replied to", () => {
  const verdict = triage(
    msg(
      {
        From: LEAD,
        Subject: "Automatic reply: Quick question about your break room",
        "Auto-Submitted": "auto-replied (out of office)",
        "X-MS-Exchange-Parent-Message-Id": "<abc@acme.example>",
      },
      "I am out of the office until March 4th with limited access to email."
    )
  )
  assert.equal(verdict.action, "ignore")
  assert.match(verdict.reason, /Auto-Submitted/)
})

test("rule 3: Auto-Submitted: no does not stop an ordinary human reply", () => {
  const verdict = triage(
    msg(
      { From: LEAD, "auto-submitted": "no", Subject: "Re: quick question" },
      "Happy to hear more, what does the placement process look like on your end?"
    )
  )
  assert.equal(verdict.action, "classify")
})

test("rule 4: Precedence: bulk is ignored", () => {
  const verdict = triage(
    msg(
      { From: LEAD, Precedence: "bulk", Subject: "Newsletter" },
      "This month at Acme..."
    )
  )
  assert.equal(verdict.action, "ignore")
  assert.match(verdict.reason, /Precedence: bulk/)
})

test("rule 4: List-Unsubscribe is ignored", () => {
  const verdict = triage(
    msg(
      { From: LEAD, "List-Unsubscribe": "<mailto:x@y.example>" },
      "Weekly digest"
    )
  )
  assert.equal(verdict.action, "ignore")
  assert.match(verdict.reason, /list-unsubscribe/)
})

test("rule 5: vendor autoresponder headers are ignored", () => {
  for (const name of [
    "X-Auto-Response-Suppress",
    "X-Autoreply",
    "X-Autorespond",
    "X-MS-Exchange-Inbox-Rules-Loop",
  ]) {
    const verdict = triage(msg({ From: LEAD, [name]: "yes" }, "Away from desk"))
    assert.equal(verdict.action, "ignore", name)
  }
})

test("rule 6: a no-reply / daemon local part is ignored", () => {
  for (const from of [
    "MAILER-DAEMON@example.com",
    "postmaster@example.com",
    "no-reply@acme.example",
    "do_not_reply@acme.example",
    "bounces+tag123@acme.example",
    "notifications@acme.example",
  ]) {
    const verdict = triage(msg({ From: from }, "Automated notice."))
    assert.equal(verdict.action, "ignore", from)
  }
})

// ---------------------------------------------------------------------------
// Rule 7 — loop detection
// ---------------------------------------------------------------------------

test("rule 7: our own X-Loop header coming back is a loop escalation", () => {
  const verdict = triage(
    msg(
      { From: LEAD, Subject: "Re: quick question", "X-Loop": OUR_MAILBOX },
      "Thanks!"
    )
  )
  assert.equal(verdict.action, "escalate")
  assert.match(verdict.reason, /LOOP ALARM/)
})

test("rule 7: X-Loop quoted inside the body is also a loop escalation", () => {
  const verdict = triage(
    msg(
      { From: LEAD, Subject: "Re: quick question" },
      [
        "Auto-response follows.",
        "",
        "> Received: from mail.vendingco.example",
        `> X-Loop: ${OUR_MAILBOX}`,
        "> Subject: Quick question",
      ].join("\n")
    )
  )
  assert.equal(verdict.action, "escalate")
  assert.match(verdict.reason, /LOOP ALARM/)
})

test("rule 7: a From that is one of our own mailboxes is a loop escalation", () => {
  const verdict = triage(
    msg(
      { From: `Sales <${OUR_MAILBOX}>`, Subject: "Quick question" },
      "Hi there"
    )
  )
  assert.equal(verdict.action, "escalate")
  assert.match(verdict.reason, /own mailboxes/)
})

test("detectLoopSignal fires independently of the verdict ordering", () => {
  // Our own auto-reply carries BOTH X-Loop and Auto-Submitted. Rule 3 wins the
  // verdict (ignore), but the alarm must still be available to the caller.
  const looping = msg(
    {
      From: LEAD,
      "Auto-Submitted": "auto-replied",
      "X-Loop": OUR_MAILBOX,
    },
    "Out of office."
  )
  assert.equal(triage(looping).action, "ignore")
  assert.match(detectLoopSignal(looping) ?? "", /LOOP ALARM/)
  assert.equal(detectLoopSignal(msg({ From: LEAD }, "hello")), undefined)
})

// ---------------------------------------------------------------------------
// Rules 8, 9 — invites and ticket systems
// ---------------------------------------------------------------------------

test("rule 8: a calendar invitation escalates", () => {
  const fromHeader = triage(
    msg(
      {
        From: LEAD,
        "Content-Type": 'text/calendar; method=REQUEST; charset="UTF-8"',
        Subject: "Invitation: Vending walkthrough",
      },
      "BEGIN:VCALENDAR"
    )
  )
  assert.equal(fromHeader.action, "escalate")
  assert.match(fromHeader.reason, /calendar/)

  const fromPart = triage(
    msg(
      { From: LEAD, "Content-Type": 'multipart/mixed; boundary="b"' },
      [
        "--b",
        "Content-Type: text/calendar; method=REQUEST",
        "",
        "BEGIN:VCALENDAR",
      ].join("\n")
    )
  )
  assert.equal(fromPart.action, "escalate")
})

test("rule 9: a ticket marker in the subject is ignored (ticket systems loop forever)", () => {
  for (const subject of [
    "Re: quick question [#12345]",
    "Your request Ticket ID: 44192",
    "RE: Vending Case #99120",
    "[SUP-4412] Re: quick question",
  ]) {
    const verdict = triage(
      msg({ From: LEAD, Subject: subject }, "Thanks, we got your message.")
    )
    assert.equal(verdict.action, "ignore", subject)
    assert.match(verdict.reason, /ticket marker/)
  }
})

// ---------------------------------------------------------------------------
// Rule 10 — the sender must be the lead
// ---------------------------------------------------------------------------

test("rule 10: a reply from a third party escalates instead of auto-replying", () => {
  const verdict = triage(
    msg(
      { From: "someone-else@other.example", Subject: "Fwd: Quick question" },
      "Passing this along, is this something we want?"
    )
  )
  assert.equal(verdict.action, "escalate")
  assert.match(verdict.reason, /third party/)
})

test("rule 10: a same-domain colleague escalates with a distinguishable reason", () => {
  const verdict = triage(
    msg(
      { From: "dana@acme.example", Subject: "Re: Quick question" },
      "I handle facilities, tell me more about how this works for our site."
    )
  )
  assert.equal(verdict.action, "escalate")
  assert.match(verdict.reason, /same domain/)
})

test("rule 10: a missing From escalates", () => {
  const verdict = triage(
    msg({ Subject: "Re: Quick question" }, "Sure, tell me more.")
  )
  assert.equal(verdict.action, "escalate")
  assert.match(verdict.reason, /From/)
})

// ---------------------------------------------------------------------------
// Rules 11-14 — body-driven
// ---------------------------------------------------------------------------

test("rule 11: 'please take me off your list' suppresses permanently", () => {
  const verdict = triage(
    msg(
      { From: LEAD, Subject: "Re: Quick question" },
      "Please take me off your list."
    )
  )
  assert.equal(verdict.action, "suppress")
  assert.match(verdict.reason, /OPT_OUT_RE/)
})

test("rule 11: an opt-out below a long quoted chain still suppresses", () => {
  const quoted = Array.from(
    { length: 40 },
    () => "> I place vending machines at no cost to the host location."
  ).join("\n")
  const verdict = triage(
    msg(
      { From: LEAD, Subject: "Re: Quick question" },
      [
        "On Mon, Jan 1, 2024 at 9:04 AM Sales <sales@vendingco.example> wrote:",
        quoted,
        "",
        "Do not email me again.",
      ].join("\n")
    )
  )
  assert.equal(verdict.action, "suppress")
})

test("rule 12: a short negative reply escalates and is never auto-sent to", () => {
  for (const body of [
    "No thanks.",
    "Not for us.",
    "wrong person",
    "We're all set.",
  ]) {
    const verdict = triage(
      msg({ From: LEAD, Subject: "Re: Quick question" }, body)
    )
    assert.equal(verdict.action, "escalate", body)
    assert.match(verdict.reason, /short reply/)
  }
})

test("rule 13: an out-of-office known only by its subject escalates, never ignores", () => {
  for (const subject of [
    "Automatic reply: Quick question",
    "Out of Office: Quick question",
    "Auto: Quick question",
    "Abwesenheitsnotiz: Quick question",
    "Réponse automatique : Quick question",
  ]) {
    const verdict = triage(
      msg(
        { From: LEAD, Subject: subject },
        "I am away from the office until the fourth of March and will reply to your message when I return to the office."
      )
    )
    assert.equal(verdict.action, "escalate", subject)
    assert.match(verdict.reason, /autoresponder/)
  }
})

test("rule 14: a plain human reply is the only thing that reaches a model", () => {
  const verdict = triage(
    msg(
      {
        From: `"Dana Owner" <${LEAD}>`,
        Subject: "Re: Quick question about your break room",
        "Message-ID": "<z1@acme.example>",
      },
      "Thanks for reaching out. We would be interested in hearing more about how the placement works and what the timeline looks like. Can you send some details?"
    )
  )
  assert.equal(verdict.action, "classify")
})

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

test("first match wins: a DSN whose quoted body contains opt-out words is still a bounce", () => {
  const verdict = triage(
    msg(
      {
        "Return-Path": "<>",
        "Content-Type": "multipart/report; report-type=delivery-status",
        From: "mailer-daemon@example.com",
      },
      `${dsnBody("5.1.1", "gone@acme.example", "550 5.1.1 no such user")}\n\nplease unsubscribe`
    )
  )
  assert.equal(verdict.action, "bounce")
})

test("bodyRequestsOptOut closes the gap left by the ignore rules sitting above rule 11", () => {
  // Both list-stamped AND an opt-out. The spec's order returns `ignore`, which
  // stops the *reply* but not the scheduled follow-up. Anything scheduling a
  // follow-up must consult bodyRequestsOptOut as well.
  const listed = msg(
    { From: LEAD, Precedence: "bulk", Subject: "Re: Quick question" },
    "Please remove me from your list and stop emailing me."
  )
  assert.equal(triage(listed).action, "ignore")
  assert.equal(bodyRequestsOptOut(listed), true)

  const ordinary = msg({ From: LEAD }, "Sounds interesting, send details.")
  assert.equal(bodyRequestsOptOut(ordinary), false)
})

// ---------------------------------------------------------------------------
// outboundLoopHeaders
// ---------------------------------------------------------------------------

test("outboundLoopHeaders: X-Loop always, Auto-Submitted only on auto-replies", () => {
  assert.deepEqual(outboundLoopHeaders(OUR_MAILBOX, false), {
    "X-Loop": OUR_MAILBOX,
  })
  assert.deepEqual(outboundLoopHeaders(` ${OUR_MAILBOX} `, true), {
    "X-Loop": OUR_MAILBOX,
    "Auto-Submitted": "auto-replied",
  })
})

test("outboundLoopHeaders: refuses anything that would produce a useless or unsafe header", () => {
  assert.throws(() => outboundLoopHeaders("", false), /empty/)
  assert.throws(() => outboundLoopHeaders("   ", false), /empty/)
  assert.throws(
    () =>
      outboundLoopHeaders(
        "sales@vendingco.example\r\nBcc: victim@evil.example",
        false
      ),
    /header injection/
  )
  assert.throws(
    () => outboundLoopHeaders("not-an-address", false),
    /bare email address/
  )
})

test("outboundLoopHeaders output is exactly what rule 7 detects", () => {
  const headers = outboundLoopHeaders(OUR_MAILBOX, true)
  const echoed = msg(headers as RawHeaders, "Echoed back by their robot.")
  assert.match(detectLoopSignal(echoed) ?? "", /LOOP ALARM/)
})
