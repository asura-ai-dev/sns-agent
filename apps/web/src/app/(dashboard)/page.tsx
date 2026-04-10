export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight text-base-content">
          ダッシュボード
        </h2>
        <p className="mt-1 text-sm text-base-content/60">SNS運用の概要をひと目で確認できます</p>
      </div>

      {/* Placeholder cards -- replaced by later tasks */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "投稿数", value: "--", sub: "今月" },
          { label: "予約数", value: "--", sub: "今週" },
          { label: "API使用量", value: "--", sub: "今月" },
          { label: "アクティブ接続", value: "--", sub: "全SNS" },
        ].map((card) => (
          <div key={card.label} className="rounded-box border border-base-300 bg-base-100 p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-base-content/50">
              {card.label}
            </p>
            <p className="mt-2 font-display text-3xl font-semibold text-base-content">
              {card.value}
            </p>
            <p className="mt-1 text-xs text-base-content/40">{card.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
