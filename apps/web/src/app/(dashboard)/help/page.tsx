import {
  BookOpen,
  CalendarBlank,
  ChatsCircle,
  Compass,
  GearSix,
  PencilSimple,
} from "@phosphor-icons/react/dist/ssr";

const HELP_SECTIONS = [
  {
    kicker: "Reading Room",
    title: "Dashboard",
    icon: Compass,
    body: [
      "dashboard では、投稿数・予約数・接続アカウント数を最初に確認し、運用の温度感を一望できます。",
      "各カードと概況欄をあわせて見ると、どのプラットフォームで動きが偏っているかを落ち着いて判断できます。",
      "数字だけで結論を急がず、直近の変化と全体の流れを紙面を読むように見比べるのが基本です。",
    ],
  },
  {
    kicker: "Queue Notes",
    title: "Posts",
    icon: BookOpen,
    body: [
      "posts では、一覧から公開状況やプラットフォーム別の流れを確認し、必要な投稿だけを素早く探せます。",
      "検索や絞り込みを使うと、下書き・公開済み・失敗済みの切り分けがしやすくなります。",
      "新しく出す内容があるときは一覧右上の導線から作成へ進み、編集と公開判断を一続きで進めます。",
    ],
  },
  {
    kicker: "Draft Method",
    title: "Compose",
    icon: PencilSimple,
    body: [
      "compose は本文、媒体ごとの見え方、公開タイミングを整えながら一つの投稿を仕上げるための机です。",
      "下書きの段階では言い回しと長さを整え、媒体差分がある場合は先に全体の骨格を決めてから微調整します。",
      "公開前に内容を見直すことで、急ぎの更新でも品質を崩さずに運用を続けられます。",
    ],
  },
  {
    kicker: "Timing Ledger",
    title: "Schedule / Calendar",
    icon: CalendarBlank,
    body: [
      "schedule の確認では、いつ公開されるかだけでなく、同じ日の並びと空白もあわせて見ます。",
      "calendar 表示では週や月の単位で予約投稿を俯瞰できるため、偏りや重なりを早めに見つけられます。",
      "掲載の間隔を整えておくと、連投の圧迫感を避けながら安定した配信計画を維持できます。",
    ],
  },
  {
    kicker: "Response Desk",
    title: "Inbox",
    icon: ChatsCircle,
    body: [
      "inbox では、DM・リプライ・コメントを一つの流れとして扱い、対応漏れを減らせます。",
      "相手の文脈を読みながら返信対象を選ぶことで、急ぎの問い合わせと通常対応を分けて整理できます。",
      "会話履歴を見てから返答すると、短い返信でもトーンを崩さずにやり取りを続けられます。",
    ],
  },
  {
    kicker: "Control Notes",
    title: "Settings",
    icon: GearSix,
    body: [
      "settings では、アカウント接続、権限、利用環境の前提を管理し、運用の土台を整えます。",
      "接続状態に変化があった場合は、まず対象アカウントとユーザー権限の両方を確認するのが安全です。",
      "日々の操作に直接見えない項目でも、ここを整えておくと投稿や返信の流れが安定します。",
    ],
  },
] as const;

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-5xl bg-base-100 text-base-content">
      <header className="border-y border-base-content/15 py-8 sm:py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl">
            <p className="text-[0.7rem] font-medium uppercase tracking-[0.24em] text-base-content/45">
              Help Desk
            </p>
            <h1
              className="mt-2 font-display text-4xl font-semibold leading-[1.02] tracking-[-0.02em] text-base-content sm:text-5xl"
              style={{ fontFamily: "'Fraunces', serif", fontOpticalSizing: "auto" }}
            >
              Help for Daily Operations
            </h1>
            <p
              className="mt-2 max-w-2xl font-display text-sm italic leading-6 text-base-content/60"
              style={{ fontFamily: "'Fraunces', serif" }}
            >
              主要画面の見方と使い方を、日本語の要点だけで静かに整理した案内ページです。
            </p>
          </div>
          <p className="max-w-sm text-sm leading-7 text-base-content/65">
            最初に全体の流れを掴み、必要な画面だけ深く読むための簡潔なガイドです。
          </p>
        </div>
      </header>

      <div className="divide-y divide-base-content/10">
        {HELP_SECTIONS.map((section) => {
          const Icon = section.icon;

          return (
            <section key={section.title} className="py-8 sm:py-10">
              <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)] md:gap-8">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-base-content/15 bg-base-200/35 text-base-content">
                    <Icon size={20} weight="regular" />
                  </div>
                  <div>
                    <p className="text-[0.68rem] font-medium uppercase tracking-[0.22em] text-base-content/45">
                      {section.kicker}
                    </p>
                    <h2
                      className="mt-1 font-display text-2xl font-semibold leading-tight text-base-content"
                      style={{ fontFamily: "'Fraunces', serif" }}
                    >
                      {section.title}
                    </h2>
                  </div>
                </div>

                <div className="space-y-2 text-sm leading-7 text-base-content/72">
                  {section.body.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
