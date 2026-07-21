"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

interface AdminSessionPayload {
  error?: string;
  session?: {
    canAccessOperator?: boolean;
    canAccessOwner?: boolean;
    userId?: string;
  };
}

interface AccessSnapshot {
  canAccessOperator: boolean;
  canAccessOwner: boolean;
  error: string;
  revision: number;
  userId: string;
}

const EMPTY_ACCESS: AccessSnapshot = {
  canAccessOperator: false,
  canAccessOwner: false,
  error: "",
  revision: -1,
  userId: "",
};

export function AdminAccessBoundary({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const { identityRevision, loading, revision, session } = useSupabaseSession();
  const [access, setAccess] = useState<AccessSnapshot>(EMPTY_ACCESS);

  const userId = session?.user.id ?? "";
  const needsOwnerAccess =
    pathname === "/admin/owner" || pathname.startsWith("/admin/owner/");
  const snapshotIsCurrent =
    Boolean(userId) &&
    access.userId === userId &&
    access.revision === revision;
  const allowed =
    snapshotIsCurrent &&
    (needsOwnerAccess
      ? access.canAccessOwner
      : access.canAccessOperator);

  useEffect(() => {
    if (loading || !session) return;

    const controller = new AbortController();
    const expectedRevision = revision;
    const expectedUserId = session.user.id;

    void (async () => {
      try {
        const response = await fetch("/api/admin/session", {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          signal: controller.signal,
        });
        const payload = (await response.json()) as AdminSessionPayload;
        if (!response.ok || !payload.session) {
          throw new Error(payload.error ?? "관리자 권한을 확인하지 못했습니다.");
        }
        if (payload.session.userId !== expectedUserId) {
          throw new Error("로그인 계정이 변경되었습니다. 다시 확인해 주세요.");
        }

        setAccess({
          canAccessOperator: payload.session.canAccessOperator === true,
          canAccessOwner: payload.session.canAccessOwner === true,
          error: "",
          revision: expectedRevision,
          userId: expectedUserId,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setAccess({
          canAccessOperator: false,
          canAccessOwner: false,
          error:
            error instanceof Error
              ? error.message
              : "관리자 권한을 확인하지 못했습니다.",
          revision: expectedRevision,
          userId: expectedUserId,
        });
      }
    })();

    return () => controller.abort();
  }, [loading, revision, session]);

  if (loading) {
    return (
      <AccessMessage
        description="로그인 세션을 확인하고 있습니다."
        title="관리자 화면을 준비하는 중입니다."
      />
    );
  }

  if (!session) {
    const returnTo = pathname.startsWith("/admin")
      ? pathname
      : "/admin/operator";
    return (
      <AccessMessage
        action={
          <a
            className="inline-flex bg-ink px-5 py-3 text-xs font-bold text-paper"
            href={`/api/auth/kakao/start?returnTo=${encodeURIComponent(returnTo)}`}
          >
            카카오로 로그인
          </a>
        }
        description="권한이 있는 계정으로 로그인하면 요청한 관리자 화면으로 돌아옵니다."
        title="관리자 로그인이 필요합니다."
      />
    );
  }

  if (!snapshotIsCurrent) {
    return (
      <AccessMessage
        description="현재 계정의 운영 권한을 확인하고 있습니다."
        title="접근 권한을 확인하는 중입니다."
      />
    );
  }

  if (!allowed) {
    return (
      <AccessMessage
        action={
          <Link
            className="inline-flex border border-ink px-5 py-3 text-xs font-bold"
            href="/"
          >
            쇼핑 화면으로 돌아가기
          </Link>
        }
        description={
          access.error ||
          (needsOwnerAccess
            ? "이 화면은 소유자 계정만 이용할 수 있습니다."
            : "이 화면은 운영 권한이 있는 계정만 이용할 수 있습니다.")
        }
        title="접근 권한이 없습니다."
      />
    );
  }

  return (
    <div key={`${userId}:${identityRevision}`}>
      <nav
        aria-label="관리자 영역"
        className="mb-8 flex items-center gap-2 border-b border-line pb-4 text-[11px] font-bold"
      >
        <Link
          className={
            pathname.startsWith("/admin/operator")
              ? "bg-ink px-4 py-2 text-paper"
              : "border border-line px-4 py-2"
          }
          href="/admin/operator"
        >
          운영자
        </Link>
        {access.canAccessOwner && (
          <Link
            className={
              pathname.startsWith("/admin/owner")
                ? "bg-ink px-4 py-2 text-paper"
                : "border border-line px-4 py-2"
            }
            href="/admin/owner"
          >
            소유자
          </Link>
        )}
      </nav>
      {children}
    </div>
  );
}

function AccessMessage({
  action,
  description,
  title,
}: Readonly<{
  action?: React.ReactNode;
  description: string;
  title: string;
}>) {
  return (
    <section
      className="grid min-h-[520px] place-items-center border border-dashed border-line bg-surface px-10 text-center"
      role="status"
    >
      <div className="max-w-lg">
        <p className="eyebrow text-muted">관리자 · 접근 권한</p>
        <h1 className="mt-4 text-3xl font-black tracking-[-0.06em]">{title}</h1>
        <p className="mt-4 text-sm leading-6 text-muted">{description}</p>
        {action && <div className="mt-7">{action}</div>}
      </div>
    </section>
  );
}
