#!/usr/bin/env node
// Turn the raw wget copy (mirror/iskcondetroit.com) into a static site in public/.
//
//   npm run clean-mirror
//
// What it does, without changing the design:
//  1. Copies every file into public/ under the same URL path. Files saved with a
//     query string (style.css?ver=6.4) are stored as style.css: static hosts ignore
//     the ?ver= part, so the original links keep working.
//  2. Rewrites absolute https://iskcondetroit.com/... links to root-relative /...,
//     so the copy works on the *.pages.dev test address. Canonical links, og:/twitter:
//     meta tags and JSON-LD keep the full URL, because Google needs it.
//  3. Removes WordPress-only tags that call the server: REST API / oEmbed / RSD /
//     wlwmanifest / pingback / shortlink / feed links, the comment form and its script.
//  4. Copies overrides/ on top (hand fixes that survive a re-run).
//  5. Writes reports/:
//       missing-assets.txt   files the pages use that the copy lacks (fetch with
//                            `bash scripts/mirror.sh reports/missing-assets.txt`)
//       broken-links.md      internal page links that point nowhere
//       dynamic-features.md  forms, search, donations, calendars and other features
//                            that need a server, with a suggested replacement
//
// Only the parts listed above change. Everything else stays byte-for-byte the same.

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'parse5';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HOST = 'iskcondetroit.com';
const SITE = `https://${HOST}`;
const SRC = path.join(ROOT, 'mirror', HOST);
const OUT = path.join(ROOT, 'public');
const OVERRIDES = path.join(ROOT, 'overrides');
const REPORTS = path.join(ROOT, 'reports');

if (!fs.existsSync(SRC)) {
  console.error(`No copy found at ${path.relative(ROOT, SRC)}. Run \`npm run mirror\` first.`);
  process.exit(1);
}

// ---------- 1. copy files, stripping query strings from names ----------

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });

const skipped = [];
// Plain names first, so "style.css" wins over "style.css?ver=6.4" if both exist.
const srcFiles = walk(SRC).sort((a, b) => a.includes('?') - b.includes('?') || a.localeCompare(b));
for (const file of srcFiles) {
  let rel = path.relative(SRC, file);
  if (rel.includes('?')) {
    const [base, query] = rel.split('?');
    // A page fetched with a query (/?p=12, /page/2/?s=x) is not a real page. Skip it.
    if (/(^|\/)index\.html$/.test(base) || /(^|&)(p|page_id|s|replytocom|share)=/.test(query)) {
      skipped.push(rel);
      continue;
    }
    rel = base;
  }
  const dest = path.join(OUT, rel);
  if (fs.existsSync(dest)) continue;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}

// ---------- helpers ----------

const ABS = /(?:https?:)?\/\/(?:www\.)?iskcondetroit\.com(\/?)/gi;
const ABS_ESCAPED = /(?:https?:)?\\\/\\\/(?:www\.)?iskcondetroit\.com((?:\\\/)?)/gi;
const toRelative = (s) => s.replace(ABS, '/').replace(ABS_ESCAPED, '\\/');

const getAttr = (node, name) => node.attrs?.find((a) => a.name === name)?.value;
const hasClassOrId = (node, re) => re.test(getAttr(node, 'id') || '') || re.test(getAttr(node, 'class') || '');

function* elements(node) {
  if (node.tagName) yield node;
  for (const c of node.childNodes || []) yield* elements(c);
  if (node.content) yield* elements(node.content); // <template>
}

// URL (as written in a page) -> site path, or null if external.
function localPath(url, baseDir) {
  if (!url) return null;
  url = url.trim();
  if (!url || /^(#|mailto:|tel:|javascript:|data:|blob:|about:)/i.test(url)) return null;
  let u;
  try {
    u = new URL(url, `${SITE}${baseDir}`);
  } catch {
    return null;
  }
  if (u.hostname.replace(/^www\./, '') !== HOST) return null;
  try {
    return decodeURIComponent(u.pathname);
  } catch {
    return u.pathname;
  }
}

function existsInOut(p) {
  const f = path.join(OUT, p);
  if (p.endsWith('/')) return fs.existsSync(path.join(f, 'index.html'));
  if (fs.existsSync(f) && fs.statSync(f).isFile()) return true;
  return fs.existsSync(path.join(f, 'index.html'));
}

const ASSET_EXT = /\.(css|js|mjs|json|png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mp3|ogg|wav|pdf|docx?|xlsx?|pptx?|zip|txt|xml)$/i;

const missingAssets = new Map(); // path -> Set(pages)
const brokenLinks = new Map(); // path -> Set(pages)
const note = (map, key, page) => (map.get(key) || map.set(key, new Set()).get(key)).add(page);

function checkRef(url, baseDir, page, kind) {
  const p = localPath(url, baseDir);
  if (!p || existsInOut(p)) return;
  // Server endpoints are reported as dynamic features, not as missing files.
  if (/^\/(wp-admin|wp-json|xmlrpc\.php|wp-login\.php|wp-comments-post\.php)/.test(p) || /\/feed\/?$/.test(p)) return;
  if (kind === 'asset' || ASSET_EXT.test(p)) note(missingAssets, p, page);
  else note(brokenLinks, p, page);
}

const srcsetUrls = (v) => (v || '').split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
const cssUrls = (css) => [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)].map((m) => m[2])
  .concat([...css.matchAll(/@import\s+(['"])([^'"]+)\1/gi)].map((m) => m[2]));

// ---------- 2-3. clean each HTML page ----------

// Dynamic feature detection: [id, label, test(htmlLower, $el helpers), works statically?, replacement]
const FEATURES = [
  ['cf7', 'Contact Form 7 form', /wpcf7/, false, 'Free form service with no server: Web3Forms or Formspree (free tiers), or a small Cloudflare Pages Function that emails the temple. Keep the same fields and look.'],
  ['wpforms', 'WPForms form', /wpforms/, false, 'Same as above: Web3Forms / Formspree, or a Cloudflare Pages Function.'],
  ['gravity', 'Gravity Forms form', /gform_wrapper|gform_/, false, 'Same as above: Web3Forms / Formspree, or a Cloudflare Pages Function.'],
  ['ninja', 'Ninja Forms form', /nf-form-cont|ninja-forms/, false, 'Same as above: Web3Forms / Formspree, or a Cloudflare Pages Function.'],
  ['elementor-form', 'Elementor form', /elementor-form/, false, 'Same as above: Web3Forms / Formspree, or a Cloudflare Pages Function.'],
  ['newsletter', 'Newsletter sign-up (Mailchimp etc.)', /mc4wp|list-manage\.com|mailchimp|tnp-subscription|newsletter-form/, null, 'A form that posts straight to list-manage.com (Mailchimp) keeps working. A plugin form (mc4wp, Newsletter) needs Mailchimp\'s own embed form.'],
  ['search', 'Site search box', /name=["']s["']|role=["']search["']|search-form/, false, 'Pagefind: free, runs after `next build`, no server. Same search box, results on a /search/ page.'],
  ['comments', 'Comments', /comment-form|id=["']respond["']|wp-comments-post/, false, 'The comment form is removed. Old comments stay as text. If comments are wanted: Giscus or simply "email us".'],
  ['paypal', 'PayPal donation link or button', /paypal\.com|paypalobjects\.com/, true, 'Works as-is (goes straight to PayPal). Check each button before switching.'],
  ['givewp', 'GiveWP donation form', /give-form|give-donation|givewp/, false, 'Hosted donation page that needs no server: Stripe Payment Links, PayPal Giving, Donorbox or Zeffy (free for non-profits). Link or embed it in the same spot.'],
  ['stripe', 'Stripe', /js\.stripe\.com|buy\.stripe\.com|checkout\.stripe\.com/, null, 'Stripe Payment Links / buy.stripe.com work as-is. A plugin checkout needs Stripe Payment Links.'],
  ['donation-other', 'Other donation service', /donorbox|zeffy|squareup|square\.link|givebutter|charitable/, true, 'Hosted service: works as-is. Check it.'],
  ['woocommerce', 'WooCommerce shop', /woocommerce/, false, 'Hosted store with no server: Square Online, Shopify Starter, or Stripe Payment Links per item.'],
  ['gcal', 'Google Calendar embed', /calendar\.google\.com/, true, 'Works as-is (iframe from Google).'],
  ['events-plugin', 'Events calendar plugin', /tribe-events|tribe-common|ai1ec|eventon|mec-wrap|modern-events-calendar|simcal|events-manager/, null, 'Event lists already on the page stay as they are, but month/next/filter buttons that use AJAX stop working. Step 2: build the events page from content files (TinaCMS) or embed a Google Calendar.'],
  ['booking', 'Booking / appointment plugin', /bookly|ameliabooking|amelia-|simplybook|wpbs-|booking-calendar|latepoint|calendly\.com/, null, 'Calendly links/embeds work as-is. A plugin needs a hosted service: Cal.com (free), Calendly, or Google Calendar appointment schedules.'],
  ['ajax', 'Script calling admin-ajax.php', /admin-ajax\.php/, false, 'This calls the WordPress server. Find what uses it (often a plugin\'s "load more" or form) and replace it as listed above. After the switch this call will fail.'],
  ['rest', 'Script calling the WordPress REST API', /\/wp-json\//, false, 'Calls the WordPress server. Same as admin-ajax: find the feature and replace it.'],
  ['recaptcha', 'reCAPTCHA', /recaptcha/, null, 'Belongs to a form. Goes with that form\'s replacement (Web3Forms / Turnstile).'],
  ['iframe', 'Embedded content (iframe)', null, true, 'Works as-is (YouTube, Facebook, Google Maps and similar load from their own servers).'],
];

const featureHits = new Map(); // id -> Map(page -> Set(details))
const hit = (id, page, detail = '') => {
  const m = featureHits.get(id) || featureHits.set(id, new Map()).get(id);
  (m.get(page) || m.set(page, new Set()).get(page)).add(detail);
};

const REMOVE_LINK_REL = /^(https:\/\/api\.w\.org\/|edituri|wlwmanifest|pingback|shortlink)$/i;
const REMOVE_ALT_TYPES = /(json\+oembed|xml\+oembed|application\/json|rss\+xml|atom\+xml)/i;
// Attributes that hold URLs (srcset-style ones are handled as text; same rewrite).
const URL_ATTRS = new Set(['href', 'src', 'srcset', 'action', 'poster', 'data', 'style', 'content', 'formaction',
  'data-src', 'data-srcset', 'data-lazy-src', 'data-lazy-srcset', 'data-bg', 'data-background', 'data-background-image',
  'data-href', 'data-url', 'data-thumb', 'data-full', 'data-large_image', 'data-settings', 'imagesrcset', 'xlink:href']);

const htmlFiles = walk(OUT).filter((f) => f.endsWith('.html'));
const removedCounts = {};
let pagesChanged = 0;

for (const file of htmlFiles) {
  const rel = '/' + path.relative(OUT, file).split(path.sep).join('/');
  const page = rel.replace(/index\.html$/, '');
  const baseDir = page.endsWith('/') ? page : path.posix.dirname(page) + '/';
  const html = fs.readFileSync(file, 'utf8');
  const doc = parse(html, { sourceCodeLocationInfo: true });
  const edits = []; // { start, end, text }
  const removed = (what) => (removedCounts[what] = (removedCounts[what] || 0) + 1);

  const removeNode = (node, what) => {
    const loc = node.sourceCodeLocation;
    if (!loc) return;
    let { startOffset: start, endOffset: end } = loc;
    // Also drop the line break after the tag, so no blank line is left behind.
    if (html[end] === '\n') end += 1;
    edits.push({ start, end, text: '' });
    removed(what);
  };

  // Elements already inside a removed node are skipped.
  const removedRanges = [];
  const insideRemoved = (n) => {
    const l = n.sourceCodeLocation;
    return l && removedRanges.some(([s, e]) => l.startOffset >= s && l.endOffset <= e);
  };
  const remove = (n, what) => {
    if (insideRemoved(n)) return;
    removeNode(n, what);
    removedRanges.push([n.sourceCodeLocation.startOffset, n.sourceCodeLocation.endOffset]);
  };

  const all = [...elements(doc)];

  // --- removals ---
  for (const el of all) {
    if (!el.sourceCodeLocation) continue;
    const tag = el.tagName;
    if (tag === 'link') {
      const rel = getAttr(el, 'rel') || '';
      const type = getAttr(el, 'type') || '';
      if (REMOVE_LINK_REL.test(rel.trim())) remove(el, `<link rel="${rel}">`);
      else if (/alternate/i.test(rel) && REMOVE_ALT_TYPES.test(type)) remove(el, `<link rel="alternate" type="${type}">`);
    } else if (tag === 'script' && /comment-reply(\.min)?\.js/.test(getAttr(el, 'src') || '')) {
      remove(el, 'comment-reply.js script');
    } else if ((tag === 'div' || tag === 'section') && getAttr(el, 'id') === 'respond') {
      remove(el, 'comment form (#respond)');
    } else if (tag === 'form' && /wp-comments-post\.php/.test(getAttr(el, 'action') || '')) {
      remove(el, 'comment form');
    }
  }

  // --- URL rewrites + reference checks ---
  const keepAbsolute = (el) => {
    if (el.tagName === 'link' && /\b(canonical|alternate)\b/i.test(getAttr(el, 'rel') || '') && getAttr(el, 'hreflang')) return true;
    if (el.tagName === 'link' && /\bcanonical\b/i.test(getAttr(el, 'rel') || '')) return true;
    if (el.tagName === 'meta') return true; // og:url, og:image, twitter:image need full URLs
    return false;
  };

  for (const el of all) {
    const loc = el.sourceCodeLocation;
    if (!loc || insideRemoved(el)) continue;

    // attributes
    if (loc.attrs && !keepAbsolute(el)) {
      for (const a of el.attrs) {
        if (!URL_ATTRS.has(a.name) && !a.name.startsWith('data-')) continue;
        const al = loc.attrs[a.name];
        if (!al) continue;
        const raw = html.slice(al.startOffset, al.endOffset);
        const fixed = toRelative(raw);
        if (fixed !== raw) edits.push({ start: al.startOffset, end: al.endOffset, text: fixed });
      }
    }

    // inline <style> and <script> text (not JSON-LD)
    if ((el.tagName === 'style' || (el.tagName === 'script' && getAttr(el, 'type') !== 'application/ld+json')) && el.childNodes?.[0]?.sourceCodeLocation) {
      const t = el.childNodes[0].sourceCodeLocation;
      const raw = html.slice(t.startOffset, t.endOffset);
      const fixed = toRelative(raw);
      if (fixed !== raw) edits.push({ start: t.startOffset, end: t.endOffset, text: fixed });
      if (el.tagName === 'style') cssUrls(raw).forEach((u) => checkRef(u, baseDir, page, 'asset'));
    }

    // reference checks
    const tag = el.tagName;
    if (tag === 'a' || tag === 'area') checkRef(getAttr(el, 'href'), baseDir, page, 'page');
    if (tag === 'link' && !keepAbsolute(el) && /stylesheet|icon|preload|manifest|apple-touch/i.test(getAttr(el, 'rel') || '')) {
      checkRef(getAttr(el, 'href'), baseDir, page, 'asset');
    }
    for (const n of ['src', 'data-src', 'data-lazy-src', 'poster', 'data-bg', 'data-background', 'data-background-image']) {
      if (getAttr(el, n) && !(tag === 'iframe' && n === 'src')) checkRef(getAttr(el, n), baseDir, page, 'asset');
    }
    for (const n of ['srcset', 'data-srcset', 'data-lazy-srcset', 'imagesrcset']) {
      srcsetUrls(getAttr(el, n)).forEach((u) => checkRef(u, baseDir, page, 'asset'));
    }
    if (getAttr(el, 'style')) cssUrls(getAttr(el, 'style')).forEach((u) => checkRef(u, baseDir, page, 'asset'));

    // feature detection on forms / iframes
    if (tag === 'iframe') {
      try {
        hit('iframe', page, new URL(getAttr(el, 'src') || getAttr(el, 'data-src') || '', SITE).hostname);
      } catch {}
    }
  }

  // Any other <form> that posts somewhere on this site.
  for (const el of all) {
    if (el.tagName !== 'form') continue;
    const action = getAttr(el, 'action') || '';
    const known = /wpcf7|wpforms|gform|nf-form|elementor|mc4wp|search|comment/i.test(
      (getAttr(el, 'class') || '') + (getAttr(el, 'id') || '') + action);
    const formHtml = html.slice(el.sourceCodeLocation.startOffset, el.sourceCodeLocation.endOffset);
    const isSearch = /name=["']?s["'\s>]/i.test(formHtml);
    if (!known && !isSearch && (localPath(action || page, baseDir) || !action)) hit('other-form', page, action || '(same page)');
  }

  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = html;
  let lastStart = Infinity;
  for (const e of edits) {
    if (e.end > lastStart) continue; // overlaps a removed block; already gone
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    lastStart = e.start;
  }
  if (out !== html) {
    fs.writeFileSync(file, out);
    pagesChanged++;
  }

  // Feature detection on the cleaned page, so removed WordPress tags don't count.
  // Comments are checked on the original, because the comment form was just removed.
  const lower = out.toLowerCase();
  for (const [id, , re] of FEATURES) {
    const text = id === 'comments' ? html.toLowerCase() : lower;
    if (re && re.test(text)) hit(id, page);
  }
}
FEATURES.push(['other-form', 'Other form posting to WordPress', null, false, 'Look at what it does; most become a Web3Forms / Formspree form.']);

// ---------- CSS files: rewrite absolute URLs, check url() references ----------

for (const file of walk(OUT).filter((f) => f.endsWith('.css'))) {
  const rel = '/' + path.relative(OUT, file).split(path.sep).join('/');
  const css = fs.readFileSync(file, 'utf8');
  const fixed = toRelative(css);
  if (fixed !== css) fs.writeFileSync(file, fixed);
  cssUrls(css).forEach((u) => checkRef(u, path.posix.dirname(rel) + '/', rel, 'asset'));
}

// ---------- 4. overrides ----------

if (fs.existsSync(OVERRIDES)) {
  for (const file of walk(OVERRIDES)) {
    if (path.basename(file) === 'README.md') continue;
    const dest = path.join(OUT, path.relative(OVERRIDES, file));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
    missingAssets.delete('/' + path.relative(OVERRIDES, file).split(path.sep).join('/'));
  }
}

// ---------- 5. reports ----------

fs.mkdirSync(REPORTS, { recursive: true });

fs.writeFileSync(
  path.join(REPORTS, 'missing-assets.txt'),
  [...missingAssets.keys()].sort().map((p) => SITE + encodeURI(p)).join('\n') + (missingAssets.size ? '\n' : ''),
);

const listPages = (set, max = 8) => {
  const a = [...set].sort();
  return a.slice(0, max).map((p) => `\`${p}\``).join(', ') + (a.length > max ? `, and ${a.length - max} more` : '');
};

fs.writeFileSync(
  path.join(REPORTS, 'broken-links.md'),
  `# Broken internal links\n\nLinks on the copied pages that point to a page the copy doesn't have. ` +
    `Either the page exists on the live site and the copy missed it (add it to the copy), or the link was already broken on the live site.\n\n` +
    (brokenLinks.size
      ? `| Link | Found on |\n|---|---|\n` + [...brokenLinks].sort().map(([p, s]) => `| \`${p}\` | ${listPages(s)} |`).join('\n') + '\n'
      : 'None found.\n'),
);

const status = (w) => (w === true ? 'Works as-is' : w === false ? '**Needs a replacement**' : 'Check');
let dyn = `# Dynamic features that need a server\n\n` +
  `Generated by \`npm run clean-mirror\` from the copied pages. The copy is static, so anything below marked ` +
  `"Needs a replacement" stops working once WordPress is switched off. Each one needs its replacement in place, and tested on the ` +
  `test address, before the switch (trial check 3: every page, form and donation link works).\n\n`;
const found = FEATURES.filter(([id]) => featureHits.has(id));
if (!found.length) dyn += 'No dynamic features detected.\n';
else {
  dyn += `| Feature | Status | Pages | Suggested replacement |\n|---|---|---|---|\n`;
  for (const [id, label, , works, fix] of found) {
    const pages = featureHits.get(id);
    let extra = '';
    if (id === 'iframe' || id === 'other-form') {
      const details = new Set([...pages.values()].flatMap((s) => [...s]).filter(Boolean));
      extra = ` (${[...details].sort().join(', ')})`;
    }
    dyn += `| ${label}${extra} | ${status(works)} | ${listPages(new Set(pages.keys()), 6)} | ${fix} |\n`;
  }
}
dyn += `\n## Removed automatically\n\n` +
  (Object.keys(removedCounts).length
    ? Object.entries(removedCounts).sort().map(([k, v]) => `- ${k.replace(/</g, '&lt;')}: ${v}`).join('\n') + '\n'
    : 'Nothing.\n');
if (skipped.length) {
  dyn += `\n## Skipped files (fetched with a query string, not real pages)\n\n` + skipped.slice(0, 50).map((s) => `- \`${s}\``).join('\n') +
    (skipped.length > 50 ? `\n- and ${skipped.length - 50} more` : '') + '\n';
}
fs.writeFileSync(path.join(REPORTS, 'dynamic-features.md'), dyn);

console.log(`Copied ${srcFiles.length - skipped.length} files into public/ (${htmlFiles.length} HTML pages, ${pagesChanged} changed).`);
console.log(`Missing assets: ${missingAssets.size}  -> reports/missing-assets.txt`);
console.log(`Broken links:   ${brokenLinks.size}  -> reports/broken-links.md`);
console.log(`Dynamic features found: ${found.map(([, l]) => l).join('; ') || 'none'}  -> reports/dynamic-features.md`);
if (missingAssets.size) console.log('Fetch the missing files with: bash scripts/mirror.sh reports/missing-assets.txt  (then run this again)');
