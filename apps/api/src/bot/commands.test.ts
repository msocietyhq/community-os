import { describe, expect, test } from "bun:test";
import {
  BOT_COMMANDS,
  helpLines,
  startLines,
  telegramCommands,
} from "./commands";

describe("BOT_COMMANDS", () => {
  // Telegram rejects the whole setMyCommands call if any entry is malformed,
  // so a bad entry costs you the entire menu, not just its own line.
  test("every command matches Telegram's name rules", () => {
    for (const { command } of BOT_COMMANDS) {
      expect(command, command).toMatch(/^[a-z0-9_]{1,32}$/);
    }
  });

  test("every description is within Telegram's length limits", () => {
    for (const { command, description } of BOT_COMMANDS) {
      expect(description.length, command).toBeGreaterThanOrEqual(1);
      expect(description.length, command).toBeLessThanOrEqual(256);
    }
  });

  test("no duplicate commands", () => {
    const names = BOT_COMMANDS.map((c) => c.command);
    expect(new Set(names).size).toBe(names.length);
  });

  test("every entry has an icon for the /help listing", () => {
    for (const { command, icon } of BOT_COMMANDS) {
      expect(icon.length, command).toBeGreaterThan(0);
    }
  });

  // /start is handled by Telegram itself and would be a dead menu row.
  test("does not advertise /start", () => {
    expect(BOT_COMMANDS.map((c) => c.command)).not.toContain("start");
  });
});

describe("renderers", () => {
  test("telegramCommands strips icons and keeps order", () => {
    const sent = telegramCommands();
    expect(sent).toHaveLength(BOT_COMMANDS.length);
    expect(sent[0]).toEqual({
      command: BOT_COMMANDS[0]!.command,
      description: BOT_COMMANDS[0]!.description,
    });
    expect(JSON.stringify(sent)).not.toContain("icon");
  });

  test("both listings cover every command", () => {
    const help = helpLines();
    const start = startLines();
    for (const { command } of BOT_COMMANDS) {
      expect(help, `${command} in /help`).toContain(`/${command} —`);
      expect(start, `${command} in /start`).toContain(`/${command} —`);
    }
  });
});
