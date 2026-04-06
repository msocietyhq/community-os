export const DEFAULT_TITLE = "MSOCIETY";
export const DEFAULT_DESCRIPTION = "MSOCIETY Community Portal";
export const DEFAULT_OG_IMAGE = "https://msociety.dev/og-default.png";
export const DEFAULT_URL = "https://msociety.dev";

export function setMetaTag(
  key: string,
  content: string,
  attr: "name" | "property" = "name",
) {
  let el = document.head.querySelector<HTMLMetaElement>(
    `meta[${attr}="${key}"]`,
  );
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

export function resetMetaToDefaults() {
  document.title = DEFAULT_TITLE;
  setMetaTag("description", DEFAULT_DESCRIPTION);
  setMetaTag("og:title", DEFAULT_TITLE, "property");
  setMetaTag("og:description", DEFAULT_DESCRIPTION, "property");
  setMetaTag("og:image", DEFAULT_OG_IMAGE, "property");
  setMetaTag("og:url", DEFAULT_URL, "property");
  setMetaTag("og:type", "website", "property");
  setMetaTag("twitter:title", DEFAULT_TITLE);
  setMetaTag("twitter:description", DEFAULT_DESCRIPTION);
  setMetaTag("twitter:image", DEFAULT_OG_IMAGE);
}
