"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function CenterRealtimeRefresh({ storeId }: { storeId: string }) { const router = useRouter(); useEffect(() => { const channel = getSupabaseBrowserClient().channel(`center-storefront:${storeId}`).on("postgres_changes", { event: "*", schema: "public", table: "products", filter: `store_id=eq.${storeId}` }, () => router.refresh()).subscribe(); return () => { void getSupabaseBrowserClient().removeChannel(channel); }; }, [router, storeId]); return null; }
