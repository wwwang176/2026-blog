/**
 * Blocks available inside .mdx content.
 *
 * These are passed wholesale to <Content components={...} />, so markdown files
 * can use <Stats />, <Steps /> and friends without importing anything.
 */
export { default as Prose } from "./Prose.astro";
export { default as Compare } from "./Compare.astro";
export { default as Features } from "./Features.astro";
export { default as Stats } from "./Stats.astro";
export { default as Steps } from "./Steps.astro";
export { default as Figure } from "./Figure.astro";
export { default as Gallery } from "./Gallery.astro";
export { default as Callout } from "./Callout.astro";
