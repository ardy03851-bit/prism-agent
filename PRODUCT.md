# PRODUCT.md — Prism

## What it is
Prism is a static, single-page AI agent workspace that runs entirely in the browser and deploys to GitHub Pages. One prompt goes in; one or several models plan, draft, and polish the answer out.

## Audience
A single owner-operator (and anyone they share the public GitHub Pages URL with) who wants a personal, hackable AI workspace without accounts, servers, or subscriptions: chatting, light research, code help, and GitHub repo Q&A.

## Core jobs
1. Chat with any OpenAI-compatible model the user adds in `models.json` (proxy URL, API key, model ID, icon).
2. Chat instantly with auto-discovered free keyless models — no signup, no key.
3. Give capable models agent abilities (fetch URL, search, run JS, read GitHub repos); models without a tool skip it and continue.
4. Auto mode: plan → draft → polish across multiple models, with graceful fallbacks.
5. Reasoning/thought control, with live reasoning display.
6. File attachments and a connected GitHub repository.

## Truth and constraints
- Static site: no backend, no build step. Persistence = browser local storage (guarded, degrades in sandboxed iframes).
- Free models come from third-party keyless services (Pollinations, OVH anonymous endpoints, Free.ai, LLM7) discovered via the stillworks hourly-verified directory; they are rate-limited, per-IP quota'd, and can disappear. Never present them as guaranteed.
- `models.json` may contain API keys; it is committed to a public repo by the owner's choice — the README warns about this.
- All model capability claims shown in the UI come from the providers' own metadata/verification feeds, not invented.

## Brand commitments (user-pinned)
- Inspired by Claude's app aesthetic: warm, cozy, modern, editorial serif headings, terracotta accent, minimal depth (hairline borders over shadows).
- A beautiful, animated, non-childish reasoning slider is a signature element.
- Fully usable on iPad, including with the system Reduce Motion setting on.
- Light and dark themes, warm in both — never cold gray or neon.

## Non-goals
- Multi-user accounts, sync, server-side history.
- Mobile app; the browser is the platform.
