/**
 * Emits dist/CNAME at build time.
 *
 * GitHub Pages reads this file to keep a custom domain attached — without it,
 * every deploy resets the domain back to <username>.github.io. Deriving it from
 * `site` means the domain lives in exactly one place (astro.config.mjs) and the
 * two can never drift apart.
 */
export const GET = () => {
  const host = new URL(import.meta.env.SITE).hostname;

  return new Response(`${host}\n`, {
    headers: { "Content-Type": "text/plain" },
  });
};
