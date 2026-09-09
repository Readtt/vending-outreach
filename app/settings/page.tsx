import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AI_ROLES, getRoleModel, type AiRole, type RoleModelSetting } from "@/lib/ai"
import { AboutSection } from "./about-section"
import {
  getAboutSettings,
  getMailboxesForClient,
  getProvidersForClient,
  getSendingSettings,
  getTargetingSettings,
} from "./data"
import { MailboxesSection } from "./mailboxes-section"
import { ProvidersSection } from "./providers-section"
import { SendingSection } from "./sending-section"
import { TargetingSection } from "./targeting-section"

// This page reads the local SQLite DB directly (not through `fetch`), so
// Next has no signal that it's dynamic and would otherwise prerender it
// once at build time and serve that stale snapshot until revalidated.
// Settings must always reflect the current DB state on every request.
export const dynamic = "force-dynamic"

export default function SettingsPage() {
  const providers = getProvidersForClient()
  const mailboxes = getMailboxesForClient()
  const sending = getSendingSettings()
  const targeting = getTargetingSettings()
  const about = getAboutSettings()

  const roleModels = AI_ROLES.reduce(
    (acc, role) => {
      acc[role] = getRoleModel(role) ?? null
      return acc
    },
    {} as Record<AiRole, RoleModelSetting | null>
  )

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-lg font-medium">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Everything here is local — nothing is sent anywhere until you turn
        sending on.
      </p>

      <Tabs defaultValue="providers" className="mt-6">
        <TabsList>
          <TabsTrigger value="providers">AI Providers</TabsTrigger>
          <TabsTrigger value="mailboxes">Mailboxes</TabsTrigger>
          <TabsTrigger value="sending">Sending</TabsTrigger>
          <TabsTrigger value="targeting">Targeting</TabsTrigger>
          <TabsTrigger value="about">About you</TabsTrigger>
        </TabsList>

        <TabsContent value="providers" className="mt-4">
          <ProvidersSection providers={providers} roleModels={roleModels} />
        </TabsContent>
        <TabsContent value="mailboxes" className="mt-4">
          <MailboxesSection mailboxes={mailboxes} />
        </TabsContent>
        <TabsContent value="sending" className="mt-4">
          <SendingSection settings={sending} />
        </TabsContent>
        <TabsContent value="targeting" className="mt-4">
          <TargetingSection settings={targeting} />
        </TabsContent>
        <TabsContent value="about" className="mt-4">
          <AboutSection settings={about} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
