import type { MetadataRoute } from "next";

// The landing page is public; the signed-in workspace and APIs are not for search engines.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/app", "/api"] }] };
}
