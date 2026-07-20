/**
 * Temporary recovery switches for the fixed-price purchase happy path.
 * Keep the underlying entry and live-auction implementation intact so each
 * feature can be re-enabled after the main commerce flow is stable.
 */
export const ENTRY_GATE_ENABLED = false;
export const LIVE_AUCTION_ENABLED = false;
