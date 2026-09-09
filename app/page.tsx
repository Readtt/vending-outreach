import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-lg font-medium">Dashboard</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Sending activity and pipeline overview. Not built yet — start in
        Settings: add an AI provider, a mailbox, and your CAN-SPAM address.
      </p>
      <Button render={<Link href="/settings" />} className="mt-4" size="sm">
        Go to Settings
      </Button>
    </div>
  )
}
