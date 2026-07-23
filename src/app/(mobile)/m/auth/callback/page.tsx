import type { Metadata } from "next";
import AuthCallbackPage from "@/app/(shop)/auth/callback/page";

export const metadata: Metadata = { title: "로그인 확인", robots: { follow: false, index: false } };
export default AuthCallbackPage;
