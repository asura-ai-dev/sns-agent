import { SECTION_KICKERS, MASTHEAD_TITLES } from "../../lib/i18n/labels";

const SECTION_TITLES = [
  "Treasury Figures",
  "Volume & Spend, by Bucket",
  "Per-Bureau Detail",
  "X Cost Dimensions",
  "Budget Consumption",
];

function SkeletonRule({ wide = false }: { wide?: boolean }) {
  return (
    <div
      aria-hidden
      className={`h-3 animate-pulse rounded-sm bg-base-content/10 ${wide ? "w-full" : "w-2/3"}`}
    />
  );
}

export function UsageLoadingState() {
  return (
    <div
      className="mx-auto w-full min-w-0 max-w-[1440px] space-y-7"
      aria-busy="true"
      aria-live="polite"
    >
      <header className="relative">
        <div className="flex flex-wrap items-end justify-between gap-3 pb-3">
          <div className="font-mono text-[10px] uppercase leading-none tracking-[0.22em] text-base-content/55">
            loading usage ledger
          </div>
          <div className="font-mono text-[10px] uppercase leading-none tracking-[0.22em] text-base-content/55">
            {SECTION_KICKERS.usage} &nbsp;·&nbsp; api &amp; llm spend
          </div>
        </div>

        <div aria-hidden className="border-t-2 border-base-content/75" />
        <div aria-hidden className="mt-[3px] border-t border-base-content/40" />

        <div className="pt-4">
          <h1
            className="font-display text-[40px] font-semibold leading-[1.02] text-base-content sm:text-[52px]"
            style={{ fontFamily: "'Fraunces', serif", fontOpticalSizing: "auto" }}
          >
            {MASTHEAD_TITLES.usage}
          </h1>
        </div>

        <div aria-hidden className="mt-4 border-t border-base-content/40" />
        <div aria-hidden className="mt-[3px] border-t-2 border-base-content/75" />
      </header>

      <section className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="border-y border-base-content/15 py-4">
              <SkeletonRule />
              <div className="mt-3">
                <SkeletonRule wide />
              </div>
            </div>
          ))}
        </div>

        {SECTION_TITLES.map((title) => (
          <div key={title} className="border-t border-base-content/15 pt-4">
            <div className="mb-3 font-display text-base font-semibold text-base-content">
              {title}
            </div>
            <div className="space-y-2">
              <SkeletonRule wide />
              <SkeletonRule />
              <SkeletonRule wide />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
