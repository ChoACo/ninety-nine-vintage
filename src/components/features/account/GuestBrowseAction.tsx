"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

const className =
  "mt-6 inline-flex rounded-xl px-3 py-2 text-xs font-bold underline underline-offset-4 transition-all duration-300 hover:-translate-y-1 hover:bg-surface active:scale-95";

export function GuestBrowseAction({
  basePath = "",
  dismissToPrevious = false,
}: {
  basePath?: "" | "/m";
  dismissToPrevious?: boolean;
}) {
  const router = useRouter();

  if (!dismissToPrevious) {
    return (
      <Link className={className} href={`${basePath}/home`}>
        로그인 없이 둘러보기
      </Link>
    );
  }

  return (
    <button className={className} onClick={() => router.back()} type="button">
      로그인 없이 둘러보기
    </button>
  );
}
