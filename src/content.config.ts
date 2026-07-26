import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const link = z
  .object({
    url: z.string().default(""),
    label: z.string().default(""),
    status: z.enum(["live", "demo", "deprecated", "none"]).default("none"),
  })
  .default({});

const works = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/works" }),
  schema: z.object({
    title: z.string(),
    category: z.enum(["website", "web-game", "brochure-video", "arduino"]),
    /** Free text — "2018", "2009 — 2011", or empty. */
    year: z.string().default(""),
    /** The lead paragraph on the detail page, and the card blurb in listings. */
    overview: z.string(),
    role: z.string(),
    coworkers: z.array(z.string()).default([]),
    link,
    cover: z.string().optional(),
    /** Surfaces on the landing page. */
    featured: z.boolean().default(false),
    /** Lower sorts first. */
    order: z.number().default(99),
  }),
});

const journal = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/journal" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { works, journal };
