<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Commits

Commit in small, actionable steps, and do it consistently — not one commit at
the end of a session.

**One commit is one idea.** If the subject line needs an "and", it is two
commits. A refactor that enables a fix is its own commit, before the fix.
Generated data lands separately from the code that reads it.

**Every commit stands on its own.** It builds, `pnpm typecheck` passes, and
`pnpm test` passes. Never commit a state that only compiles once the next
commit lands.

**Commit as you go.** When a piece of work is done and green, commit it, then
start the next. Do not let unrelated changes pile up in the working tree —
splitting them apart afterwards is slower and less accurate than never mixing
them.

**The subject line says what changed for the user**, in plain language, under
~72 characters, lowercase after the type prefix, no trailing period:

    fix: a Canadian postal code found nothing, because Nominatim has none
    feat: ask for the second contact detail Canada wants, before it is needed

not `fix: update osm.ts` or `feat: add postal code support`. Types used here:
`feat`, `fix`, `docs`, `refactor`, `test`, `build`, `chore`.

**The body says why**, when the why is not obvious from the diff: what went
wrong, what a user saw, what was ruled out. Skip the body when the subject
already covers it.
