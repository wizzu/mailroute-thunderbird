"use strict";
const MR = globalThis.MailRoute;
const $ = (id) => document.getElementById(id);

// Header text is untrusted. It only ever goes in as textContent (never as HTML),
// and control and bidirectional-override characters are made visible so they
// can't reorder or hide what's displayed.
const UNSAFE_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text).replace(/\t/g, " ").replace(UNSAFE_CHARS, "�");
  return e;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const fmt = MR.formatDuration;

let raw = null;

function speedClass(d) {
  if (d == null) return "first";
  if (d < 0) return "skew";
  if (d < 10) return "fast";
  if (d < 300) return "medium";
  return "slow";
}

// Log scale, so a 2 s hop and a 3 h hop are both visible.
function barWidth(d, max) {
  if (d == null || d <= 0 || max <= 0) return 0;
  return Math.max(3, (100 * Math.log1p(d)) / Math.log1p(max));
}

function status(text) {
  $("status").textContent = text;
}

async function displayedMessage() {
  const [tab] = await messenger.tabs.query({ active: true, currentWindow: true });
  if (messenger.messageDisplay.getDisplayedMessages) {
    const r = await messenger.messageDisplay.getDisplayedMessages(tab.id);
    const list = Array.isArray(r) ? r : r && r.messages;
    if (list && list.length) return list[0];
  }
  return messenger.messageDisplay.getDisplayedMessage(tab.id);
}

async function rawMessage(id) {
  const data = await messenger.messages.getRaw(id);
  return typeof data === "string" ? data : await data.text();
}

function renderSummary(t) {
  const s = t.summary;
  const box = $("summary");
  box.replaceChildren();

  // 1. How long, and how big the route was.
  // The whole journey from the Date: header when there is one,
  // otherwise just the span between the first and last server stamps.
  const total = s.sinceDate != null ? s.sinceDate : s.transit;
  const route = `${plural(s.hopCount, "hop")}` + (s.serverCount ? ` through ${plural(s.serverCount, "server")}` : "");
  if (total != null) {
    const big = el("div", "total");
    const heading = el("span", "total-time");
    heading.append(el("span", "total-word", "Duration "), fmt(total, false));
    big.append(heading);
    big.append(el("span", "total-label", (s.sinceDate != null ? "from sending to final hop" : "from first to last hop") + " · " + route));
    box.append(big);
  } else {
    box.append(el("div", "total", s.hopCount ? `Not enough timestamps to measure transit · ${route}` : "No Received headers in this message"));
  }

  const facts = el("ul", "facts");

  // 2. Where the time went: the slowest handoff, both ends, and its share of the total.
  if (s.slowest) {
    const li = el("li");
    li.append("Slowest step: ", el("strong", speedClass(s.slowest.delta), fmt(s.slowest.delta)), " ");
    li.append(el("span", "ends", `${senderLabel(s.slowest)} → ${hostLabel(s.slowest)}`));
    if (total > 0) {
      const pct = (100 * s.slowest.delta) / total;
      li.append(s.slowest.delta >= total ? " (all of it)" : pct >= 99.5 ? " (over 99% of the total)" : ` (${Math.round(pct)}% of the total)`);
    }
    facts.append(li);
  }

  // 3. Did the wait happen before the first recorded hop? Only worth a line when it did.
  if (s.beforeFirstHop != null && s.beforeFirstHop >= 1 && s.transit != null) {
    facts.append(el("li", null, `${fmt(s.beforeFirstHop, false)} before the first recorded hop, ${fmt(s.transit, false)} between servers`));
  } else if (s.beforeFirstHop != null && s.beforeFirstHop <= -60) {
    facts.append(el("li", "warn", `⚠ The Date: header is ${fmt(-s.beforeFirstHop, false)} later than the first hop (sender's clock is probably off)`));
  }

  // 4. Anything suspicious.
  if (s.skewCount) facts.append(el("li", "warn", `\u26a0 ${s.skewCount} step${s.skewCount > 1 ? "s go" : " goes"} backwards in time (clock skew between servers)`));
  if (s.omitted) facts.append(el("li", "warn", `⚠ ${s.omitted} older trace headers not shown (unusually many; possibly padded by the sender)`));
  if (s.untimedCount) facts.append(el("li", "warn", `\u26a0 ${s.untimedCount} hop${s.untimedCount > 1 ? "s have" : " has"} no readable timestamp`));
  if (facts.children.length) box.append(facts);
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// The sending side of a step: the hop's own "from" when it has one,
// otherwise whatever the previous point on the timeline was.
function senderLabel(r) {
  if (r.kind === "hop" && r.from) return r.from;
  return r.prev ? hostLabel(r.prev) : "unknown";
}

function hostLabel(r) {
  if (r.kind === "origin") return "Date: header";
  if (r.kind === "signature") return (r.header === "arc-seal" ? "ARC sealed by " : "signed by ") + (r.domain || "unknown domain");
  // Local handoffs like "(qmail 1234 invoked by uid 89)" have no from/by; show their comment instead.
  return r.by || r.from || (r.info && r.info.replace(/[()]/g, "").trim().slice(0, 60)) || "unknown host";
}

function renderRow(r, max) {
  const sig = r.kind === "signature";
  const li = el("li", "row " + (sig ? "sig" : r.time ? speedClass(r.delta) : "untimed"));
  if (r.kind === "origin") li.classList.add("origin");

  const details = el("details");
  const sum = el("summary");

  let deltaText;
  if (!r.time) deltaText = "?";
  else if (r.delta == null) deltaText = "start";
  else deltaText = fmt(r.delta);
  sum.append(el("span", "delta", deltaText));

  const main = el("div", "main");
  const track = el("div", "track");
  const bar = el("div", "bar");
  bar.style.width = barWidth(r.delta, max) + "%";
  track.append(bar);
  main.append(track);

  const what = el("div", "what");
  what.append(el("span", "host", hostLabel(r)));
  if (r.kind === "origin") {
    what.append(el("span", "sub", "sender's clock"));
  } else if (sig) {
    what.append(el("span", "tag", r.header === "arc-seal" ? `ARC i=${r.instance || "?"}` : "DKIM"));
  } else {
    if (r.by && r.from) what.append(el("span", "sub", "from " + r.from));
    if (r.with) what.append(el("span", "tag", r.with));
    if (r.header === "x-received") what.append(el("span", "tag x", "X-Received"));
  }
  main.append(what);

  const when = el("div", "when");
  if (r.time) {
    when.append(el("span", null, timeFmt.format(r.time.ms)));
    if (r.elapsed) when.append(el("span", null, "T" + fmt(r.elapsed)));
    if (!r.time.zoneKnown) when.append(el("span", "warn", "\u26a0 time zone missing, assumed UTC"));
    if (r.delta != null && r.delta < 0) when.append(el("span", "warn", "\u26a0 earlier than the previous step"));
  } else {
    when.append(el("span", "warn", "\u26a0 no readable timestamp"));
  }
  main.append(when);

  sum.append(main);
  details.append(sum);
  let rawText;
  if (r.kind === "origin") rawText = "Date: " + r.raw;
  else if (sig) rawText = signatureText(r);
  else rawText = (r.header === "x-received" ? "X-Received: " : "Received: ") + MR.formatTraceLine(r.raw);
  details.append(el("pre", "raw", rawText));
  li.append(details);
  return li;
}

// Signature headers minus the long base64 blobs and header lists.
function signatureText(r) {
  const name = r.header === "arc-seal" ? "ARC-Seal" : "DKIM-Signature";
  const keep = Object.entries(r.tags).filter(([k]) => !["b", "bh", "h"].includes(k));
  return name + ":\n    " + keep.map(([k, v]) => `${k}=${v}`).join(";\n    ") +
    `\n\n    t= is ${new Date(r.time.ms).toISOString().replace(".000", "")}, the signing time`;
}

function renderRows(t) {
  const ol = $("timeline");
  ol.replaceChildren();
  let lastDay = null;
  for (const r of t.rows) {
    if (r.kind === "delivered") {
      ol.append(el("li", "delivered", "Delivered-To: " + r.raw));
      continue;
    }
    if (r.time) {
      const day = dayFmt.format(r.time.ms);
      if (day !== lastDay) {
        ol.append(el("li", "day", day));
        lastDay = day;
      }
    }
    ol.append(renderRow(r, t.summary.maxDelta));
  }
}

function render() {
  const t = MR.buildTimeline(MR.parseHeaders(raw));
  renderSummary(t);
  renderRows(t);
}

async function init() {
  try {
    const msg = await displayedMessage();
    if (!msg) return status("No message is displayed.");
    raw = await rawMessage(msg.id);
    render();
  } catch (e) {
    // Thunderbird hides IMAP messages marked as deleted from add-ons, even while it still displays them.
    if (/not found/i.test(e.message)) {
      status("Thunderbird doesn't let add-ons read this message. This happens with messages marked as deleted on an IMAP server (shown struck through in the list). Undelete it to see its route.");
    } else {
      status("Couldn't read this message: " + e.message);
    }
  }
}

init();
