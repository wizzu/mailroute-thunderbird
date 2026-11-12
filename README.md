# Mail Route Timeline

A Thunderbird extension that shows how an email travelled to you: every
`Received` hop in order, with the time each step took since the previous one.
Slow steps stand out at a glance, without working out time differences from
raw timestamps.

It is a GUI successor to `mailroute`, a Perl script for the Mutt mail client
(kept in [`reference/`](reference/mailroute.pl)).

## What it shows

A **Route** button in the message header toolbar opens a panel with:

- **Summary:** the total duration from the `Date:` header to the final hop,
  the number of hops and distinct servers, the slowest step with both ends of
  the handoff and its share of the total, and how much of the time passed
  before the first recorded hop.
- **Timeline:** one row per hop, oldest first. Each row shows the time since
  the previous step, colour-coded (green under 10 s, amber under 5 min, red
  beyond), with a log-scale bar, the receiving server, local time and elapsed
  time. Click a row for the raw header, split at from/by/with/id/for.
- **Signing points:** `t=` times from `DKIM-Signature` and `ARC-Seal`
  headers, as muted grey rows placed by timestamp. They are not hops, but they
  show where along the route a message was at a given moment.
- `Delivered-To:` lines in their place, Gmail's `X-Received` hops, and
  warnings for clock skew, hops without timestamps, and missing time zones.

The headers are shown as they are. Anything below the hops added by servers
you trust can be forged by the sender; interpreting them is up to you.

## Install

Build the `.xpi` (below), or take a ready one, and in Thunderbird open
**Add-ons and Themes → gear icon → Install Add-on From File…**. Thunderbird
copies the file into your profile, so the original can be deleted afterwards.
Installing a newer version the same way replaces the old one.

Requires Thunderbird 115 or later. The only permission it asks for is reading
messages.

For development, **Debug Add-ons → Load Temporary Add-on** and pick
`src/manifest.json`. That loads the source directly, without a build, until
Thunderbird restarts.

## Build and test

```sh
make          # run the tests, then build the .xpi
make build    # dist/mailroute-timeline-<version>.xpi
make test     # tests only
make clean
```

Building needs `zip`; the tests need Node.js 18 or later. The version comes
from `src/manifest.json`, so bump it there before building a release you'll
install over an earlier one.

## Layout

```
src/
  manifest.json   extension manifest (MailExtension, manifest v2)
  parse.js        header parsing and timeline building; no browser APIs
  popup.html      the panel
  popup.js        reads the displayed message and renders the panel
  popup.css       styling, light and dark
  icon.svg        toolbar icon
test/
  parse.test.js       parsing, ordering, durations, signature placement
  robustness.test.js  hostile input: nesting, flooding, bad dates, huge headers
reference/
  mailroute.pl    the original Perl script
```

`parse.js` works in both Thunderbird and Node, which is how the tests run it
without Thunderbird.

## Limitations

- Messages marked as deleted on an IMAP server (shown struck through) can't
  be read: Thunderbird hides them from extensions, even while it still
  displays them. The panel says so; undelete the message to see its route.
- Hops and signatures stamped in the same second can't always be ordered
  correctly; their deltas are 0 s either way.
- To keep hostile messages from hanging the panel, only the topmost 200 trace
  headers and 50 signatures are used, and header values are clipped to 8 KB.

## Credits

Based on `mailroute` by Chris Garrigues, with changes by Mikko Hänninen.
