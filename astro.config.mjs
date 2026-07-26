import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

// TODO: replace with the real custom domain once it's registered.
// This only affects canonical URLs, Open Graph tags, sitemap.xml and the RSS
// feed — nothing in development depends on it.
const SITE = "https://chengweiwang.com";

export default defineConfig({
  site: SITE,
  base: "/",
  trailingSlash: "always",
  integrations: [mdx(), sitemap()],
  build: {
    format: "directory",
  },
});
