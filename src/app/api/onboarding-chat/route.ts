import { authenticateMemberCommerceRequest, commerceJson } from "@/lib/commerce/server";

const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request:Request){
  const auth=await authenticateMemberCommerceRequest(request); if(!auth.ok)return auth.response;
  const requestedId=new URL(request.url).searchParams.get("conversationId");
  const conversationQuery=auth.user.from("onboarding_conversations").select("id,member_id,status,last_message_at,last_message_preview,created_at,updated_at").order("last_message_at",{ascending:false,nullsFirst:false});
  const [{data:faqs,error:faqError},{data:conversations,error:conversationError}]=await Promise.all([
    auth.user.from("onboarding_faq_entries").select("id,question,answer,sort_order").eq("is_approved",true).order("sort_order"),
    requestedId&&UUID_PATTERN.test(requestedId)?conversationQuery.eq("id",requestedId):conversationQuery,
  ]);
  if(faqError||conversationError)return commerceJson({error:"onboarding_chat_unavailable",message:"입점 상담을 불러오지 못했습니다."},503);
  const selected=requestedId?(conversations??[])[0]:(conversations??[])[0];
  const {data:messages,error:messageError}=selected?await auth.user.from("onboarding_messages").select("id,conversation_id,sender_id,body,created_at").eq("conversation_id",selected.id).order("created_at"):{data:[],error:null};
  if(messageError)return commerceJson({error:"onboarding_chat_unavailable",message:"입점 상담 메시지를 불러오지 못했습니다."},503);
  return commerceJson({faqs:faqs??[],conversations:conversations??[],conversation:selected??null,messages:messages??[]});
}

export async function POST(request:Request){
  const auth=await authenticateMemberCommerceRequest(request,true); if(!auth.ok)return auth.response;
  const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
  if(!body||typeof body.body!=="string"||body.body.trim().length<1||body.body.trim().length>2000||typeof body.clientNonce!=="string"||!UUID_PATTERN.test(body.clientNonce))return commerceJson({error:"invalid_onboarding_message",message:"입점 문의 내용을 확인해 주세요."},400);
  const starting=!body.conversationId;
  if(!starting&&(typeof body.conversationId!=="string"||!UUID_PATTERN.test(body.conversationId)))return commerceJson({error:"invalid_onboarding_conversation"},400);
  const {data,error}=starting?await auth.user.rpc("start_onboarding_conversation",{p_body:body.body,p_client_nonce:body.clientNonce}):await auth.user.rpc("send_onboarding_message",{p_conversation_id:String(body.conversationId),p_body:body.body,p_client_nonce:body.clientNonce});
  if(error)return commerceJson({error:"onboarding_message_failed",message:error.code==="42501"?"입점 상담 권한을 확인해 주세요.":"입점 문의를 보내지 못했습니다. 같은 내용으로 다시 시도해 주세요."},error.code==="42501"?403:409);
  return commerceJson(starting?data:{message:data},201);
}
