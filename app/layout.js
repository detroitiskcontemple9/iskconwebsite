// Step 1: the site is served as-is from public/ (the cleaned WordPress copy).
// Pages move into app/ one by one in Step 2. Until then this layout is unused.
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
