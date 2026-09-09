"use server"

/**
 * Server actions backing the Dashboard. Every mutation ends with
 * `revalidatePath("/")` so the next render reflects the write immediately —
 * same pattern as `app/settings/actions.ts`.
 */

import { revalidatePath } from "next/cache"
import {
  clearDryRunMessages,
  rearmCircuitBreaker,
  setSendEnabled,
} from "@/lib/mail-send"

export async function setSendEnabledAction(enabled: boolean): Promise<void> {
  setSendEnabled(enabled)
  revalidatePath("/")
}

/** Returns how many rehearsal messages were deleted, so the caller can toast it. */
export async function clearDryRunMessagesAction(): Promise<number> {
  const count = clearDryRunMessages()
  revalidatePath("/")
  return count
}

export async function rearmCircuitBreakerAction(note: string): Promise<void> {
  rearmCircuitBreaker(note)
  revalidatePath("/")
}
