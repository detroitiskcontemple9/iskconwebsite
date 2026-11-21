# ISKCON Detroit website

The new home of iskcondetroit.com: Next.js, exported as a static site, hosted free on Cloudflare Pages.

**Step 1 (now):** an exact copy of the current WordPress site, served unchanged from `public/`.
**Step 2:** convert it to real Next.js page by page (header, nav and footer first).
**Step 3:** TinaCMS so volunteers can edit, plus forms, donations and booking through embedded services.

Rules: WordPress stays live and nothing is installed on it. Email stays on Bluehost, so never change MX/SPF or other
email DNS records. Deploy only to the `*.pages.dev` test address until the team approves the switch.

## Step 1: make the copy

Run this on your own computer (a home or temple connection). Cloud servers are blocked by the site's Cloudflare bot check.
Needs Node.js 20+, `wget` and `curl` (macOS: `brew install wget`; Windows: use WSL).

```bash
npm install
```

```bash
npm run mirror
```

```bash
npm run clean-mirror
```

`mirror` reads `wp-sitemap.xml`, downloads every page with its images, CSS, JS and fonts into `mirror/`, and saves page
and post content from the WordPress REST API into `mirror/wp-json/` for Step 2. It waits between requests so the live
site stays fast. Expect 10–30 minutes.

`clean-mirror` builds `public/` from it and writes three reports in `reports/`:

- `missing-assets.txt`: files the pages use that weren't downloaded (often lazy-loaded images). Fetch them, then clean again:
  ```bash
  bash scripts/mirror.sh reports/missing-assets.txt && npm run clean-mirror
  ```
- `broken-links.md`: internal links that point nowhere.
- `dynamic-features.md`: forms, search, comments, donations, calendars and booking, each marked works-as-is or needs a
  replacement, with a suggestion.

Then commit `public/` and `reports/` and push.

### If the copy is blocked (HTTP 403)

The live site sits behind Cloudflare's bot check. If `npm run mirror` says 403 even from home, whoever manages
iskcondetroit.com in Cloudflare can let that one computer through for an hour: Security → WAF → Tools → IP Access Rules
→ your IP → Allow. Remove the rule afterwards. Nothing else on the site changes.

## Look at it locally

```bash
npm run build && npm run preview
```

Opens the static site from `out/` at http://localhost:3000. Compare it page by page with the live site.

## Deploy to the test address

Deploys go to the temple Cloudflare account as the Pages project `iskcon-detroit`, at https://iskcon-detroit.pages.dev.
The live domain and DNS are not touched.

```bash
npm run build && CLOUDFLARE_API_TOKEN=... npm run deploy
```

The temple account ID is already in the `deploy` script in `package.json`. The first deploy creates the project. Token: Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom
token, with one permission: Account → Cloudflare Pages → Edit.

## How it fits together

| Path | What it is |
|---|---|
| `public/` | The cleaned copy of the WordPress site, same URL paths. `next build` copies it to `out/` unchanged. |
| `app/` | Next.js pages. Empty in Step 1; pages move here one by one in Step 2 (and leave `public/`). |
| `overrides/` | Hand fixes copied over `public/` on every clean. |
| `scripts/mirror.sh` | Copies the live site from the outside (wget + sitemap + REST API). |
| `scripts/clean-mirror.mjs` | Builds `public/` and the reports. Edits only the parts it must; the rest stays byte-for-byte the same. |
| `scripts/postbuild.mjs` | Puts the WordPress 404 page back after `next build`. |
| `reports/` | Missing assets, broken links, dynamic features. |

`next.config.mjs` uses `output: 'export'` (static files only) and `trailingSlash: true`, so `/about-us/` stays
`/about-us/` and old links and Google rankings keep working.
