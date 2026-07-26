/**
 * Contact channels, rendered as the list in the Contact section.
 *
 * Add, remove or reorder freely — the layout adapts. `value` is what the
 * visitor reads, `href` is where it goes; anything starting with http opens
 * in a new tab.
 */
export interface ContactLink {
  /** Short label in the left column. */
  label: string;
  /** What the visitor reads — usually the handle or address itself. */
  value: string;
  href: string;
}

export const CONTACT_LINKS: ContactLink[] = [
  {
    label: "Email",
    value: "weiweiwang.0617@gmail.com",
    href: "mailto:weiweiwang.0617@gmail.com",
  },
  {
    label: "GitHub",
    value: "github.com/wwwang176",
    href: "https://github.com/wwwang176",
  },
  {
    // Links straight to the public pens rather than the profile landing page.
    label: "CodePen",
    value: "codepen.io/wwwang176",
    href: "https://codepen.io/wwwang176/pens/public",
  },
];
