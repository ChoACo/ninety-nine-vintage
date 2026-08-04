import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
});

if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_SUPABASE_URL) {
  envSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

/**
 * Runtime feature switches. The live auction is enabled across the storefront,
 * API, and database RPC boundary. The former entry gate was removed entirely.
 */
export const LIVE_AUCTION_ENABLED = true;

/**
 * The dedicated mobile site is available immediately at /m. Automatic device
 * redirects remain independently switchable so the new surface can be checked
 * safely before traffic is moved to it.
 */
export const MOBILE_SITE_ENABLED =
  process.env.MOBILE_SITE_ENABLED?.trim().toLowerCase() !== "false";
export const MOBILE_AUTO_REDIRECT_ENABLED =
  process.env.MOBILE_AUTO_REDIRECT_ENABLED?.trim().toLowerCase() !== "false";
