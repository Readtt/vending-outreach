/**
 * Credential check for a mailbox, run from Settings.
 *
 * This is deliberately NOT `createTransport()` from `lib/mail-send.ts`. That
 * function returns a `FileTransport` whenever sending is disabled, which is the
 * default — so using it here would cheerfully report "connection fine" without
 * ever contacting Gmail. A credential check has to actually authenticate, so it
 * opens its own connections and never sends anything.
 *
 * Both legs are checked because they fail independently and for different
 * reasons: SMTP can authenticate while IMAP is switched off in the Gmail
 * account's settings, and an app password can be revoked for one and not the
 * other. Sending without IMAP appears to work and then silently loses every
 * reply and every bounce, which is worse than failing outright.
 */

import nodemailer from "nodemailer"
import { ImapFlow } from "imapflow"
import { SMTP_HOST, SMTP_PORT } from "./mail-send.ts"
import { IMAP_HOST, IMAP_PORT } from "./mail-receive.ts"

export interface LegResult {
  ok: boolean
  /** Present when `ok` is false. Written for a person, not a log. */
  error?: string
}

export interface MailboxCheckResult {
  smtp: LegResult
  imap: LegResult
  ok: boolean
}

const CONNECT_TIMEOUT_MS = 20_000

/**
 * Turns a mail-server error into something worth reading.
 *
 * Gmail's own wording is unhelpful at exactly the moment the user needs help:
 * `535-5.7.8 Username and Password not accepted` is what you get for using your
 * account password instead of an app password, which is the single most common
 * setup mistake and is not what "username and password not accepted" suggests.
 */
function explain(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err)

  if (/535|5\.7\.8|AUTHENTICATIONFAILED|Invalid credentials/i.test(raw)) {
    return (
      "Sign-in rejected. Gmail needs a 16-character app password here, not your " +
      "normal account password — and app passwords only exist once 2-Step " +
      "Verification is switched on. Check both, then paste the app password " +
      "with no spaces."
    )
  }
  if (
    /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|timeout/i.test(raw)
  ) {
    return `Could not reach the server (${raw.trim()}). Check your internet connection or whether a firewall is blocking the port.`
  }
  if (/certificate|self.signed|SSL|TLS/i.test(raw)) {
    return `TLS handshake failed (${raw.trim()}). This is usually antivirus or a corporate proxy intercepting mail traffic.`
  }
  if (/\[ALERT\]|Application-specific password required/i.test(raw)) {
    return "Gmail is asking for an application-specific password. Turn on 2-Step Verification, generate an app password, and use that."
  }
  return raw.trim() || "Unknown error."
}

async function checkSmtp(
  email: string,
  appPassword: string
): Promise<LegResult> {
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    requireTLS: true,
    auth: { user: email, pass: appPassword },
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
    socketTimeout: CONNECT_TIMEOUT_MS,
  })
  try {
    // verify() runs the handshake and AUTH, then stops. No message is queued,
    // so there is no way for this to accidentally email anyone.
    await transporter.verify()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: explain(err) }
  } finally {
    transporter.close()
  }
}

async function checkImap(
  email: string,
  appPassword: string
): Promise<LegResult> {
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: email, pass: appPassword },
    logger: false,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
    socketTimeout: CONNECT_TIMEOUT_MS,
    clientInfo: { name: "vending-outreach", version: "0.0.1" },
  })
  // An 'error' event with no listener is an unhandled exception that would take
  // down the process rather than failing this one check.
  client.on("error", () => {})
  try {
    await client.connect()
    // Opening INBOX read-only proves the account actually has IMAP enabled,
    // which authentication alone does not.
    const lock = await client.getMailboxLock("INBOX", { readOnly: true })
    lock.release()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: explain(err) }
  } finally {
    try {
      await client.logout()
    } catch {
      // Already closed, or never opened. Nothing to clean up.
    }
  }
}

/**
 * Authenticates against Gmail SMTP and IMAP. Sends nothing, reads nothing.
 *
 * Both legs run concurrently — they are independent, and doing them in series
 * doubles the time the user spends watching a spinner.
 */
export async function verifyMailboxCredentials(
  email: string,
  appPassword: string
): Promise<MailboxCheckResult> {
  const trimmedEmail = email.trim()
  // Gmail app passwords are shown in groups of four; people paste the spaces.
  const trimmedPassword = appPassword.replace(/\s+/g, "")

  if (!trimmedEmail || !trimmedPassword) {
    const error = "Enter both an email address and an app password first."
    return { smtp: { ok: false, error }, imap: { ok: false, error }, ok: false }
  }

  const [smtp, imap] = await Promise.all([
    checkSmtp(trimmedEmail, trimmedPassword),
    checkImap(trimmedEmail, trimmedPassword),
  ])
  return { smtp, imap, ok: smtp.ok && imap.ok }
}
