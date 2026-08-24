export const GUIDE_IMAGE_DIMENSIONS: Readonly<
  Record<string, { width: number; height: number }>
> = {
  "/guides/buyer/archive-cart/01-select-product.png": { width: 381, height: 824 },
  "/guides/buyer/archive-cart/02-add-to-cart.png": { width: 381, height: 824 },
  "/guides/buyer/archive-cart/03-choose-immediate-shipping.png": { width: 381, height: 824 },
  "/guides/buyer/archive-cart/04-review-and-pay.png": { width: 381, height: 824 },
  "/guides/buyer/archive-cart/05-bank-transfer-order.png": { width: 381, height: 824 },
  "/guides/buyer/archive-cart/06-order-paid-shipping.png": { width: 390, height: 843 },
  "/guides/buyer/live-auction/01-open-live-auction.png": { width: 381, height: 824 },
  "/guides/buyer/live-auction/02-select-auction-product.png": { width: 381, height: 824 },
  "/guides/buyer/live-auction/03-set-bid-amount.png": { width: 390, height: 843 },
  "/guides/buyer/live-auction/04-confirm-final-bid.png": { width: 390, height: 843 },
  "/guides/buyer/live-auction/05-bid-success.png": { width: 381, height: 824 },
  "/guides/buyer/live-auction/06-review-winning-item.png": { width: 390, height: 843 },
  "/guides/buyer/live-auction/07-enter-depositor.png": { width: 390, height: 843 },
  "/guides/buyer/live-auction/08-bank-transfer-info.png": { width: 390, height: 843 },
  "/guides/buyer/live-auction/09-vault-storage-period.png": { width: 381, height: 824 },
  "/guides/buyer/live-auction/10-request-shipping.png": { width: 381, height: 824 },
  "/guides/buyer/live-auction/11-shipping-request-success.png": { width: 381, height: 824 },
  "/guides/operator/product-registration-mobile/01-home-open-menu.png": { width: 390, height: 844 },
  "/guides/operator/product-registration-mobile/02-select-work.png": { width: 390, height: 844 },
  "/guides/operator/product-registration-mobile/03-open-operator-menu.png": { width: 390, height: 844 },
  "/guides/operator/product-registration-mobile/04-new-product-menu.png": { width: 390, height: 844 },
  "/guides/operator/product-registration-mobile/05-select-instant-purchase.png": { width: 390, height: 844 },
  "/guides/operator/product-registration-mobile/06-upload-product-photo.png": { width: 390, height: 843 },
  "/guides/operator/product-registration-mobile/07-product-info-measurements.png": { width: 381, height: 824 },
  "/guides/operator/product-registration-mobile/08-price-storage-defects.png": { width: 381, height: 824 },
  "/guides/operator/product-registration-mobile/09-publish-and-submit.png": { width: 381, height: 824 },
  "/guides/operator/product-registration-mobile/10-registration-complete.png": { width: 390, height: 843 },
  "/guides/operator/product-registration-pc/02-new-product-menu.png": { width: 1440, height: 900 },
  "/guides/operator/product-registration-pc/03-select-instant-purchase.png": { width: 1440, height: 900 },
  "/guides/operator/product-registration-pc/04-upload-product-photo.png": { width: 1440, height: 900 },
  "/guides/operator/product-registration-pc/06-price-storage-defects.png": { width: 1440, height: 900 },
  "/guides/operator/product-registration-pc/08-registration-complete.png": { width: 1440, height: 900 },
};

export function getGuideImageDimensions(path: string) {
  return GUIDE_IMAGE_DIMENSIONS[path] ?? { width: 1440, height: 900 };
}
