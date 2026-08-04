import { commerceJson } from "@/lib/commerce/server";
import { createSupabaseServerClients } from "@/lib/supabase/server";

type RpcClient={rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:{message?:string}|null}>};

export async function POST(request:Request){
  const expected=process.env.CRON_SECRET?.trim();
  const supplied=request.headers.get('x-cron-secret')?.trim();
  if(!expected||!supplied||expected.length!==supplied.length||expected!==supplied)return commerceJson({error:'forbidden'},403);
  const {admin}=createSupabaseServerClients();
  const {data,error}=await (admin as unknown as RpcClient).rpc('accrue_store_subscription_fees',{p_as_of:new Date().toISOString()});
  if(error)return commerceJson({error:error.message??'subscription_accrual_failed'},503);
  return commerceJson({result:data});
}
