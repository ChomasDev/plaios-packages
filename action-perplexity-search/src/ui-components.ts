import type { UIComponentSpec } from "@plaios/core/domain";

/** Shared by the capability (prompt) and the web module (renderer), so both agree on the name and props. */
export const WEB_SOURCES: UIComponentSpec = {
  name: "WebSources",
  description: "The sources of one web search as a row of cards (site, title, date, snippet), each opening the page. Use it right after search_web whenever the answer relies on those results: WebSources(\"<id returned by search_web>\"). Keep your text to the answer itself; the cards carry the links. Never invent an id.",
  props: [{ name: "searchId", type: "string", description: "The `id` field search_web returned." }],
};
