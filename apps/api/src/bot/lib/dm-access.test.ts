import { describe, expect, test } from "bun:test";
import { BOT_SETTINGS } from "@community-os/shared/bot-settings";
import { decideDmAccess } from "./dm-access";

describe("dm.access default", () => {
  // Security-relevant: at "everyone" any stranger reaches the whole command
  // set. Pinned so it can't drift back without a deliberate edit here.
  test("defaults to members only", () => {
    expect(BOT_SETTINGS["dm.access"].default).toBe("members");
  });

  test("a stranger is blocked under the default", () => {
    expect(
      decideDmAccess({
        level: BOT_SETTINGS["dm.access"].default,
        role: null,
        banned: false,
      }).allowed,
    ).toBe(false);
  });
});

describe("decideDmAccess", () => {
  test("everyone lets a stranger through", () => {
    expect(
      decideDmAccess({ level: "everyone", role: null, banned: false }).allowed,
    ).toBe(true);
  });

  test("members blocks a stranger with no record", () => {
    const result = decideDmAccess({
      level: "members",
      role: null,
      banned: false,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("not_a_member");
  });

  test("members allows a member", () => {
    expect(
      decideDmAccess({ level: "members", role: "member", banned: false })
        .allowed,
    ).toBe(true);
  });

  test("members blocks a banned member", () => {
    expect(
      decideDmAccess({ level: "members", role: "member", banned: true })
        .allowed,
    ).toBe(false);
  });

  test("admins blocks an ordinary member", () => {
    const result = decideDmAccess({
      level: "admins",
      role: "member",
      banned: false,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("members_blocked");
  });

  test("admins lets an admin through", () => {
    expect(
      decideDmAccess({ level: "admins", role: "admin", banned: false }).allowed,
    ).toBe(true);
  });

  test("admins lets a superadmin through", () => {
    expect(
      decideDmAccess({ level: "admins", role: "superadmin", banned: false })
        .allowed,
    ).toBe(true);
  });

  // The escape hatch. An admin is banned automatically when they leave the
  // group; if that also locked them out of DMs, setting level=admins and then
  // leaving would lock the last admin out of the menu that unlocks it.
  test("a banned admin still gets through at every level", () => {
    for (const level of ["everyone", "members", "admins"] as const) {
      expect(
        decideDmAccess({ level, role: "admin", banned: true }).allowed,
        `level ${level}`,
      ).toBe(true);
    }
  });
});
