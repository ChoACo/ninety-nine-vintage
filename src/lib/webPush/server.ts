import "server-only";

import webPush from "web-push";
import { createSupabaseServerClients } from "@/lib/supabase/server";

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

function getWebPushConfiguration() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject =
    process.env.WEB_PUSH_VAPID_SUBJECT?.trim() ||
    "mailto:privacy@ninety-nine-vintage.store";
  if (!publicKey || !privateKey) {
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
  const config = getWebPushConfiguration();
  const { admin } = createSupabaseServerClients();
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

export function readWebPushPublicKey() {
  return getWebPushConfiguration().publicKey;
}
