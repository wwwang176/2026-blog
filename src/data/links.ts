/**
 * Contact channels, rendered as the list in the Contact section.
 *
 * TODO — the GitHub and CodePen URLs below are placeholders. Replace
 * `your-username` with the real handles (or delete an entry entirely if you
 * don't want it listed). The email is already correct.
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
    value: "github.com/your-username",
    href: "https://github.com/your-username",
  },
  {
    label: "CodePen",
    value: "codepen.io/your-username",
    href: "https://codepen.io/your-username",
  },
];
