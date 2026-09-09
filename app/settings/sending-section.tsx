import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { saveSendingSettingsAction } from "./actions"
import { LabeledRangeSlider } from "./labeled-range-slider"
import { EMAILS_PER_DAY_WARN_ABOVE, type SendingSettings } from "./data"

export function SendingSection({ settings }: { settings: SendingSettings }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sending</CardTitle>
        <CardDescription>
          How fast, how often, and when this app is allowed to send. The
          scheduler still enforces pacing at send time — this just sets the
          targets.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={saveSendingSettingsAction}
          className="flex flex-col gap-6"
        >
          <LabeledRangeSlider
            name="emailsPerDay"
            label="Emails per day"
            defaultValue={[settings.emailsPerDay]}
            min={1}
            max={100}
            warnAbove={EMAILS_PER_DAY_WARN_ABOVE}
            warnText={`Above ${EMAILS_PER_DAY_WARN_ABOVE}/day starts to look automated to spam filters.`}
          />
          <LabeledRangeSlider
            name="sendGapMinutes"
            label="Gap between sends"
            defaultValue={[
              settings.sendGapMinMinutes,
              settings.sendGapMaxMinutes,
            ]}
            min={1}
            max={60}
            unit="minutes"
          />
          <LabeledRangeSlider
            name="sendWindowHours"
            label="Sending window"
            defaultValue={[settings.windowStartHour, settings.windowEndHour]}
            min={0}
            max={24}
            unit="hour"
          />
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="weekdaysOnly">Weekdays only</Label>
              <p className="text-xs text-muted-foreground">
                Never send Saturday or Sunday, recipient-local time.
              </p>
            </div>
            <Switch
              id="weekdaysOnly"
              name="weekdaysOnly"
              defaultChecked={settings.weekdaysOnly}
            />
          </div>
          <div>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
