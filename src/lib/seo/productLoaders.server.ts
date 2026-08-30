import "server-only";

import { cache } from "react";
import { fetchPublishedProduct } from "@/services/products";
import { fetchSoldProduct } from "@/services/sold";

export const loadPublishedProductForSeo = cache(fetchPublishedProduct);
export const loadSoldProductForSeo = cache(fetchSoldProduct);
