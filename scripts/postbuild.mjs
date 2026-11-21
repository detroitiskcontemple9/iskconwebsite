// After `next build`: Next.js writes its own default 404 page into out/.
// While the site is the WordPress copy, put the WordPress "page not found" page back.
// Cloudflare Pages serves out/404.html for any URL that doesn't exist.
import fs from 'node:fs';

if (fs.existsSync('public/404.html')) {
  fs.copyFileSync('public/404.html', 'out/404.html');
  fs.rmSync('out/404', { recursive: true, force: true });
  console.log('postbuild: out/404.html is the WordPress 404 page.');
}
