import "server-only";

import { INDEXNOW_KEY, INDEXNOW_KEY_PATH } from "@/lib/seo/indexNow";
import { PUBLIC_SITE_ORIGIN } from "@/lib/seo/productSeo";

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const SITE_HOST = new URL(PUBLIC_SITE_ORIGIN).host;

function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value, PUBLIC_SITE_ORIGIN);
    if (url.host !== SITE_HOST || url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export async function notifyIndexNow(urls: readonly string[]): Promise<boolean> {
  const urlList = [...new Set(urls.flatMap((value) => {
    const url = canonicalUrl(value);
    return url ? [url] : [];
  }))].slice(0, 100);
  if (urlList.length === 0) return true;
  try {
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: SITE_HOST,
        key: INDEXNOW_KEY,
        keyLocation: `${PUBLIC_SITE_ORIGIN}${INDEXNOW_KEY_PATH}`,
        urlList,
      }),
      cache: "no-store",
    });
    if (response.ok || response.status === 202) return true;
    console.error("indexnow_notification_failed", response.status);
  } catch (error) {
    console.error("indexnow_notification_failed", error instanceof Error ? error.message : "unknown");
  }
  return false;
}

export function productPublicUrl(productId: string, saleType: string): string {
  return `${PUBLIC_SITE_ORIGIN}/${saleType === "fixed" ? "shop" : "auction"}/${productId}`;
}
