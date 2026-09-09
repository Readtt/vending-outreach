import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { saveSendingSettingsAction } from "./actions"
import { LabeledRangeSlider } from "./labeled-range-slider"
import { SettingsForm } from "./settings-form"
import { EMAILS_PER_DAY_WARN_ABOVE, type SendingSettings } from "./data"

export function SendingSection({ settings }: { settings: SendingSettings }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sending</CardTitle>
        <CardDescription>
          How many emails a day, how far apart, and at what times. New accounts
          start at 5 a day and work up to your number over a couple of weeks.
          That slow start is what keeps Gmail from shutting you down.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SettingsForm
          action={saveSendingSettingsAction}
          fieldsKey={JSON.stringify(settings)}
        >
          <LabeledRangeSlider
            name="emailsPerDay"
            label="Emails a day"
            defaultValue={[settings.emailsPerDay]}
            min={1}
            max={100}
            warnAbove={EMAILS_PER_DAY_WARN_ABOVE}
            warnText={`More than ${EMAILS_PER_DAY_WARN_ABOVE} a day starts to look like a robot to spam filters.`}
          />
          <LabeledRangeSlider
            name="sendGapMinutes"
            label="Gap between emails"
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
            label="Only send between"
            defaultValue={[settings.windowStartHour, settings.windowEndHour]}
            min={0}
            max={24}
            unit="hour"
          />
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="weekdaysOnly">Weekdays only</Label>
              <p className="text-xs text-muted-foreground">
                Never send on a Saturday or Sunday, going by the time where they
                are.
              </p>
            </div>
            <Switch
              id="weekdaysOnly"
              name="weekdaysOnly"
              defaultChecked={settings.weekdaysOnly}
            />
          </div>
        </SettingsForm>
      </CardContent>
    </Card>
  )
}
