# Vending Outreach

Finds local businesses that could take a vending machine, writes each one a
real email about their own business, sends it from your Gmail at a safe pace,
handles the boring replies for you, and passes you the people worth talking to.

Everything runs on your own computer. There is no account to make, no server to
rent, and nothing to pay for except whatever AI service you point it at.

## What you need first

1. **Node 24 or newer** and **pnpm**. Check with `node -v`.
2. **An AI key.** OpenRouter is the easiest to start with. Anthropic, Google,
   and anything OpenAI-compatible all work, including Ollama running on this
   same computer.
3. **A Gmail account you would not mind losing.** Cold email from a free Gmail
   gets complaints, and Google's answer to enough complaints is to close the
   account. Do not use the address your bank recovery goes to.

## Start it

```bash
pnpm install
pnpm dev
```

That starts two things: the website at <http://localhost:3000> and the engine
that does the actual work. Both need to be running. Close the terminal and
everything pauses safely, then picks up where it left off next time.

The Dashboard and Settings both show whether the engine is running, so you are
never guessing.

**Nothing is emailed to anyone until you switch sending on.** Until then, every
email is saved as a file in `outbox-dryrun/` that you can open and read. That is
how it starts, on purpose.

## Set it up, in this order

**1. Settings, "AI models" tab.** Add your key. The three jobs (writing emails,
reading replies, reading websites) fill themselves in with a sensible model as
soon as the key works. Change any of them if you want something cheaper or
better.

**2. Settings, "Email" tab.** Add your Gmail address and an
[app password](https://myaccount.google.com/apppasswords). That is a
16-character code Google makes just for this, not your normal password. You need
2-Step Verification switched on first.

Then press **Test**. It checks sending and receiving separately, because an
account can send fine while receiving is switched off, and in that state every
reply disappears without a trace.

**3. Settings, "About you" tab.** Fill it all in, especially the address. US law
requires a real postal address on every sales email, so nothing gets written at
all until that box has something in it. A PO box is fine.

**4. Leads, "Find businesses".** Type a town or ZIP code, pick how far to look
and what kinds of business you want. It searches OpenStreetMap, which is free
and needs no key. Add the ones you like.

**5. Wait a few minutes.** The engine checks for work every 60 seconds. It reads
each business's website, writes them an email, and lines it up. Watch the
Dashboard. "Ready to send" going up means it is working.

**6. Read what it wrote.** Open a few files in `outbox-dryrun/`. Every email
should obviously be about _that business_. If they read like a form letter, fix
the wording in `lib/prompts.ts` before a single real one goes out.

**7. Approve the first batch.** The first 20 emails are held back on purpose and
the Leads page shows a bar about it. Read a few before you approve. This is the
cheapest possible moment to catch a bad email, while 20 people have it instead
of 500.

**8. Now switch sending on,** from the Dashboard.

## Two things worth doing before real emails go out

Buy a cheap domain and put Google Workspace on it, about $10 a year plus the
subscription. A free Gmail address is the one most likely to get shut down, and
if that happens you lose Drive, Photos, and anything using that address to reset
a password. This app talks plain email protocols, so moving later is just a
settings change.

Send one email through [mail-tester.com](https://www.mail-tester.com/). Paste in
a file from `outbox-dryrun/` and adjust the wording until it scores clean.

Leave it at 5 emails a day for the first week. It speeds up on its own.

## What it does without asking, and what it brings you

Someone says no, or says they already have a machine? It stops emailing them for
good and says nothing back. A polite "no problem!" is just one more unwanted
email to somebody who asked you to go away. An out-of-office reply moves the
follow-up later instead of arguing with a robot.

Anything real comes to you. Interested, asking about money, wanting to talk, or
anything the sorting is unsure about lands in **Inbox** and waits. No
AI-written text is ever sent to a stranger on its own. The only automatic reply
is a fixed message you can read in `lib/prompts.ts`.

**Calls** lists everyone you emailed a day or two ago who has not replied and
has a phone number, with a script you can ask it to write. People who do this
for a living say the phone call is what actually closes the deal, so it is not a
side feature.

## When something looks wrong

| What you see                               | What it means                                                                                                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nothing happens after adding businesses    | The engine is not running. `pnpm dev` starts both parts. `pnpm dev:web` starts only the website.                                                                 |
| "Engine stopped" on the Dashboard          | Same thing. Run `pnpm dev`.                                                                                                                                      |
| "N jobs gave up after repeated tries"      | Something failed five times. Recent activity at the bottom of the Dashboard has the reason.                                                                      |
| An orange bar about a safety limit         | Sending stopped itself. Read why before you switch it back on. It is a guard, not a bug.                                                                         |
| Everything stopped and nothing explains it | There is a file called `STOP` in the project folder. Delete it.                                                                                                  |
| No emails going out                        | Sending is off (that is the default), the first 20 still need approving on the Leads page, it is outside 9am to 4pm on a weekday, or you have hit today's limit. |
| "Sent today 5 / 5" and it stopped          | The slow start. New accounts begin at 5 a day and climb on days you actually send. The tile says what it is climbing toward.                                     |

Your data lives in `data/app.db`, inside this folder. Everything the app writes
stays here — the database, the dry-run outbox, the STOP file — so the whole
installation is one folder you can copy, back up, or delete.

One caveat if this folder is inside OneDrive, Dropbox, or Google Drive: a
database is three files that have to stay in step, and a sync client copies them
one at a time. It prints a warning on startup if it spots that. Either exclude
`data/` in the sync client's settings, or point `VENDING_DB_PATH` at somewhere
unsynced.

## Commands

```bash
pnpm dev         # website and engine, which is what you want
pnpm dev:web     # website only
pnpm worker      # engine only
pnpm test        # 314 tests
pnpm typecheck
pnpm build
```
