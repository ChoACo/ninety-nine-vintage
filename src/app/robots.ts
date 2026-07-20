import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin/", "/api/"] },
    sitemap: "https://www.ninety-nine-vintage.store/sitemap.xml",
    host: "https://www.ninety-nine-vintage.store",
  };
}
