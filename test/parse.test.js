const MR = require("../src/parse.js");
const assert = require("assert");

const msg = [
  "Delivered-To: mikko@example.fi",
  "Received: by 2002:a05:7300:1234 with SMTP id abc;",
  "        Wed, 11 Nov 2026 03:52:40 -0800 (PST)",
  "X-Received: by 2002:a17:906:abcd with SMTP id xyz;",
  "        Wed, 11 Nov 2026 03:52:39 -0800 (PST)",
  "Received: from mx.relay.example (mx.relay.example [192.0.2.7])",
  "        by mx.google.com with ESMTPS id q7si (version=TLS1_3 cipher=TLS_AES_256_GCM_SHA384 bits=256/256)",
  "        for <mikko@example.fi>; Wed, 11 Nov 2026 03:52:38 -0800 (PST)",
  "Received: from out.sender.example (out.sender.example [198.51.100.3])",
  "\tby mx.relay.example (Postfix) with ESMTP id 4Abc",
  "\tfor <mikko@example.fi>; Wed, 11 Nov 2026 08:04:04 +0000 (UTC)",
  "Received: from simscan-thing with something",
  "Received: (qmail 1234 invoked by uid 89); 11 Nov 2026 08:02:51 GMT",
  "Received: from laptop (unknown [203.0.113.9]) by out.sender.example with ESMTPSA id 55",
  "\t; Wed, 11 Nov 2026 10:02:49 +0200",
  "Date: Wed, 11 Nov 2026 10:01:36 +0200",
  "Subject: test",
  "",
  "Received: in the body, must be ignored",
].join("\r\n");

const h = MR.parseHeaders(msg);
assert.strictEqual(h.filter((x) => x.name === "received").length, 6, "body ignored");

const t = MR.buildTimeline(h);
for (const r of t.rows) {
  console.log(
    r.kind.padEnd(9),
    (r.delta == null ? "" : MR.formatDuration(r.delta)).padStart(12),
    (r.elapsed == null ? "" : "T" + MR.formatDuration(r.elapsed)).padStart(14),
    r.kind === "delivered" ? r.raw : (r.by || r.from || r.raw).slice(0, 40)
  );
}
console.log(t.summary.hopCount, MR.formatDuration(t.summary.transit, false), MR.formatDuration(t.summary.maxDelta), t.summary.skewCount, t.summary.untimedCount);

assert.strictEqual(t.rows[0].kind, "origin");
assert.strictEqual(t.rows[1].delta, 73);           // 10:01:36 -> 10:02:49 (+1m 13s)
assert.strictEqual(t.rows[2].delta, 2);            // qmail GMT stamp
assert.strictEqual(t.rows[3].time, null);
assert.strictEqual(t.rows[4].by, "mx.relay.example");
assert.strictEqual(t.rows[4].delta, 73);
assert.strictEqual(MR.formatDuration(t.rows[5].delta), "+3h 48m 34s");
assert.strictEqual(t.rows[7].delta, 1);
assert.strictEqual(t.rows[6].header, "x-received");
assert.strictEqual(t.rows[t.rows.length - 1].kind, "delivered");
assert.ok(t.rows.some((r) => r.kind === "hop" && !r.time), "untimed hop kept");
assert.strictEqual(t.summary.untimedCount, 1);

// X-Received off
assert.ok(!MR.buildTimeline(h, { includeXReceived: false }).rows.some((r) => r.header === "x-received"));

// date edge cases
const p = (s) => MR.parseDate(s);
assert.strictEqual(p("Wed, 11 Nov 26 10:00:00 +0745").ms, Date.UTC(2026, 10, 11, 2, 15, 0));
assert.strictEqual(p("11 Nov 2026 10:00 EST").ms, Date.UTC(2026, 10, 11, 15, 0, 0));
assert.strictEqual(p("11 Nov 2026 10:00:00").zoneKnown, false);
assert.strictEqual(p("Mon, 9 Nov 2026 23:59:59 -0000 (UTC)").ms, Date.UTC(2026, 10, 9, 23, 59, 59));
assert.strictEqual(p("garbage"), null);

assert.strictEqual(MR.formatDuration(0), "+0s");
assert.strictEqual(MR.formatDuration(-4), "\u22124s");
assert.strictEqual(MR.formatDuration(2 * 86400 + 3 * 3600 + 4 * 60 + 5), "+2d 3h 4m");

console.log("\n" + MR.formatTraceLine(t.rows[5].raw));
console.log("\nall tests passed");

// Signature points are placed by time and break up the long gap
{
  const m = [
    "Received: from b by c with ESMTP; Wed, 11 Nov 2026 12:00:10 +0000",
    "ARC-Seal: i=1; a=rsa-sha256; d=b.example; s=x; cv=none; t=" + Date.UTC(2026, 10, 11, 12, 0, 5) / 1000 + "; b=AAAA",
    "Received: from a by b with ESMTP; Wed, 11 Nov 2026 12:00:00 +0000",
    "DKIM-Signature: v=1; a=rsa-sha256; d=sender.example; s=s1;",
    "\tt=" + Date.UTC(2026, 10, 11, 10, 0, 1) / 1000 + "; h=From:To; bh=xx; b=yy",
    "Date: Wed, 11 Nov 2026 10:00:00 +0000",
    "", ""].join("\r\n");
  const t = MR.buildTimeline(MR.parseHeaders(m));
  const kinds = t.rows.map((r) => r.kind + (r.domain ? ":" + r.domain : ""));
  assert.deepStrictEqual(kinds, ["origin", "signature:sender.example", "hop", "signature:b.example", "hop"]);
  assert.strictEqual(t.rows[1].delta, 1);
  assert.strictEqual(MR.formatDuration(t.rows[2].delta), "+1h 59m 59s");
  assert.strictEqual(t.summary.hopCount, 2);
  assert.strictEqual(MR.buildTimeline(MR.parseHeaders(m), { includeSignatures: false }).rows.length, 3);
  console.log("signature placement ok");
}
