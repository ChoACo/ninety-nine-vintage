import { authenticateOwnerAccessRequest, ownerAccessErrorResponse, ownerAccessJsonResponse } from "@/lib/ownerAccess/server";

const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f-]{27}$/i;

export async function GET(request:Request){
  try{
    const access=await authenticateOwnerAccessRequest(request);
    const url=new URL(request.url); const storeId=url.searchParams.get("storeId");
    if(storeId&&!UUID_PATTERN.test(storeId)) return ownerAccessJsonResponse({error:"invalid_store_scope"},400);
    let query=access.admin.from("store_settlement_entries").select("id,store_id,entry_kind,amount,eligible_at,source_kind,source_id,settlement_batch_id,metadata,stores(name),store_settlement_batches(status)").order("eligible_at",{ascending:false}).limit(10000);
    if(storeId) query=query.eq("store_id",storeId);
    const {data,error}=await query;
    if(error){console.error("[owner-settlement-export] query failed",{code:error.code});return ownerAccessJsonResponse({error:"settlement_export_unavailable"},503);}
    const productIds=[...new Set((data??[]).map(row=>String((row.metadata as Record<string,unknown>|null)?.productId??"")).filter(id=>UUID_PATTERN.test(id)))];
    const products=productIds.length?await access.admin.from("products").select("id,title").in("id",productIds):{data:[],error:null};
    if(products.error) return ownerAccessJsonResponse({error:"settlement_export_unavailable"},503);
    const titleById=new Map((products.data??[]).map(product=>[product.id,product.title]));
    const rows=(data??[]).filter(row=>row.entry_kind==="item_sale").map(row=>{
      const metadata=(row.metadata??{}) as Record<string,unknown>; const price=Number(row.amount); const rate=Number(metadata.rate??0.05);
      const commission=Math.ceil(price*rate); const batch=Array.isArray(row.store_settlement_batches)?row.store_settlement_batches[0]:row.store_settlement_batches;
      const store=Array.isArray(row.stores)?row.stores[0]:row.stores;
      return {orderNumber:String(row.source_id??row.id),paidAt:row.eligible_at,storeName:store?.name??"-",productName:titleById.get(String(metadata.productId??""))??String(metadata.title??"상품"),saleAmount:price,platformFee:commission,pgFee:0,netPayout:price-commission,paymentMethod:String(metadata.paymentMethod??"계좌이체"),status:batch?.status==="paid"?"정산 완료":"정산 대기"};
    });
    return ownerAccessJsonResponse({rows});
  }catch(error){return ownerAccessErrorResponse(error);}
}
