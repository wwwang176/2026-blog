import rss from "@astrojs/rss";
import { getCollection } from "astro:content";

export async function GET(context) {
  const posts = (await getCollection("journal", ({ data }) => !data.draft)).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf()
  );

  return rss({
    title: "Journal — Cheng Wei, Wang",
    description:
      "Notes on front-end, back-end and web game development by Cheng Wei, Wang.",
    site: context.site,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date,
      categories: post.data.tags,
      link: `/journal/${post.id}/`,
    })),
    customData: "<language>en</language>",
  });
}
