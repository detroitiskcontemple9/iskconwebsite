/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: `next build` writes plain files to out/ for Cloudflare Pages.
  output: 'export',
  // WordPress URLs end in a slash (/about-us/). Keep them identical.
  trailingSlash: true,
  images: { unoptimized: true },
};
export default nextConfig;
