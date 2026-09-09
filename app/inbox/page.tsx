import { getInboxThreads } from "./data"
import { InboxView } from "./inbox-view"

// Reads the local SQLite DB directly on every request — see app/settings/page.tsx.
export const dynamic = "force-dynamic"

export default function InboxPage() {
  const threads = getInboxThreads()

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-lg font-medium">Inbox</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Only people who need a human. Everything the bot could dispose of on its own never shows
        up here.
      </p>
      <div className="mt-6">
        <InboxView threads={threads} />
      </div>
    </div>
  )
}
