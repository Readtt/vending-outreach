import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { saveAboutSettingsAction } from "./actions"
import type { AboutSettings } from "./data"

export function AboutSection({ settings }: { settings: AboutSettings }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>About you</CardTitle>
        <CardDescription>
          Goes on every email this app sends. The physical address is required
          by CAN-SPAM on every commercial email, not just the first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={saveAboutSettingsAction} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={settings.name}
                placeholder="Jordan Rivera"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="company">Company</Label>
              <Input
                id="company"
                name="company"
                defaultValue={settings.company}
                placeholder="Buckeye Vending Co."
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              defaultValue={settings.phone}
              placeholder="(614) 555-0100"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="address">Physical address</Label>
            <Input
              id="address"
              name="address"
              defaultValue={settings.address}
              placeholder="123 Main St, Columbus, OH 43215"
              required
            />
            <p className="text-xs text-muted-foreground">
              Required by CAN-SPAM on every commercial email.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="offerTerms">Offer terms</Label>
            <Textarea
              id="offerTerms"
              name="offerTerms"
              defaultValue={settings.offerTerms}
              placeholder="e.g. a share of revenue paid back to them, no fees, no minimums"
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Feeds directly into the email prompts (lib/prompts.ts).
            </p>
          </div>

          <div>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
