export async function POST() {
  return Response.json({ payment: { id: `demo-shipping-fee-${Date.now()}`, status: "awaiting_transfer", expectedAmount: 3500, creditsOnSettlement: 1 } }, { status: 201 });
}
