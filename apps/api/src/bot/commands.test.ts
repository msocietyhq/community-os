import { describe, expect, test } from "bun:test";
import {
  BOT_COMMANDS,
  commandsFor,
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

describe("chat-type filtering", () => {
  const dmOnly = BOT_COMMANDS.filter((c) => c.dmOnly).map((c) => c.command);

  // These four reply "use this in a private chat" and stop, so a group must
  // not be offered them — in the menu or in /help.
  test("the DM-only set is the handlers that refuse groups", () => {
    expect([...dmOnly].sort()).toEqual([
      "create_project",
      "login",
      "profile",
      "settings",
    ]);
  });

  test("a group gets everything except the DM-only commands", () => {
    const inGroup = commandsFor(false).map((c) => c.command);
    expect(inGroup).toHaveLength(BOT_COMMANDS.length - dmOnly.length);
    for (const command of dmOnly) {
      expect(inGroup, command).not.toContain(command);
    }
  });

  test("a DM gets the whole list", () => {
    expect(commandsFor(true)).toEqual(BOT_COMMANDS);
  });

  test("/help and the menu agree in each chat type", () => {
    for (const inPrivate of [true, false]) {
      const listed = commandsFor(inPrivate).map((c) => c.command);
      const menu = telegramCommands(inPrivate).map((c) => c.command);
      expect(menu, `menu ${inPrivate}`).toEqual(listed);
      for (const command of listed) {
        expect(helpLines(inPrivate), `${command} ${inPrivate}`).toContain(
          `/${command} —`,
        );
      }
      for (const command of dmOnly.filter(() => !inPrivate)) {
        expect(helpLines(false), command).not.toContain(`/${command} —`);
      }
    }
  });
});

describe("renderers", () => {
  test("telegramCommands strips icons and keeps order", () => {
    const sent = telegramCommands(true);
    expect(sent).toHaveLength(BOT_COMMANDS.length);
    expect(sent[0]).toEqual({
      command: BOT_COMMANDS[0]!.command,
      description: BOT_COMMANDS[0]!.description,
    });
    expect(JSON.stringify(sent)).not.toContain("icon");
  });

  test("both listings cover every command", () => {
    const help = helpLines(true);
    const start = startLines(true);
    for (const { command } of BOT_COMMANDS) {
      expect(help, `${command} in /help`).toContain(`/${command} —`);
      expect(start, `${command} in /start`).toContain(`/${command} —`);
    }
  });
});
