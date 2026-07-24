import "server-only";

import webPush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClients } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

interface ClaimedPushNotification {
  attempts: number;
  body: string;
  expires_at: string;
  id: string;
  recipient_user_id: string;
  title: string;
  topic: string;
  url: string;
}

async function getWebPushConfiguration(admin: SupabaseClient<Database>) {
  const { data, error } = await admin.rpc("get_web_push_delivery_config");
  if (error) throw error;
  const config = data as {
    privateKey?: unknown;
    publicKey?: unknown;
    subject?: unknown;
  } | null;
  const publicKey =
    typeof config?.publicKey === "string" ? config.publicKey.trim() : "";
  const privateKey =
    typeof config?.privateKey === "string" ? config.privateKey.trim() : "";
  const subject = typeof config?.subject === "string" ? config.subject.trim() : "";
  if (!publicKey || !privateKey || !subject) {
    throw new Error("web_push_not_configured");
  }
  return { publicKey, privateKey, subject };
}

function retryAt(attempts: number) {
  const delayMinutes = Math.min(360, Math.max(5, 5 * 2 ** Math.min(attempts, 6)));
  return new Date(Date.now() + delayMinutes * 60_000).toISOString();
}

function compactError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 1800);
  return "web_push_delivery_failed";
}

export async function dispatchPendingWebPushNotifications(limit = 50) {
  const { admin } = createSupabaseServerClients();
  const config = await getWebPushConfiguration(admin);
  const { data, error } = await admin.rpc("claim_web_push_notifications", {
    p_limit: limit,
  });
  if (error) throw error;
  const claimed = (data ?? []) as ClaimedPushNotification[];
  if (claimed.length === 0) return { claimed: 0, delivered: 0, deferred: 0 };

  const recipients = [
    ...new Set(claimed.map((notification) => notification.recipient_user_id)),
  ];
  const { data: subscriptions, error: subscriptionError } = await admin
    .from("web_push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth_secret")
    .in("user_id", recipients)
    .is("disabled_at", null);
  if (subscriptionError) throw subscriptionError;

  const subscriptionsByUser = new Map<
    string,
    NonNullable<typeof subscriptions>
  >();
  for (const subscription of subscriptions ?? []) {
    const list = subscriptionsByUser.get(subscription.user_id) ?? [];
    list.push(subscription);
    subscriptionsByUser.set(subscription.user_id, list);
  }

  let delivered = 0;
  let deferred = 0;
  for (const notification of claimed) {
    const targets = subscriptionsByUser.get(notification.recipient_user_id) ?? [];
    if (targets.length === 0) {
      deferred += 1;
      await admin
        .from("web_push_notification_outbox")
        .update({
          locked_at: null,
          last_error: "no_active_subscription",
          next_attempt_at: new Date(Date.now() + 6 * 60 * 60_000).toISOString(),
        })
        .eq("id", notification.id);
      continue;
    }

    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      tag: notification.topic,
      url: notification.url,
    });
    const results = await Promise.all(
      targets.map(async (subscription) => {
        try {
          await webPush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth_secret,
              },
            },
            payload,
            {
              TTL: Math.max(
                0,
                Math.floor(
                  (new Date(notification.expires_at).getTime() - Date.now()) / 1000,
                ),
              ),
              urgency: "normal",
              vapidDetails: {
                subject: config.subject,
                publicKey: config.publicKey,
                privateKey: config.privateKey,
              },
            },
          );
          await admin
            .from("web_push_subscriptions")
            .update({
              failure_count: 0,
              last_success_at: new Date().toISOString(),
            })
            .eq("id", subscription.id);
          return { ok: true as const };
        } catch (error) {
          const statusCode =
            typeof error === "object" &&
            error !== null &&
            "statusCode" in error &&
            typeof error.statusCode === "number"
              ? error.statusCode
              : null;
          const permanent = statusCode === 404 || statusCode === 410;
          await admin
            .from("web_push_subscriptions")
            .update(
              permanent
                ? { disabled_at: new Date().toISOString() }
                : { failure_count: Math.min(notification.attempts, 1000) },
            )
            .eq("id", subscription.id);
          return { ok: false as const, permanent, error };
        }
      }),
    );

    if (results.some((result) => result.ok)) {
      delivered += 1;
      await admin
        .from("web_push_notification_outbox")
        .update({
          delivered_at: new Date().toISOString(),
          last_error: null,
          locked_at: null,
        })
        .eq("id", notification.id);
    } else {
      deferred += 1;
      const firstFailure = results.find((result) => !result.ok);
      await admin
        .from("web_push_notification_outbox")
        .update({
          locked_at: null,
          last_error:
            firstFailure && !firstFailure.ok
              ? compactError(firstFailure.error)
              : "web_push_delivery_failed",
          next_attempt_at: retryAt(notification.attempts),
        })
        .eq("id", notification.id);
    }
  }

  return { claimed: claimed.length, delivered, deferred };
}

export async function readWebPushPublicKey(admin: SupabaseClient<Database>) {
  const { data, error } = await admin.rpc("get_web_push_public_key");
  if (error || typeof data !== "string" || !data.trim()) {
    throw error ?? new Error("web_push_not_configured");
  }
  return data.trim();
}
