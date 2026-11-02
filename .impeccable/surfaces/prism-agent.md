---
version: 1
slug: "prism-agent"
primary_target: "prism-agent"
related_targets: []
---

# Surface brief — Prism app shell (redesign)

Scope: the whole app — sidebar, thread, reasoning blocks, tool cards, composer, model popover, theme system. Operate surface.

## Direction contract

THESIS: A warm, calm workspace where the reasoning slider is the signature object — one terracotta thread through an ivory world, with depth removed in favor of hairlines. Refuses the category default: dark cockpit with neon glow and stacked 3D layers.

OWN-WORLD: Warm ivory ground (#F5F3EE) with warm-white surfaces and hairline warm-gray borders; editorial serif (Zodiak) display voice over Satoshi body; terracotta accent (#C96442) used sparingly (slider, active states, send button). Warm charcoal dark mode, same accent brightened. Almost no shadows — one hairline system everywhere; the only "shine" is the slider's animated indicator.

STORY: The visitor lands on a quiet ivory canvas with serif words; picks a model (with real provider icons), sweeps the reasoning slider (animated), sends. They read the assistant's answer as prose on paper, open the reasoning if they want, watch tool cards work, and trust Auto mode because its plan-draft-polish stages show progress.

FIRST VIEWPORT: Sidebar left (conversations, new chat, GitHub connector); thread center with generous measure (68ch); empty state = serif greeting "How can I help?" + four suggestion cards below; composer pinned bottom with model chip, reasoning slider (signature), attach, send. Primary action (send) bottom-right of the composer.

FORM: Code-led redesign of the existing single-page app (user-pinned Claude-inspired direction; comp round skipped by pinned brief). seed: none (unavailable).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Notes
- models.json tab: provider-configured models. Free tab: auto-discovered keyless models from the stillworks hourly-verified directory (Pollinations, OVH, Free.ai, LLM7), each with provider favicon, model-family icon, capability badges, and reliability.
- iPad: 900px breakpoint, ≥44px touch targets, hover styles gated by (hover:hover), safe-area insets, prefers-reduced-motion fully respected.
