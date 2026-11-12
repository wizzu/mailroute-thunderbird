// Hostile-input checks: crafted headers must not hang or break the parser.
const MR = require("../src/parse.js");
const assert = require("assert");

const msg = (hdrs) => hdrs.join("\r\n") + "\r\n\r\nbody";

function fast(label, f, limitMs = 1000) {
  const t0 = Date.now();
  const result = f();
  const ms = Date.now() - t0;
  assert.ok(ms < limitMs, `${label} took ${ms} ms`);
  return result;
}

// Deeply nested comments used to take quadratic time.
const n = 50000;
fast("nested comments", () =>
  MR.buildTimeline(MR.parseHeaders(msg(["Received: from a by b " + "(".repeat(n) + "x" + ")".repeat(n) + "; Wed, 11 Nov 2026 10:00:00 +0000"])))
);

// Header flooding: capped, newest headers kept, and the omission reported.
const many = [];
for (let i = 0; i < 20000; i++) {
  many.push("Received: from a by b" + i + "; Wed, 11 Nov 2026 10:00:00 +0000", "DKIM-Signature: d=x; t=" + (1794400000 + i));
}
const flooded = fast("20k Received + 20k DKIM", () => MR.buildTimeline(MR.parseHeaders(msg(many))));
assert.strictEqual(flooded.summary.hopCount, 200);
assert.strictEqual(flooded.summary.omitted, 19800);
assert.strictEqual(flooded.rows.filter((r) => r.kind === "hop").pop().by, "b0", "topmost header kept");

// Out-of-range timestamps are treated as unreadable rather than crashing rendering.
const odd = MR.buildTimeline(MR.parseHeaders(msg([
  "Received: from a by b; Wed, 11 Nov 275000 10:00:00 +0000",
  "DKIM-Signature: d=x; t=100000000000000000000",
])));
assert.strictEqual(odd.rows.filter((r) => r.time).length, 0);
assert.strictEqual(odd.summary.untimedCount, 1);

// A huge header value is clipped, keeping its date at the end.
const huge = fast("5 MB header", () =>
  MR.buildTimeline(MR.parseHeaders(msg(["Received: from a by b " + "x ".repeat(2.5e6) + "; Wed, 11 Nov 2026 10:00:00 +0000"])))
);
assert.ok(huge.rows[0].raw.length < 10000);
assert.ok(huge.rows[0].time, "date survives clipping");

// Tag names that would touch the object prototype are harmless.
const proto = MR.parseTags("__proto__=x; constructor=y; t=1");
assert.strictEqual(Object.getPrototypeOf(proto), null);

console.log("robustness tests passed");
