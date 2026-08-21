import { CartView } from "@/components/features/commerce/CartView";
import { StandaloneBackModal } from "@/components/layout/StandaloneBackModal";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function CartPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string | string[] }>;
}) {
  const value = (await searchParams).productId;
  const productId =
    typeof value === "string" && UUID_PATTERN.test(value) ? value : undefined;

  return (
    <>
      <StandaloneBackModal />
      <CartView selectedProductId={productId} surface="desktop" />
    </>
  );
}

