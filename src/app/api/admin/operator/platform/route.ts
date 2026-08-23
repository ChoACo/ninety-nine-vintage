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
  const [storeResult, subscriptionResult, profileResult] = storeIds.length
    ? await Promise.all([
      auth.admin.from("stores").select("id,name,description,regular_shipping_fee,remote_area_shipping_fee,mall_info,mall_image,logo_url,banner_url,concept_tags,default_courier,announcement_text,announcement_enabled,updated_at").in("id", storeIds),
      auth.admin.from("store_service_subscriptions").select("store_id,unpaid_fee_balance,fee_rollover_count,overdue_notice_sent_at").in("store_id", storeIds),
      auth.admin.from("store_enterprise_profiles").select("store_id,representative_name,business_registration_number,mail_order_registration_number,business_postal_code,business_address,business_address_detail").in("store_id", storeIds),
    ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  if (storeResult.error) {
    console.error("operator_store_settings_query_failed", {
      code: storeResult.error.code,
      message: storeResult.error.message,
    });
    return commerceJson(
      {
        error: "store_settings_unavailable",
        message: "매장 설정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      },
      503,
    );
  }
  const warnings: string[] = [];
  if (subscriptionResult.error) {
    console.error("operator_store_subscription_query_failed", {
      code: subscriptionResult.error.code,
      message: subscriptionResult.error.message,
    });
    warnings.push("이용료 현황을 일시적으로 불러오지 못했습니다.");
  }
  if (profileResult.error) {
    console.error("operator_store_profile_query_failed", {
      code: profileResult.error.code,
      message: profileResult.error.message,
    });
    warnings.push("사업자 정보를 일시적으로 불러오지 못했습니다.");
  }
  const fees = storeResult.data;
  const subscriptions = subscriptionResult.data ?? [];
  const profiles = profileResult.data ?? [];
  const feeByStore = new Map((fees ?? []).map((fee) => [fee.id, fee]));
  const subscriptionByStore = new Map((subscriptions ?? []).map((subscription) => [subscription.store_id, subscription]));
  const profileByStore = new Map((profiles ?? []).map((profile) => [profile.store_id, profile]));
  return commerceJson({warnings,management:{...management,stores:(management.stores ?? []).map((store) => ({
    ...store,
    regularShippingFee: feeByStore.get(String(store.id))?.regular_shipping_fee ?? null,
    remoteAreaShippingFee: feeByStore.get(String(store.id))?.remote_area_shipping_fee ?? null,
    mallInfo: feeByStore.get(String(store.id))?.mall_info ?? null,
    mallImage: feeByStore.get(String(store.id))?.mall_image ?? null,
    logoUrl: feeByStore.get(String(store.id))?.logo_url ?? null,
    bannerUrl: feeByStore.get(String(store.id))?.banner_url ?? null,
    conceptTags: feeByStore.get(String(store.id))?.concept_tags ?? [],
    defaultCourier: feeByStore.get(String(store.id))?.default_courier ?? 'CJ대한통운',
    announcementText: feeByStore.get(String(store.id))?.announcement_text ?? '',
    announcementEnabled: feeByStore.get(String(store.id))?.announcement_enabled ?? false,
    updatedAt: feeByStore.get(String(store.id))?.updated_at ?? null,
    representativeName: profileByStore.get(String(store.id))?.representative_name ?? '',
    businessRegistrationNumber: profileByStore.get(String(store.id))?.business_registration_number ?? '',
    mailOrderRegistrationNumber: profileByStore.get(String(store.id))?.mail_order_registration_number ?? '',
    businessPostalCode: profileByStore.get(String(store.id))?.business_postal_code ?? '',
    businessAddress: profileByStore.get(String(store.id))?.business_address ?? '',
    businessAddressDetail: profileByStore.get(String(store.id))?.business_address_detail ?? '',
    unpaidFeeBalance: subscriptionByStore.get(String(store.id))?.unpaid_fee_balance ?? 0,
    feeRolloverCount: subscriptionByStore.get(String(store.id))?.fee_rollover_count ?? 0,
    overdueNoticeSentAt: subscriptionByStore.get(String(store.id))?.overdue_notice_sent_at ?? null,
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
} else if (body.action==='save_settings') {
    let encryptedAccount: {ciphertext:string;masked:string}|null=null;
    if (body.accountNumber) {
      try { const account=normalizeAccountNumber(String(body.accountNumber)); encryptedAccount={ciphertext:encryptAccountNumber(account),masked:maskAccountNumber(account)}; }
      catch { return commerceJson({error:'정산계좌 입력 또는 암호화 설정을 확인해 주세요.'},422); }
    }
    result=await rpc.rpc('save_operator_store_settings',{
      p_store_id:body.storeId,p_name:body.name,p_bio:body.bio,p_logo_url:body.logoUrl,
      p_banner_url:body.bannerUrl,p_concept_tags:body.conceptTags,p_representative_name:body.representativeName,
      p_business_registration_number:body.businessRegistrationNumber,p_mail_order_registration_number:body.mailOrderRegistrationNumber,
      p_business_postal_code:body.businessPostalCode,p_business_address:body.businessAddress,
      p_business_address_detail:body.businessAddressDetail,p_default_courier:body.defaultCourier,
      p_regular_shipping_fee:body.regularShippingFee,p_remote_area_shipping_fee:body.remoteAreaShippingFee,
      p_bank_name:body.bankName,p_account_holder:body.accountHolder,
      p_account_number_ciphertext:encryptedAccount?.ciphertext??null,p_account_number_masked:encryptedAccount?.masked??null,
    });
} else if (body.action==='save_notice') {
    result=await rpc.rpc('save_operator_store_notice',{
      p_store_id:body.storeId,
      p_announcement_text:body.announcementText,
      p_announcement_enabled:body.announcementEnabled,
    });
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
