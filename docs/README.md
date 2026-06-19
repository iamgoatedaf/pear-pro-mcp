# Pear Pro MCP — Documentation

The docs site for [`pear-pro-mcp`](https://github.com/iamgoatedaf/pear-pro-mcp), built with [Mintlify](https://mintlify.com).

Everything lives in this `docs/` folder:

```
docs/
├── docs.json          # Mintlify config: tabs, navigation, theme
├── favicon.svg
├── index.mdx          # Welcome
├── get-started/       # what-is, installation, quickstart, configuration, safety
├── adapters/          # cursor, claude-desktop, claude-code, codex, generic
├── guides/            # market-scan, pair-analytics, guarded-trade, rebalance-monitor, trade-ideas
├── tools/             # overview + market-data, account, rebalance, trading, local-quant
├── internals/         # architecture, auth, rebalance-math, analytics-math, monitor
└── security/          # threat-model, disclaimer
```

## Preview locally

```bash
npm install -g mint        # Mintlify CLI
cd docs
mint dev                   # http://localhost:3000
```

Validate links before pushing:

```bash
mint broken-links
```

## Deploy via GitHub (automatic)

The site deploys itself on every push to `main` through the **Mintlify GitHub App** — no build step, no GitHub Pages, no Actions deploy job.

One-time setup:

1. Go to the [Mintlify dashboard](https://dashboard.mintlify.com) and sign in with GitHub.
2. **Create a project** and connect the `iamgoatedaf/pear-pro-mcp` repository.
3. When asked for the **docs directory**, set it to `docs` (this folder, where `docs.json` lives).
4. Mintlify installs its GitHub App on the repo and does the first deploy.

After that, every push to `main` that touches `docs/**` redeploys the live site automatically. Open the editor and the live URL from the dashboard (e.g. `https://<your-subdomain>.mintlify.app`), and add a custom domain there if you want one.

> The `.github/workflows/docs.yml` workflow in this repo is **validation only** — it runs `mint broken-links` on PRs and pushes so bad links fail CI. The actual publish is handled by the Mintlify GitHub App, exactly like the Lighter MCP docs.
