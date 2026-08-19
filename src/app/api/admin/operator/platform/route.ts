import { authenticateOperatorStoreRequest, commerceJson } from "@/lib/commerce/server";
import { encryptAccountNumber, maskAccountNumber, normalizeAccountNumber } from "@/lib/settlement/payoutAccount.server";

type RpcClient = { rpc: (name: string,args?: Record<string,unknown>) => Promise<{data:unknown;error:{code?:string;message?:string}|null}> };

export async function GET(request: Request) {
  const auth=await authenticateOperatorStoreRequest(request);
  if (!auth.ok) return auth.response;
  if (!['owner','operator'].includes(auth.roleCode)) return commerceJson({error:'forbidden'},403);
  const {data,error}=await (auth.user as unknown as RpcClient).rpc('get_operator_store_platform_management');
  if (error) return commerceJson({error:error.message??'platform_unavailable'},503);
  const management = data && typeof data === "object" ? data as { stores?: Array<Record<string, unknown>> } : {};
  const storeIds = (management.stores ?? []).map((store) => String(store.id));
const { data: fees, error: feeError } = storeIds.length
    ? await auth.admin.from("stores").select("id,regular_shipping_fee,remote_area_shipping_fee,mall_info,mall_image").in("id", storeIds)
    : { data: [], error: null };
  if (feeError) return commerceJson({ error: "shipping_settings_unavailable" }, 503);
  const feeByStore = new Map((fees ?? []).map((fee) => [fee.id, fee]));
  return commerceJson({management:{...management,stores:(management.stores ?? []).map((store) => ({
    ...store,
    regularShippingFee: feeByStore.get(String(store.id))?.regular_shipping_fee ?? null,
    remoteAreaShippingFee: feeByStore.get(String(store.id))?.remote_area_shipping_fee ?? null,
    mallInfo: feeByStore.get(String(store.id))?.mall_info ?? null,
    mallImage: feeByStore.get(String(store.id))?.mall_image ?? null,
  }))}});
}

export async function POST(request: Request) {
  const auth=await authenticateOperatorStoreRequest(request,true);
  if (!auth.ok) return auth.response;
  if (!['owner','operator'].includes(auth.roleCode)) return commerceJson({error:'forbidden'},403);
  const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
  if (!body || typeof body.action!=='string' || typeof body.storeId!=='string') return commerceJson({error:'invalid_request'},422);
  const rpc=auth.user as unknown as RpcClient;
  let result;
  if (body.action==='request_plan') {
    result=await rpc.rpc('request_store_service_plan',{p_store_id:body.storeId,p_plan_code:body.planCode});
} else if (body.action==='save_shipping_fees') {
    result=await rpc.rpc('configure_store_shipping_fees',{
      p_store_id:body.storeId,
      p_regular_shipping_fee:body.regularShippingFee,
      p_remote_area_shipping_fee:body.remoteAreaShippingFee,
    });
  } else if (body.action==='save_mall') {
    result=await rpc.rpc('configure_store_mall',{
      p_store_id:body.storeId,
      p_mall_info:body.mallInfo ? String(body.mallInfo) : null,
      p_mall_image:body.mallImage ? String(body.mallImage) : null,
    });
  } else if (body.action==='submit_payout_account') {
    try {
      const account=normalizeAccountNumber(String(body.accountNumber??''));
      result=await rpc.rpc('submit_store_payout_account',{
        p_store_id:body.storeId,p_bank_name:body.bankName,p_account_holder:body.accountHolder,
        p_account_number_ciphertext:encryptAccountNumber(account),p_account_number_masked:maskAccountNumber(account),
      });
    } catch {
      return commerceJson({error:'정산계좌 입력 또는 암호화 설정을 확인해 주세요.'},422);
    }
  } else return commerceJson({error:'invalid_action'},422);
  if (result.error) return commerceJson({error:result.error.message??'platform_update_failed'},result.error.code==='42501'?403:422);
  return commerceJson({result:result.data});
}
