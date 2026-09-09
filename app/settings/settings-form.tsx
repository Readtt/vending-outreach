"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Tick02Icon, Loading03Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { IDLE_SAVE, type SaveState } from "./types"

/** How long the button stays on "Saved" before going back to "Save". */
const SAVED_MS = 2500

interface SettingsFormProps {
  /**
   * The server action for this form. Takes the previous `SaveState` and the
   * form data, and returns the next one — the `useActionState` shape, which
   * is what lets a validation failure be rendered instead of thrown.
   */
  action: (prev: SaveState, formData: FormData) => Promise<SaveState>
  /** The fields. Rendered on the server; this component only wraps them. */
  children: React.ReactNode
  /**
   * Changes whenever the saved values change. Used as a `key` on the field
   * container — see the note on remounting below.
   */
  fieldsKey: string
}

/**
 * The shared frame around every form on the Settings page: submits it, says
 * that it is saving, and says that it saved.
 *
 * ### Why this exists
 *
 * Each section used to be a bare `<form action={serverAction}>` with a plain
 * submit button. Clicking Save did the right thing and showed nothing at all
 * — no pending state, no confirmation — for the length of a database write, a
 * revalidate, and a server re-render. The honest reading of that screen was
 * "the button is broken", and the usual response was to click it again.
 *
 * ### Why the fields are remounted after a save
 *
 * Every save action calls `revalidatePath("/settings")`, so the server
 * re-renders and hands the *same* mounted inputs a new `defaultValue`. Base
 * UI rightly warns about that ("changing the default value state of an
 * uncontrolled FieldControl after being initialized") and React ignores the
 * new default, so a value the server adjusted on the way in — a clamped
 * radius, a trimmed address — stayed wrong on screen until a manual reload.
 * Keying the container on the saved values turns that into a remount, which
 * is a legitimate way to change a default and makes the form show what was
 * actually stored. It only fires when the stored values change, so it cannot
 * interrupt typing.
 */
export function SettingsForm({ action, children, fieldsKey }: SettingsFormProps) {
  const [state, formAction, pending] = useActionState(action, IDLE_SAVE)

  // Which save the confirmation has already been retired for. Held as the
  // timestamp of that save rather than a boolean so the only state change is
  // the one the timer makes — deriving `showSaved` from it means nothing has
  // to be set synchronously when a save lands, which is both what the
  // `set-state-in-effect` rule asks for and one less render.
  const [retiredAt, setRetiredAt] = useState(0)
  const savedAt = state.status === "saved" ? state.at : 0
  const showSaved = savedAt !== 0 && savedAt !== retiredAt && !pending

  // A toast per result. `at` makes the token unique per submission, so saving
  // twice in a row — or hitting the same validation error twice — says so
  // twice instead of looking like nothing happened the second time.
  const lastToasted = useRef<number>(0)
  useEffect(() => {
    if (state.status === "idle" || state.at === lastToasted.current) return
    lastToasted.current = state.at
    if (state.status === "error") toast.error(state.message)
    else toast.success("Saved.")
  }, [state])

  useEffect(() => {
    if (savedAt === 0) return
    const timer = setTimeout(() => setRetiredAt(savedAt), SAVED_MS)
    return () => clearTimeout(timer)
  }, [savedAt])

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {/* Remounted when the stored values change. See the note above. */}
      <div key={fieldsKey} className="flex flex-col gap-6">
        {children}
      </div>

      {state.status === "error" && (
        <p
          // Announced, because for a keyboard user the failure is otherwise
          // only a colour change somewhere below the button they just used.
          role="alert"
          className="text-sm text-destructive"
        >
          {state.message}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? (
            <>
              <HugeiconsIcon
                icon={Loading03Icon}
                strokeWidth={2}
                className="animate-spin"
              />
              Saving…
            </>
          ) : showSaved ? (
            <>
              <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
              Saved
            </>
          ) : (
            "Save"
          )}
        </Button>

        {/* A second, quieter confirmation that outlives the button's own, for
            anyone whose eyes were on the field they just changed rather than
            on the button they clicked. */}
        <span
          aria-live="polite"
          className="text-sm text-muted-foreground transition-opacity duration-200"
          style={{ opacity: showSaved ? 1 : 0 }}
        >
          Your changes are saved.
        </span>
      </div>
    </form>
  )
}
