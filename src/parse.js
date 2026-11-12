/*
 * Mail route timeline: header parsing and timeline building.
 *
 * Based on mailroute.pl by Chris Garrigues <cwg@DeepEddy.Com>,
 * with changes by Mikko Hänninen <Mikko.Hanninen@iki.fi>.
 *
 * No browser or Thunderbird APIs in here, so it can be tested with plain node.
 */
"use strict";
(function (root) {
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  // RFC 5322 obsolete zone names, in minutes east of UTC.
  const ZONES = { ut: 0, utc: 0, gmt: 0, z: 0, est: -300, edt: -240, cst: -360, cdt: -300, mst: -420, mdt: -360, pst: -480, pdt: -420 };

  function headerBlock(raw) {
    const m = /\r?\n\r?\n/.exec(raw);
    return m ? raw.slice(0, m.index) : raw;
  }

  // Limits against hostile messages. Real trace headers are well under 1 KB,
  // and real routes are a handful of hops.
  const MAX_VALUE = 8192; // characters kept per header value
  const MAX_TRACE = 200; // Received / X-Received / Delivered-To headers used
  const MAX_SIGS = 50; // DKIM-Signature / ARC-Seal headers used
  const MIN_MS = Date.UTC(1970, 0, 1);
  const MAX_MS = Date.UTC(2200, 0, 1);

  // Over-long values keep their start and end; the end is where a Received date lives.
  function clip(value) {
    if (value.length <= MAX_VALUE) return value;
    return value.slice(0, MAX_VALUE / 2) + " … " + value.slice(-MAX_VALUE / 2);
  }

  // Header fields in message order (topmost first), continuation lines unfolded.
  function parseHeaders(raw) {
    const out = [];
    for (const line of headerBlock(raw).split(/\r?\n/)) {
      if (/^[ \t]/.test(line)) {
        if (out.length) out[out.length - 1].value += " " + line.trim();
        continue;
      }
      const m = /^([\x21-\x39\x3b-\x7e]+):[ \t]*(.*)$/.exec(line);
      if (m) out.push({ name: m[1].toLowerCase(), value: m[2].trim() });
    }
    for (const h of out) h.value = clip(h.value);
    return out;
  }

  // Remove (comments), nested ones included, in a single pass.
  function stripComments(s) {
    let out = "";
    let depth = 0;
    for (const ch of s) {
      if (ch === "(") {
        if (depth++ === 0) out += " ";
      } else if (ch === ")") {
        if (depth > 0) depth--;
      } else if (depth === 0) {
        out += ch;
      }
    }
    return out.replace(/\s+/g, " ").trim();
  }

  const inRange = (ms) => Number.isFinite(ms) && ms >= MIN_MS && ms <= MAX_MS;

  // Returns { ms, zoneKnown } or null. zoneKnown is false when the zone was
  // missing or an unrecognised name, in which case UTC is assumed (as in the original).
  function parseDate(str) {
    const s = stripComments(str);
    const m = /(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s+([+-]\d{4}|[a-z]+))?/i.exec(s);
    if (m) {
      const mon = MONTHS[m[2].toLowerCase()];
      if (mon !== undefined) {
        let y = +m[3];
        if (m[3].length <= 2) y += y < 50 ? 2000 : 1900;
        let offset = 0;
        let zoneKnown = true;
        const z = m[7];
        if (!z) {
          zoneKnown = false;
        } else if (/^[+-]\d{4}$/.test(z)) {
          const sign = z[0] === "-" ? -1 : 1;
          offset = sign * (+z.slice(1, 3) * 60 + +z.slice(3, 5));
        } else if (Object.hasOwn(ZONES, z.toLowerCase())) {
          offset = ZONES[z.toLowerCase()];
        } else {
          zoneKnown = false;
        }
        const ms = Date.UTC(y, mon, +m[1], +m[4], +m[5], +(m[6] || 0)) - offset * 60000;
        return inRange(ms) ? { ms, zoneKnown } : null;
      }
    }
    const ms = Date.parse(s);
    return inRange(ms) ? { ms, zoneKnown: true } : null;
  }

  // "information; date" -- the date is after the last semicolon.
  function parseReceived(value) {
    const i = value.lastIndexOf(";");
    const info = (i >= 0 ? value.slice(0, i) : value).trim();
    const dateText = i >= 0 ? value.slice(i + 1).trim() : "";
    const bare = stripComments(info);
    const word = (kw) => {
      const m = new RegExp("(?:^|\\s)" + kw + "\\s+(\\S+)", "i").exec(bare);
      return m ? m[1] : null;
    };
    return {
      info,
      dateText,
      from: word("from"),
      by: word("by"),
      with: word("with"),
      time: dateText ? parseDate(dateText) : null,
    };
  }

  // "k1=v1; k2=v2" tag lists of DKIM-Signature / ARC-Seal; whitespace in values dropped.
  function parseTags(value) {
    const tags = Object.create(null);
    for (const part of value.split(";")) {
      const i = part.indexOf("=");
      if (i > 0) tags[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).replace(/\s+/g, "");
    }
    return tags;
  }

  // Signing times from DKIM-Signature and ARC-Seal t= tags. Not hops, but they
  // pin down where along the route a message was at a given moment.
  function signatureRows(headers) {
    const out = [];
    const sigHeaders = headers.filter((h) => h.name === "dkim-signature" || h.name === "arc-seal");
    for (const h of sigHeaders.slice(0, MAX_SIGS)) {
      const tags = parseTags(h.value);
      const t = Number(tags.t);
      if (!tags.t || !inRange(t * 1000)) continue;
      out.push({
        kind: "signature",
        header: h.name,
        raw: h.value,
        tags,
        domain: tags.d || null,
        instance: tags.i || null,
        time: { ms: t * 1000, zoneKnown: true },
      });
    }
    return out.sort((a, b) => a.time.ms - b.time.ms);
  }

  const isAnchor = (r) => (r.kind === "hop" || r.kind === "origin") && r.time;

  // Place each signature just before the first hop (or Date:) stamped later than it.
  function insertSignatures(rows, sigs) {
    for (const sig of sigs) {
      const idx = rows.findIndex((r) => isAnchor(r) && r.time.ms > sig.time.ms);
      if (idx >= 0) rows.splice(idx, 0, sig);
      else rows.splice(rows.findLastIndex((r) => r.time) + 1, 0, sig);
    }
  }

  /*
   * Rows oldest first:
   *   { kind: "origin" }     the Date: header (sender's clock)
   *   { kind: "hop" }        a Received / X-Received header
   *   { kind: "delivered" }  a Delivered-To header, in its place along the route
   *   { kind: "signature" }  a DKIM / ARC signing time, placed by its timestamp
   * Timed rows get delta (seconds since the previous timed row, null for the first)
   * and elapsed (seconds since the first timed row).
   */
  function buildTimeline(headers, opts = {}) {
    const includeX = opts.includeXReceived !== false;
    const rows = [];

    const dateHdr = headers.find((h) => h.name === "date");
    if (dateHdr) {
      const time = parseDate(dateHdr.value);
      if (time) rows.push({ kind: "origin", raw: dateHdr.value, time });
    }

    // Keep the topmost trace headers if there are too many: those were added by the
    // servers nearest to you, while padding by a sender would sit at the bottom.
    const trace = headers.filter((h) => h.name === "received" || (h.name === "x-received" && includeX) || h.name === "delivered-to");
    const omitted = Math.max(0, trace.length - MAX_TRACE);

    // Trace fields are prepended at each hop, so walk bottom-up for oldest first.
    for (const h of trace.slice(0, MAX_TRACE).reverse()) {
      if (h.name === "delivered-to") rows.push({ kind: "delivered", raw: h.value });
      else rows.push({ kind: "hop", header: h.name, raw: h.value, ...parseReceived(h.value) });
    }

    if (opts.includeSignatures !== false) insertSignatures(rows, signatureRows(headers));

    let prev = null;
    let base = null;
    for (const r of rows) {
      if (r.kind === "delivered" || !r.time) continue;
      if (base === null) base = r.time.ms;
      r.elapsed = (r.time.ms - base) / 1000;
      r.delta = prev === null ? null : (r.time.ms - prev.time.ms) / 1000;
      r.prev = prev;
      prev = r;
    }

    const hops = rows.filter((r) => r.kind === "hop");
    const timedHops = hops.filter((r) => r.time);
    const origin = rows.find((r) => r.kind === "origin") || null;
    const timed = rows.filter((r) => r.kind !== "delivered" && r.time);
    const last = timedHops.length ? timedHops[timedHops.length - 1] : null;

    let slowest = null;
    for (const r of timed) {
      if (r.delta != null && r.delta > 0 && (!slowest || r.delta > slowest.delta)) slowest = r;
    }

    return {
      rows,
      summary: {
        hopCount: hops.length,
        omitted,
        // A server can stamp several hops (local delivery, content filters, internal relays).
        serverCount: new Set(hops.map((r) => (r.by || "").toLowerCase()).filter(Boolean)).size,
        transit: timedHops.length >= 2 ? (last.time.ms - timedHops[0].time.ms) / 1000 : null,
        sinceDate: origin && last ? (last.time.ms - origin.time.ms) / 1000 : null,
        beforeFirstHop: origin && timedHops.length ? (timedHops[0].time.ms - origin.time.ms) / 1000 : null,
        slowest,
        maxDelta: slowest ? slowest.delta : 0,
        skewCount: timed.filter((r) => r.delta != null && r.delta < 0).length,
        untimedCount: hops.length - timedHops.length,
      },
    };
  }

  // Break before from/by/with/id/for/via, but not inside (comments) -- as the original did.
  function formatTraceLine(value) {
    let out = "";
    let depth = 0;
    const re = /(\()|(\))|(?:^|(?<=\s))(from|by|with|id|for|via)(?=\s)/gi;
    let last = 0;
    let m;
    while ((m = re.exec(value))) {
      if (m[1]) depth++;
      else if (m[2]) depth = Math.max(0, depth - 1);
      else if (depth === 0 && m.index > 0) {
        out += value.slice(last, m.index).trimEnd() + "\n    ";
        last = m.index;
      }
    }
    out += value.slice(last);
    const i = out.lastIndexOf(";");
    return i >= 0 ? out.slice(0, i + 1) + "\n    " + out.slice(i + 1).trim() : out;
  }

  // 0s, 13s, 1m 13s, 3h 48m 34s, 2d 3h 4m
  function formatDuration(sec, signed = true) {
    const neg = sec < 0;
    let s = Math.round(Math.abs(sec));
    const d = Math.floor(s / 86400);
    s %= 86400;
    const h = Math.floor(s / 3600);
    s %= 3600;
    const m = Math.floor(s / 60);
    s %= 60;
    const parts = [];
    if (d) parts.push(d + "d");
    if (h) parts.push(h + "h");
    if (m) parts.push(m + "m");
    if (!d && (s || !parts.length)) parts.push(s + "s");
    const sign = neg ? "\u2212" : signed ? "+" : "";
    return sign + parts.join(" ");
  }

  const api = { parseHeaders, parseDate, parseReceived, parseTags, buildTimeline, formatDuration, formatTraceLine };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MailRoute = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
