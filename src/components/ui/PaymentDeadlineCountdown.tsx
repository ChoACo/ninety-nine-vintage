"use client";

import { Clock3 } from "lucide-react";
import { useEffect, useState } from "react";

function formatDeadline(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function formatRemaining(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  return days > 0 ? `${days}일 ${clock}` : clock;
}

export function PaymentDeadlineCountdown({
  dueAt,
  serverTime = null,
}: {
  dueAt: string | null;
  serverTime?: string | null;
}) {
  const [clientNow, setClientNow] = useState<number | null>(null);

  useEffect(() => {
    const parsedServerTime = serverTime
      ? Date.parse(serverTime)
      : Number.NaN;
    const serverOffset = Number.isFinite(parsedServerTime)
      ? parsedServerTime - Date.now()
      : 0;
    const tick = () => setClientNow(Date.now() + serverOffset);
    tick();
    const intervalId = window.setInterval(tick, 1_000);
    return () => window.clearInterval(intervalId);
  }, [serverTime]);

  const dueTimestamp = dueAt ? Date.parse(dueAt) : Number.NaN;
  const remaining =
    clientNow !== null && Number.isFinite(dueTimestamp)
      ? dueTimestamp - clientNow
      : null;
  const expired = remaining !== null && remaining <= 0;
  const urgent = remaining !== null && remaining > 0 && remaining <= 3_600_000;

  return (
    <div
      aria-live="polite"
      className={`rounded-xl border p-3 ${
        expired
          ? "border-red-300 bg-red-50 text-red-800"
          : urgent
            ? "border-amber-300 bg-amber-50 text-amber-900"
            : "border-emerald-300 bg-emerald-50 text-emerald-900"
      }`}
    >
      <div className="flex items-center gap-2 text-[11px] font-black">
        <Clock3 aria-hidden="true" size={15} />
        <span>{expired ? "입금 마감" : "입금 마감까지 남은 시간"}</span>
      </div>
      <strong className="mt-1 block font-mono text-xl tracking-tight">
        {!dueAt
          ? "마감 확인 중"
          : remaining === null
            ? "계산 중"
            : expired
              ? "마감 시간이 지났습니다"
              : formatRemaining(remaining)}
      </strong>
      {dueAt && Number.isFinite(dueTimestamp) ? (
        <time className="mt-1 block text-[10px] font-bold" dateTime={dueAt}>
          {formatDeadline(dueAt)} 마감
        </time>
      ) : null}
    </div>
  );
}
