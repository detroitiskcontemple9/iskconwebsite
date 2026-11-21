#!/usr/bin/env bash
# Copy the live WordPress site from the outside. No plugin, nothing changes on the server.
#
# Run this on a computer that can open https://iskcondetroit.com in a normal browser
# (a home or temple connection). Cloud servers get blocked by the site's Cloudflare
# bot check.
#
# Needs: bash, wget, curl.  macOS: `brew install wget`.
#
# Usage:
#   bash scripts/mirror.sh                        # full copy into mirror/
#   bash scripts/mirror.sh missing-assets.txt     # fetch extra files listed by clean-mirror
#
# Result:
#   mirror/iskcondetroit.com/...   the raw copy, same URL paths as the live site
#   mirror/urls.txt                every page URL from the WordPress sitemap
#   mirror/wp-json/                page and post content as JSON (for Step 2)
#   mirror/mirror.log              wget log (check it for errors)

set -euo pipefail

SITE="https://iskcondetroit.com"
HOST="iskcondetroit.com"
OUT="mirror"
UA="Mozilla/5.0 (compatible; ISKCON-Detroit-site-backup/1.0)"
WAIT="0.5"   # seconds between requests, so the shared Bluehost server stays fast

mkdir -p "$OUT"

# Shared wget options.
#  - no --convert-links / --adjust-extension: files keep their real URL paths,
#    so /about-us/ is saved as about-us/index.html and links stay as they are.
#  - reject URLs that are WordPress server endpoints, not pages.
WGET_OPTS=(
  --page-requisites
  --no-parent
  --timestamping
  --restrict-file-names=unix
  -e robots=off
  --user-agent "$UA"
  --wait "$WAIT" --random-wait
  --tries 3 --timeout 30
  --directory-prefix "$OUT"
  --reject-regex '(/wp-admin/|/wp-login\.php|/xmlrpc\.php|/wp-json/|/feed/?$|/comments/feed|[?&]replytocom=|/trackback/?$|[?&]share=)'
  --append-output "$OUT/mirror.log"
)

if [[ $# -ge 1 ]]; then
  echo "Fetching extra files listed in $1 ..."
  wget "${WGET_OPTS[@]}" --input-file "$1" || true
  echo "Done. Run: npm run clean-mirror"
  exit 0
fi

echo "1/4  Checking the site can be reached ..."
code=$(curl -s -o /dev/null -w '%{http_code}' -A "$UA" "$SITE/wp-sitemap.xml")
if [[ "$code" != "200" ]]; then
  echo "The site answered HTTP $code for $SITE/wp-sitemap.xml."
  echo "403 usually means the Cloudflare bot check blocked this computer."
  echo "Try another network, or see README.md, 'If the copy is blocked'."
  exit 1
fi

echo "2/4  Reading the WordPress sitemap ..."
: > "$OUT/urls.txt"
curl -s -A "$UA" "$SITE/wp-sitemap.xml" > "$OUT/wp-sitemap.xml"
# The index lists sub-sitemaps (pages, posts, categories, tags, users).
grep -o '<loc>[^<]*</loc>' "$OUT/wp-sitemap.xml" | sed -e 's/<loc>//' -e 's/<\/loc>//' | while read -r sub; do
  curl -s -A "$UA" "$sub" | grep -o '<loc>[^<]*</loc>' | sed -e 's/<loc>//' -e 's/<\/loc>//' >> "$OUT/urls.txt"
  sleep "$WAIT"
done
# Pages the sitemap may leave out.
{
  echo "$SITE/"
  echo "$SITE/robots.txt"
  echo "$SITE/favicon.ico"
} >> "$OUT/urls.txt"
sort -u -o "$OUT/urls.txt" "$OUT/urls.txt"
echo "     $(wc -l < "$OUT/urls.txt") URLs found."

echo "3/4  Copying every page with its images, CSS, JS and fonts (this can take a while) ..."
# Pass 1: every sitemap URL plus its page requisites.
wget "${WGET_OPTS[@]}" --input-file "$OUT/urls.txt" || true
# Pass 2: follow links from the home page too, to catch pages missing from the sitemap.
wget "${WGET_OPTS[@]}" --recursive --level inf --domains "$HOST" "$SITE/" || true
# The WordPress "page not found" page, saved as 404.html.
curl -s -A "$UA" "$SITE/this-page-does-not-exist-$(date +%s)/" > "$OUT/$HOST/404.html" || true

echo "4/4  Saving page and post content from the WordPress REST API (for Step 2) ..."
mkdir -p "$OUT/wp-json"
for type in pages posts media categories tags; do
  page=1
  while :; do
    f="$OUT/wp-json/$type-$page.json"
    code=$(curl -s -A "$UA" -o "$f" -w '%{http_code}' "$SITE/wp-json/wp/v2/$type?per_page=100&page=$page")
    if [[ "$code" != "200" ]] || [[ "$(head -c 2 "$f")" == "[]" ]]; then rm -f "$f"; break; fi
    page=$((page + 1))
    sleep "$WAIT"
  done
done

echo
echo "Done. Raw copy: $OUT/$HOST   Log: $OUT/mirror.log"
echo "Errors in the log: $(grep -cE 'ERROR [0-9]+' "$OUT/mirror.log" || true)"
echo "Next: npm run clean-mirror"
