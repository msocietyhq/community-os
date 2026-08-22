import { escapeHtml } from "./telegram-html";

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
