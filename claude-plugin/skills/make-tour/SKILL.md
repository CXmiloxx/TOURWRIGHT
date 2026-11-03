---
name: make-tour
description: Make a narrated video of a web app (a product tour, an onboarding walkthrough, a how-to or a demo) or a step-by-step guide with screenshots, with Tourwright. Use when the user asks for a video, tutorial, walkthrough, demo recording or help-center guide of a website or app, or wants one updated after the app changed.
---

# Make a narrated tour with Tourwright

Tourwright films a real browser following a declarative script (YAML or JSON), narrates it with text-to-speech,
and returns an MP4 with captions, chapters and a poster. The `tourwright` MCP server of this plugin does the work.

## The loop

1. Call `tourwright_guide` once: the full script format, every action and the voices.
2. Learn the site before writing. Prefer robust targets: `{ role, name }`, `{ label }`, `{ placeholder }`,
   `{ text }`, never brittle CSS. When a shell is available, `npx tourwright explore <url> --json` lists the
   sections of a site and the targets of each page, and `--draft tour.yaml` writes a first script.
3. Write the script: a `title` per section, one idea per `say`, sentences of 6 to 18 words that describe what
   is on screen now. `focus` (dims everything but the element, explains it, can zoom and click) is the most
   effective step for onboarding videos.
4. `tourwright_validate`, then `tourwright_render` with `options.dryRun: true`: it runs every step in seconds and
   reports the step that fails with the targets its page offers. Fix and repeat.
5. Render for real and give the user `links.video` (or the local path).
6. A video that used to work broke after a deploy: `tourwright_check` names the step and proposes the new target.

## Rules

- Credentials never go in the chat or the script: write `${secret:NAME}` and ask the user to run
  `npx tourwright secret set NAME` once. `${totp:NAME}` types a 2FA code.
- Pick a voice whose language matches `language` (`tourwright_voices` lists what works on this machine).
- Personal data on screen: `mask: [email, phone, id]` replaces it with invented data; `blur` hides an element.
- Never add pauses to wait for the voice: Tourwright waits for each line to end before the next one.
- The first render on a new machine may need `npx tourwright install` (ffmpeg, voices, Chromium; no root).

## Example

```yaml
title: Your first invoice
language: en
voice: lessac
baseUrl: https://app.example.com
steps:
  - goto: /invoices/new
  - title: { text: Your first invoice, subtitle: Step by step }
  - focus: { target: { label: Customer }, say: "First, choose the {customer}.", zoom: 1.3 }
  - select: { target: { label: Customer }, value: Acme }
  - focus: { target: { role: button, name: Save }, say: "Then press {Save}. That's it.", click: true }
  - say: null
```
