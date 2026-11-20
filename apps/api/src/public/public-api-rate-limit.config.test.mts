import assert from "node:assert/strict";
import test from "node:test";
import { parsePublicApiRateLimitOptions } from "./public-api-rate-limit.config.js";

test("rate-limit configuration uses bounded local defaults", () => {
  assert.deepEqual(parsePublicApiRateLimitOptions({}), {
    limit: 120,
    windowSeconds: 60,
    trustedProxyIps: [],
  });
});

test("rate-limit configuration rejects out-of-range limits, windows, and proxy entries", () => {
  assert.throws(
    () => parsePublicApiRateLimitOptions({ PUBLIC_API_RATE_LIMIT: "0" }),
    /PUBLIC_API_RATE_LIMIT/,
  );
  assert.throws(
    () =>
      parsePublicApiRateLimitOptions({
        PUBLIC_API_RATE_WINDOW_SECONDS: "3601",
      }),
    /PUBLIC_API_RATE_WINDOW_SECONDS/,
  );
  assert.throws(
    () => parsePublicApiRateLimitOptions({ TRUSTED_PROXY_IPS: "10.0.0.0/8" }),
    /TRUSTED_PROXY_IPS/,
  );
});
