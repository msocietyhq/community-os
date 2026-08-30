import { describe, expect, test } from "bun:test";
import { APICallError } from "ai";
import { classifyProviderError } from "./ai-provider-errors";

function apiError(opts: {
  statusCode: number;
  message: string;
  body?: unknown;
}): APICallError {
  return new APICallError({
    message: opts.message,
    url: "https://example.test/v1/messages",
    requestBodyValues: {},
    statusCode: opts.statusCode,
    responseBody: JSON.stringify(opts.body ?? {}),
  });
}

describe("classifyProviderError", () => {
  test("anthropic: 400 with a low credit balance", () => {
    const error = apiError({
      statusCode: 400,
      message:
        "Your credit balance is too low to access the Anthropic API. " +
        "Please go to Plans & Billing to upgrade or purchase credits.",
      body: { type: "error", error: { type: "invalid_request_error" } },
    });
    expect(classifyProviderError(error)).toBe("out_of_credit");
  });

  test("openai: 429 with insufficient_quota", () => {
    const error = apiError({
      statusCode: 429,
      message: "You exceeded your current quota, please check your plan.",
      body: {
        error: { code: "insufficient_quota", type: "insufficient_quota" },
      },
    });
    expect(classifyProviderError(error)).toBe("out_of_credit");
  });

  test("deepseek: 402 Insufficient Balance", () => {
    const error = apiError({
      statusCode: 402,
      message: "Insufficient Balance",
      body: { error: { message: "Insufficient Balance" } },
    });
    expect(classifyProviderError(error)).toBe("out_of_credit");
  });

  // The single most important negative case: an ordinary throttling 429 shares
  // a status code with OpenAI's quota error. Only the code tells them apart,
  // and treating a rate limit as an empty account would take a healthy
  // provider out of rotation for up to 24 hours.
  test("an ordinary rate-limit 429 is not credit exhaustion", () => {
    const error = apiError({
      statusCode: 429,
      message: "Rate limit reached for requests",
      body: { error: { code: "rate_limit_exceeded", type: "requests" } },
    });
    expect(classifyProviderError(error)).toBe("other");
  });

  test("a 500 is not credit exhaustion", () => {
    expect(
      classifyProviderError(
        apiError({ statusCode: 500, message: "Internal server error" }),
      ),
    ).toBe("other");
  });

  test("a 401 bad key is not credit exhaustion", () => {
    expect(
      classifyProviderError(
        apiError({ statusCode: 401, message: "invalid x-api-key" }),
      ),
    ).toBe("other");
  });

  test("non-API errors are other", () => {
    expect(classifyProviderError(new Error("boom"))).toBe("other");
    expect(classifyProviderError(undefined)).toBe("other");
    expect(classifyProviderError("Insufficient Balance")).toBe("other");
  });
});
