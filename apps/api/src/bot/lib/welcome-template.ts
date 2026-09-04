import { escapeHtml } from "./telegram-html";

/**
 * Which signal brought us here, and therefore what we can honestly claim about
 * the person. A `chat_member` update means Telegram watched them arrive. A
 * first message means only that we had never heard of them — they may well
 * have been in the group for years, because membership leaves no trace in our
 * data and only messages do.
 */
export type WelcomeVariant = "join" | "first_message";

export interface WelcomeChoiceInput {
  variant: WelcomeVariant;
  /** `welcome.enabled` — the master switch over all greetings. */
  enabled: boolean;
  /** `welcome.firstMessageEnabled` — silences the first-message copy alone. */
  firstMessageEnabled: boolean;
  newMemberText: string;
  firstMessageText: string;
}

/**
 * Picks the template for a greeting, or `null` to stay quiet.
 *
 * Split out from the middleware — like the dm-access / group-access pair —
 * so the branch that decides what we assert about a member is testable
 * without a database, an env or a grammY runtime.
 */
export function chooseWelcomeTemplate(
  input: WelcomeChoiceInput,
): string | null {
  if (!input.enabled) return null;

  if (input.variant === "join") return input.newMemberText;

  return input.firstMessageEnabled ? input.firstMessageText : null;
}

export interface WelcomeVars {
  telegramId: number;
  firstName: string;
  username?: string;
}

/**
 * Renders an admin-authored welcome template.
 *
 * The admin's own markup is stored and emitted verbatim — it is validated by
 * the preview-send in the edit flow, so a broken tag never reaches a real
 * joiner. Only the interpolated values are escaped, because those are
 * attacker-controlled: a member can name themselves anything they like.
 */
export function renderWelcome(template: string, vars: WelcomeVars): string {
  const safeName = escapeHtml(vars.firstName);

  const values: Record<string, string> = {
    name: `<a href="tg://user?id=${vars.telegramId}">${safeName}</a>`,
    first_name: safeName,
    username: vars.username ? `@${escapeHtml(vars.username)}` : safeName,
  };

  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? (values[key] as string) : whole,
  );
}
