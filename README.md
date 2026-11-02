# Prism — AI Agent Workspace

A minimal, animated multi-model AI chat that runs entirely in the browser — a single static site, perfect for GitHub Pages.

**Live:** https://ardy03851-bit.github.io/prism-agent/

**Try it live:** the site works out of the box with free models that need no account or API key. Add your own models any time via `models.json`.

## Features

- **Any model** — every OpenAI-compatible endpoint works: change the base URL, drop in an API key.
- **Free models, no key** — the "Free · no key" tab auto-discovers ~30 live keyless models across four providers (Pollinations, OVH, Free.ai, LLM7), verified hourly via a public directory, with provider icons, capability badges, and reliability stats. Free tiers are rate-limited.
- **Agent abilities** — capable models can fetch web pages, search, read GitHub repos, and run JavaScript in a sandbox. If a model can't use a tool, it just continues without it.
- **Auto mode** — a multi-model pipeline: one model plans, another drafts, a third polishes and connects everything into the final answer.
- **Reasoning slider** — from Off to Max reasoning effort, with a live "thinking" panel for reasoning models.
- **Light & dark themes** — warm ivory and warm charcoal, with a toggle that remembers your choice.
- **iPad friendly** — touch-sized targets, drawer sidebar, and full support for the system Reduce Motion setting.
- **GitHub repo connector** — paste `owner/repo` and the agent can read the tree, README, and files while it works.
- **File attachments** — text files and images (vision models).

## Adding your own models

Edit [`models.json`](models.json). Each entry:

```json
{
  "models": [
    {
      "id": "gpt-4o-mini",
      "name": "GPT-4o mini",
      "company": "OpenAI",
      "icon": "https://cdn.simpleicons.org/openai/ffffff",
      "baseUrl": "https://api.openai.com/v1/chat/completions",
      "apiKey": "sk-...",
      "model": "gpt-4o-mini",
      "tools": true,
      "reasoning": false,
      "vision": true
    }
  ]
}
```

| Field | What it does |
| --- | --- |
| `baseUrl` | The proxy or provider endpoint (OpenAI-compatible `chat/completions`) |
| `apiKey` | Sent as `Authorization: Bearer …` (omit or leave empty for keyless endpoints) |
| `model` | The model ID the endpoint expects |
| `name` / `company` | Shown in the model picker |
| `icon` | URL to an image, an emoji like `"🦊"`, or leave it out for initials |
| `tools` / `reasoning` / `vision` | Capability flags — set `false` if the model doesn't support them |

Works with OpenAI, OpenRouter, Groq, Together, local LLM servers (Ollama, LM Studio), Cloudflare AI Gateway, or any proxy that speaks the OpenAI chat format.

## Notes

- `models.json` lives in the repo, so **don't commit real API keys to a public repo**. For personal use, host privately, use a proxy that injects keys, or accept the risk — a private fork + Cloudflare Pages / Vercel is a good alternative.
- Conversations and settings are stored in the browser's local storage.
- The free tier is shared and anonymous — expect occasional waits during busy periods.

## Run locally

Just serve the folder (any static server works):

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. (Opening `index.html` directly from disk also works, but the model list fetch benefits from a server.)

## License

MIT — do whatever you like.
