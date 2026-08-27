import { DeleteObjectsCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  authenticateOperatorStoreRequest,
  commerceJson,
} from "@/lib/commerce/server";
import type { OperatorStaffAuth } from "@/lib/commerce/server";
import {
  getR2Client,
  getR2Config,
  getR2PublicObjectUrl,
} from "@/lib/storage/r2Client";

const PRODUCT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const UUID_FRAGMENT =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PRODUCT_KEY_PATTERN = new RegExp(
  `^products\/(${UUID_FRAGMENT})\/(images|thumbnails)\/(?:[0-9]{10,17}-)?${UUID_FRAGMENT}\\.(jpg|png|webp)$`,
  "iu",
);
const PRESIGNED_URL_TTL_SECONDS = 5 * 60;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MIME_EXTENSION = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

async function requireProductPermission(
  auth: OperatorStaffAuth & { selectedStoreId: string },
) {
  const { data, error } = await auth.user.rpc("has_store_permission", {
    p_store_id: auth.selectedStoreId,
    p_permission: "manage_products",
  });
  if (error) {
    return commerceJson({ error: "product_storage_permission_unavailable" }, 503);
  }
  if (data !== true) {
    return commerceJson({ error: "product_storage_forbidden" }, 403);
  }
  return null;
}

export async function POST(request: Request) {
  const auth = await authenticateOperatorStoreRequest(request, true);
  if (!auth.ok) return auth.response;
  const permissionResponse = await requireProductPermission(auth);
  if (permissionResponse) return permissionResponse;

  const body = (await request.json().catch(() => null)) as {
    contentType?: unknown;
    productId?: unknown;
    sizeBytes?: unknown;
    variant?: unknown;
  } | null;
  const productId =
    typeof body?.productId === "string" ? body.productId.trim() : "";
  const contentType =
    typeof body?.contentType === "string"
      ? body.contentType.trim().toLowerCase()
      : "";
  const sizeBytes = Number(body?.sizeBytes);
  const variant = body?.variant === "thumbnail" ? "thumbnails" : "images";
  const extension = MIME_EXTENSION.get(contentType);
  if (
    !PRODUCT_ID_PATTERN.test(productId) ||
    !extension ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 1 ||
    sizeBytes > MAX_UPLOAD_BYTES
  ) {
    return commerceJson({ error: "invalid_r2_upload_request" }, 400);
  }

  try {
    const { bucketName } = getR2Config();
    const key = `products/${productId}/${variant}/${crypto.randomUUID()}.${extension}`;
    const cacheControl = "public, max-age=31536000, immutable";
    const uploadUrl = await getSignedUrl(
      getR2Client(),
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        ContentType: contentType,
        CacheControl: cacheControl,
      }),
      { expiresIn: PRESIGNED_URL_TTL_SECONDS },
    );
    return commerceJson({
      uploadUrl,
      publicUrl: getR2PublicObjectUrl(key),
      key,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
      },
      expiresAt: new Date(
        Date.now() + PRESIGNED_URL_TTL_SECONDS * 1000,
      ).toISOString(),
    });
  } catch (error) {
    const configurationError =
      error instanceof Error && error.message.startsWith("r2_configuration_");
    return commerceJson(
      { error: configurationError ? error.message : "r2_presign_failed" },
      503,
    );
  }
}

export async function DELETE(request: Request) {
  const auth = await authenticateOperatorStoreRequest(request, true);
  if (!auth.ok) return auth.response;
  const permissionResponse = await requireProductPermission(auth);
  if (permissionResponse) return permissionResponse;

  const body = (await request.json().catch(() => null)) as {
    keys?: unknown;
  } | null;
  if (!Array.isArray(body?.keys) || body.keys.length < 1 || body.keys.length > 100) {
    return commerceJson({ error: "invalid_r2_delete_request" }, 400);
  }
  const keys = [...new Set(body.keys)].filter(
    (key): key is string =>
      typeof key === "string" && PRODUCT_KEY_PATTERN.test(key),
  );
  if (keys.length !== body.keys.length) {
    return commerceJson({ error: "invalid_r2_delete_request" }, 400);
  }

  const productIds = [
    ...new Set(
      keys.map((key) => PRODUCT_KEY_PATTERN.exec(key)?.[1]).filter(Boolean),
    ),
  ] as string[];
  const { data: persistedProducts, error } = await auth.admin
    .from("products")
    .select("id")
    .in("id", productIds);
  if (error) return commerceJson({ error: "r2_cleanup_scope_unavailable" }, 503);
  if ((persistedProducts?.length ?? 0) > 0) {
    return commerceJson({ error: "r2_cleanup_persisted_product_forbidden" }, 409);
  }

  const publicUrlByKey = new Map(
    keys.map((key) => [key, getR2PublicObjectUrl(key)]),
  );
  const publicUrls = [...publicUrlByKey.values()];
  const [conversationReferences, messageReferences] = await Promise.all([
    auth.admin
      .from("support_conversations")
      .select("product_image_url_snapshot")
      .in("product_image_url_snapshot", publicUrls),
    auth.admin
      .from("support_messages")
      .select("product_image_url_snapshot")
      .in("product_image_url_snapshot", publicUrls),
  ]);
  if (conversationReferences.error || messageReferences.error) {
    return commerceJson({ error: "r2_cleanup_reference_check_failed" }, 503);
  }
  const retainedUrls = new Set([
    ...(conversationReferences.data ?? []).map((row) => row.product_image_url_snapshot),
    ...(messageReferences.data ?? []).map((row) => row.product_image_url_snapshot),
  ].filter((value): value is string => typeof value === "string"));
  const deletableKeys = keys.filter(
    (key) => !retainedUrls.has(publicUrlByKey.get(key) ?? ""),
  );

  try {
    if (deletableKeys.length > 0) {
      await getR2Client().send(
        new DeleteObjectsCommand({
          Bucket: getR2Config().bucketName,
          Delete: { Objects: deletableKeys.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
    return commerceJson({
      deleted: deletableKeys.length,
      retainedReferences: keys.length - deletableKeys.length,
    });
  } catch {
    return commerceJson({ error: "r2_cleanup_failed" }, 503);
  }
}
