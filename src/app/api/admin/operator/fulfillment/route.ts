import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS=new Set(["release_store_items","release_paid_items","center_receive","center_store"]);
type RpcClient={rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:{code?:string;message?:string}|null}>};
function record(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==="object"&&!Array.isArray(value);}
function ids(value:unknown):value is string[]{return Array.isArray(value)&&value.length>=1&&value.length<=100&&value.every((item)=>typeof item==="string"&&UUID.test(item))&&new Set(value).size===value.length;}
function versions(value:unknown,count:number):value is number[]{return Array.isArray(value)&&value.length===count&&value.every((item)=>Number.isSafeInteger(item)&&Number(item)>=0);}
function failure(error:{code?:string;message?:string}){if(error.code==="42501")return commerceJson({error:"fulfillment_forbidden",message:error.message??"처리 권한이 없습니다."},403);if(error.code==="P0002")return commerceJson({error:"fulfillment_not_found",message:error.message},404);if(["PT409", "23505", "40001"].includes(error.code??""))return commerceJson({error:"fulfillment_conflict",message:error.message},409);if(error.code === "55000")return commerceJson({error:"invalid_fulfillment_state",message:error.message},422);if(["22000", "22023", "23514"].includes(error.code??""))return commerceJson({error:"invalid_fulfillment_request",message:error.message},422);return commerceJson({error:"operator_fulfillment_unavailable",message:error.message},503);}

export async function GET(request:Request){
  const auth=await authenticateStaffRequest(request);if(!auth.ok)return auth.response;
  const url=new URL(request.url);const limit=Math.min(500,Math.max(1,Number(url.searchParams.get("limit")||300)));const offset=Math.max(0,Number(url.searchParams.get("offset")||0));
  const {data,error}=await (auth.user as unknown as RpcClient).rpc("get_central_fulfillment_buyer_groups",{p_limit:limit,p_offset:offset});
  if(error)return failure(error);if(!record(data)||!Array.isArray(data.groups))return commerceJson({error:"operator_fulfillment_unavailable"},503);
  return commerceJson({groups:data.groups});
}

export async function POST(request:Request){
  const auth=await authenticateStaffRequest(request,true);if(!auth.ok)return auth.response;
  const body=await request.json().catch(()=>null);if(!record(body)||typeof body.action!=="string"||!ACTIONS.has(body.action)||!ids(body.inventoryItemIds)||!UUID.test(String(body.idempotencyKey??"")))return commerceJson({error:"invalid_fulfillment_request"},422);
  if(!versions(body.expectedVersions,body.inventoryItemIds.length))return commerceJson({error:"invalid_versions"},422);
  const ordered=body.inventoryItemIds.map((id,index)=>({id,version:(body.expectedVersions as number[])[index]})).sort((a,b)=>a.id.localeCompare(b.id));
  const rpc=auth.user as unknown as RpcClient;let result;
  if(body.action==="release_store_items"){
    if(typeof body.workId!=="string"||!UUID.test(body.workId)||!Number.isSafeInteger(body.expectedWorkVersion))return commerceJson({error:"invalid_work"},422);
    result=await rpc.rpc("release_buyer_inventory_shipment_items",{p_work_id:body.workId,p_inventory_item_ids:ordered.map((item)=>item.id),p_expected_work_version:body.expectedWorkVersion,p_idempotency_key:body.idempotencyKey,p_note:typeof body.note==="string"?body.note:null});
  }else if(body.action==="release_paid_items"){
    result=await rpc.rpc("release_buyer_paid_inventory_items",{p_inventory_item_ids:ordered.map((item)=>item.id),p_expected_versions:ordered.map((item)=>item.version),p_idempotency_key:body.idempotencyKey,p_note:typeof body.note==="string"?body.note:null});
  }else{
    const location=typeof body.storageLocationCode==="string"?body.storageLocationCode.trim():"";if(body.action==="center_store"&&!location)return commerceJson({error:"storage_location_required"},422);
    result=await rpc.rpc("record_buyer_inventory_center_items",{p_action:body.action==="center_receive"?"receive":"store",p_inventory_item_ids:ordered.map((item)=>item.id),p_expected_versions:ordered.map((item)=>item.version),p_storage_location_code:location||null,p_idempotency_key:body.idempotencyKey,p_note:typeof body.note==="string"?body.note:null});
  }
  if(result.error)return failure(result.error);return commerceJson({result:result.data});
}
