export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return Response.json({ transfer: { orderId: id, status: "awaiting_manual_transfer", bankName: "국민은행", accountNumber: "000000-00-000000", expectedAmount: 0 } }, { status: 201 });
}

