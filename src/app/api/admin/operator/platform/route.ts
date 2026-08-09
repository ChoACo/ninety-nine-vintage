import { authenticateOperatorStoreRequest, commerceJson } from "@/lib/commerce/server";
import { encryptAccountNumber, maskAccountNumber, normalizeAccountNumber } from "@/lib/settlement/payoutAccount.server";

type RpcClient = { rpc: (name: string,args?: Record<string,unknown>) => Promise<{data:unknown;error:{code?:string;message?:string}|null}> };

export async function GET(request: Request) {
  const auth=await authenticateOperatorStoreRequest(request);
  if (!auth.ok) return auth.response;
  if (!['owner','operator'].includes(auth.roleCode)) return commerceJson({error:'forbidden'},403);
  const {data,error}=await (auth.user as unknown as RpcClient).rpc('get_operator_store_platform_management');
  if (error) return commerceJson({error:error.message??'platform_unavailable'},503);
  return commerceJson({management:data});
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
