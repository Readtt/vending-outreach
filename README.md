# Vending Outreach

Finds local businesses that could take a vending machine, writes each one a
real email about their own business, sends it from your Gmail at a safe pace,
handles the boring replies for you, and passes you the people worth talking to.

Works in the United States and Canada. The two are not the same job — Canada's
rules want consent, a second contact detail on every email, and its own list of
public holidays — so the app tracks which country each business is in and
changes what it does accordingly.

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

**3. Settings, "About you" tab.** Fill it all in, especially the address. Both
countries require a real postal address on every sales email, so nothing gets
written at all until that box has something in it. A PO box is fine. Add your
phone or your website too if you are emailing Canada, which asks for one of
them next to the address.

**4. Settings, "Who to find" tab.** Pick your countries, your usual town, and
the kinds of business you want. This is where searches start from.

**5. Leads, "Find businesses".** It opens on what you saved in step 4; change
anything you like for this one search. Type a town ("Columbus, OH", "London,
ON"), a ZIP code, or a Canadian postal code — `M1E 4C2`, `m1e4c2` and the bare
`M1E` all work, and so does a whole address with the code in it. It searches
OpenStreetMap, which is free and needs no key. Add the ones you like.

Canadian postal codes are the one thing OpenStreetMap cannot answer: Canada
Post claims copyright over the list, so Nominatim returns nothing for every
form of them. They are resolved from `lib/ca-fsa-data.ts` instead, a table of
all 1,652 forward sortation areas that ships with the app — no network, no key,
nothing to be down. It is built from [GeoNames](https://www.geonames.org/)
(CC BY 4.0) by `pnpm build:ca-fsa`, which needs running only when GeoNames
revises the data. A postal code places you within a neighbourhood, which is as
precise as the centre of a search measured in miles needs to be.

**6. Wait a few minutes.** The engine checks for work every 60 seconds. It reads
each business's website, writes them an email, and lines it up. Watch the
Dashboard. "Ready to send" going up means it is working.

**7. Read what it wrote.** Open a few files in `outbox-dryrun/`. Every email
should obviously be about _that business_. If they read like a form letter, fix
the wording in `lib/prompts.ts` before a single real one goes out.

**8. Approve the first batch.** The first 20 emails are held back on purpose and
the Leads page shows a bar about it. Read a few before you approve. This is the
cheapest possible moment to catch a bad email, while 20 people have it instead
of 500.

**9. Now switch sending on,** from the Dashboard.

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
has a phone number, with a script you can ask it to write. Each email in the
sequence opens its own window, so a business you never got round to phoning
comes back after the next follow-up. People who do this for a living say the
phone call is what actually closes the deal, so it is not a side feature.

## Emailing Canada

Tick Canada under Settings, "Who to find". Four things change, and you do not
have to do anything about any of them:

- **The address has to come from the business's own website.** Canada's CASL
  allows cold email to an address a business published itself and did not
  attach a "no unsolicited mail" notice to. An entry someone typed into
  OpenStreetMap is not that, so for a Canadian business that entry is ignored
  and the lead is skipped if nothing else turns up.
- **The email carries a second way to reach you** — your phone number or your
  website — next to your postal address. Nothing is written for a Canadian
  business until one of them is filled in, and Settings says so up front.
- **Holidays follow the right calendar.** Nothing goes out on Canada Day or
  Victoria Day; the Fourth of July is a working day.
- **Emails arrive in the recipient's morning.** A business in Vancouver is
  written to at 9am Pacific whether you are in Toronto or in Texas.

Searches stay inside whichever countries you tick. A handful of border towns
are unreachable as a result — Windsor, Sarnia, Niagara Falls, Sault Ste. Marie,
Fort Frances and Edmundston all sit across a river from an American city at the
same latitude, and the app would rather miss them than email one country's
businesses under the other country's rules. `lib/geo.ts` lists them.

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
| Canadian businesses keep getting skipped   | Either they publish no address on their own site, or your phone and website are both blank under Settings, "About you". Canada needs one of them.                |

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
pnpm seed:demo   # fill an empty database with demo data, to look around first
pnpm test        # 347 tests
pnpm typecheck
pnpm build
```
