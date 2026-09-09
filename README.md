# Vending Outreach

Finds businesses that could take a vending machine, writes each one a genuinely
personalized cold email, sends it from your Gmail at a safe pace, handles the
routine replies itself, and hands you only the people worth talking to.

Runs entirely on your machine. No hosting, no accounts, no monthly cost beyond
whatever AI provider you point it at.

---

## Start it

```bash
pnpm install
pnpm dev
```

That runs two processes: the web UI on <http://localhost:3000> and the engine
that does the actual work. **Both must be running.** The engine only works while
this is open — closing the terminal pauses everything safely and it picks up
where it left off.

**Nothing is sent until you explicitly turn sending on.** Until then every email
is written to `outbox-dryrun/` as a `.eml` file you can open and read. This is
the default and it is deliberate.

---

## First run, in order

1. **Settings → AI Providers.** Add a key (OpenRouter, Anthropic, Google, or any
   OpenAI-compatible endpoint including a local Ollama). The three model
   dropdowns — Writer, Triage, Research — fill themselves from the provider once
   the key is in.

2. **Settings → Mailboxes.** Add your Gmail and a
   [Google app password](https://myaccount.google.com/apppasswords) (16
   characters, not your account password — you need 2-Step Verification on
   first). Then press **Test connection**. It checks sending and receiving
   separately, because an account can send fine while IMAP is switched off, and
   in that state every reply is silently lost.

3. **Settings → About you.** Fill in all of it, especially the business address.
   That address is a legal requirement on commercial email, and the engine will
   refuse to compose anything until it is there.

4. **Leads → Find locations.** Type a city or ZIP, pick a radius and the business
   types. It queries OpenStreetMap, which is free and needs no key. Import what
   it finds.

5. **Wait a few minutes.** The engine wakes every 60 seconds. It researches each
   business, drafts an email, and queues it. Watch the dashboard — the queue
   count going down is the system working.

6. **Read what it wrote.** Open a few `.eml` files in `outbox-dryrun/`. Every
   email should obviously be about *that specific business*. If they read
   generic, the problem is the prompt in `lib/prompts.ts`, and it is worth
   fixing before a single real email goes out.

7. **Approve the first batch.** The first 20 drafts are held on purpose — the
   Leads page shows a banner. Nothing sends until you release them. Read a few
   first; this is the cheapest moment to catch a bad template, before the rest
   of your list gets the same email.

8. **Only then, turn sending on** from the dashboard.

---

## Before you send for real

Two things worth doing once:

- **Use a throwaway Google account, not your main one.** Cold email from a free
  Gmail draws complaints and bounces, and the escalation path ends at account
  suspension — which would take Drive, Photos, and anything using that address
  for password recovery with it. A ~$10/year domain on Google Workspace removes
  most of this risk; the app talks plain SMTP/IMAP, so switching later is a
  settings change.

- **Test one email's deliverability** at [mail-tester.com](https://www.mail-tester.com/).
  Paste in a draft from `outbox-dryrun/` and tune the copy until it scores clean.

Leave it at 5 emails a day for the first week. The engine ramps up on its own.

---

## What it does on its own, and what it brings to you

It handles routine replies without asking. Someone says no, or says they already
have a machine — it stops emailing them, permanently, and says nothing back. A
courtesy "no problem!" is just one more unsolicited email to someone who asked
you to go away. Out-of-office pushes the follow-up out instead of replying to a
robot.

**Anything real comes to you.** Interested, asking about money, wanting to talk,
or anything the classifier isn't sure about lands in **Inbox** and waits. No
AI-written text is ever sent to a stranger automatically — the only auto-reply is
a fixed template you can read in `lib/prompts.ts`.

**Calls** lists everyone emailed 1–4 days ago who hasn't replied and has a phone
number, with a script. Operators say the follow-up call is what actually closes,
so this is not a side feature.

---

## When something looks wrong

| Symptom | Cause |
|---|---|
| Nothing happens after import | Engine isn't running. `pnpm dev` runs both processes; `pnpm dev:web` runs only the UI. |
| "Tasks gave up" on the dashboard | Something failed 5 times. The activity feed has the error. |
| A red banner about the breaker | A safety limit tripped — bounce rate, or too many messages to one place. Read it before re-arming; it is a deliberate gate, not a glitch. |
| Everything stopped, no explanation | A `STOP` file exists in the project root. Delete it. |
| Emails aren't going out | Sending is off (default), the first 20 drafts still need approving on the Leads page, you're outside the 9–4 weekday window, or the day's cap is reached. |
| "Sent today 5 / 5" and it stopped | The warm-up ramp. It starts at 5/day and climbs on days you actually send, protecting a new account. The tile says what it's climbing toward. |

Your data lives in `%LOCALAPPDATA%\vending-outreach\app.db` — deliberately
outside this folder, because OneDrive corrupts SQLite databases it syncs.

---

## Commands

```bash
pnpm dev         # UI + engine (what you want)
pnpm dev:web     # UI only
pnpm worker      # engine only
pnpm test        # 290 tests
pnpm typecheck
pnpm build
```
