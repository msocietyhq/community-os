import { describe, expect, test } from "bun:test";
import { renderWelcome } from "./welcome-template";

const vars = { telegramId: 123, firstName: "Aziz", username: "aziz" };

describe("renderWelcome", () => {
  test("{name} becomes a tappable mention", () => {
    expect(renderWelcome("Hi {name}!", vars)).toBe(
      'Hi <a href="tg://user?id=123">Aziz</a>!',
    );
  });

  test("{first_name} is the bare name", () => {
    expect(renderWelcome("Hi {first_name}!", vars)).toBe("Hi Aziz!");
  });

  test("{username} is @-prefixed", () => {
    expect(renderWelcome("Hi {username}!", vars)).toBe("Hi @aziz!");
  });

  test("{username} falls back to the first name when absent", () => {
    expect(
      renderWelcome("Hi {username}!", { telegramId: 123, firstName: "Aziz" }),
    ).toBe("Hi Aziz!");
  });

  // The admin's own markup is theirs and is validated by preview-send. Only
  // the interpolated values are escaped.
  test("the admin's markup is preserved", () => {
    expect(renderWelcome("<b>Hi</b> {first_name}", vars)).toBe(
      "<b>Hi</b> Aziz",
    );
  });

  test("a member's name cannot inject markup", () => {
    const hostile = { telegramId: 7, firstName: "<script>alert(1)</script>" };
    expect(renderWelcome("Hi {first_name}", hostile)).toBe(
      "Hi &lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  test("a hostile name is escaped inside the mention too", () => {
    const hostile = { telegramId: 7, firstName: "a<b>b" };
    expect(renderWelcome("{name}", hostile)).toBe(
      '<a href="tg://user?id=7">a&lt;b&gt;b</a>',
    );
  });

  test("an ampersand in a name is escaped", () => {
    expect(
      renderWelcome("{first_name}", { telegramId: 7, firstName: "A & B" }),
    ).toBe("A &amp; B");
  });

  // A typo should look wrong, not break the greeting.
  test("an unknown placeholder is left literal", () => {
    expect(renderWelcome("Hi {nope}!", vars)).toBe("Hi {nope}!");
  });

  test("a placeholder appearing twice is substituted twice", () => {
    expect(renderWelcome("{first_name} {first_name}", vars)).toBe("Aziz Aziz");
  });
});
