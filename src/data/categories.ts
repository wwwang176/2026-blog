/**
 * Work categories.
 *
 * `stage` picks which particle shape the field holds on that category's pages
 * (0 sphere · 1 nebula · 2 grid · 3 wave plane), so each category reads as a
 * visually distinct place without needing a separate scene.
 */
export const CATEGORIES = {
  website: { label: "Website", stage: 2 },
  "web-game": { label: "Web game", stage: 1 },
  "brochure-video": { label: "Brochure / Video", stage: 3 },
  arduino: { label: "Arduino", stage: 0 },
} as const;

export type CategoryKey = keyof typeof CATEGORIES;

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as CategoryKey[];

export const categoryLabel = (key: CategoryKey) => CATEGORIES[key].label;
export const categoryStage = (key: CategoryKey) => CATEGORIES[key].stage;
