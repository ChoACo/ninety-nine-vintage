export type CartDeliveryMode = "ship" | "vault";

export interface CartPricingItem {
  id: string;
  price: number;
}

export interface CartPricingCharge {
  amount: number;
  productIds: readonly string[];
  vaultAmount?: number;
}

export function deriveCartPricing<
  TItem extends CartPricingItem,
  TCharge extends CartPricingCharge,
>(
  items: readonly TItem[],
  charges: readonly TCharge[],
  deliveryMode: CartDeliveryMode,
) {
  const activeProductIds = new Set(items.map((item) => item.id));
  const activeCharges = charges.filter((charge) =>
    charge.productIds.some((productId) => activeProductIds.has(productId)),
  );
  const productTotal = items.reduce((total, item) => total + item.price, 0);
  const shippingFee =
    items.length === 0
      ? 0
      : activeCharges.reduce(
          (total, charge) =>
            total +
            (deliveryMode === "ship"
              ? charge.amount
              : (charge.vaultAmount ?? charge.amount)),
          0,
        );

  return {
    activeCharges,
    activeProductIds,
    finalAmount: items.length === 0 ? 0 : productTotal + shippingFee,
    productTotal,
    shippingFee,
  };
}
