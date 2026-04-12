"use client";

/**
 * 承認/却下のスタンプ SVG コンポーネント。
 * dialog 右上に表示し、操作直後にスタンプが押される演出を持つ。
 */
type StampState = "idle" | "approved" | "rejected";

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function ApprovalStamp({ state = "idle" }: { state?: StampState }) {
  const label = state === "approved" ? "APPROVED" : state === "rejected" ? "REJECTED" : "PENDING";
  const color =
    state === "approved"
      ? "text-primary border-primary"
      : state === "rejected"
        ? "text-error border-error"
        : "text-base-content/40 border-base-content/30";

  return (
    <div
      className={cn(
        "relative flex h-32 w-32 items-center justify-center rounded-full border-2 border-dashed font-display text-xs font-bold uppercase tracking-[0.18em]",
        color,
        state !== "idle" && "stamp-push",
      )}
      aria-label={`Approval status: ${label}`}
    >
      <div className="absolute inset-2 rounded-full border border-current opacity-40" />
      <span className="relative z-10">{label}</span>
      <style>{`
        .stamp-push {
          animation: stampPush 420ms cubic-bezier(0.2, 1.3, 0.4, 1) both;
        }
        @keyframes stampPush {
          0% {
            transform: scale(0.55) rotate(-14deg);
            opacity: 0;
          }
          60% {
            transform: scale(1.08) rotate(-2deg);
            opacity: 1;
          }
          100% {
            transform: scale(1) rotate(-3deg);
            opacity: 1;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .stamp-push {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
