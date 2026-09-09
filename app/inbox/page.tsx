import { AutoRefresh } from "@/components/auto-refresh"
import { Page, PageHeader } from "@/components/page"
import { getInboxThreads } from "./data"
import { InboxView } from "./inbox-view"

// Reads the local SQLite DB directly on every request — see app/settings/page.tsx.
export const dynamic = "force-dynamic"

export default function InboxPage() {
  const threads = getInboxThreads()

  return (
    <Page width="wide">
      <AutoRefresh seconds={30} />
      <PageHeader
        title="Inbox"
        description="Replies that need a person. Anything the app could deal with by itself never reaches here."
      />
      <InboxView threads={threads} />
    </Page>
  )
}
