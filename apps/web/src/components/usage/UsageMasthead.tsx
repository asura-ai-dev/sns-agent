/**
 * UsageMasthead — Task 4005
 *
 * The "Treasury Bulletin" masthead. Mirrors the dashboard's broadsheet
 * banner so the usage page feels like a chapter of the same paper, but
 * with a distinct title and edition labels.
 */
import { RssSimple } from "@phosphor-icons/react/dist/ssr";
import { MASTHEAD_TITLES, SECTION_KICKERS } from "@/lib/i18n/labels";

interface UsageMastheadProps {
  now: Date;
  rangeFrom: string;
  rangeTo: string;
  degraded: boolean;
  errorLines: string[];
}

function formatDateline(now: Date) {
  const weekdayFmt = now.toLocaleDateString("en-US", { weekday: "long" });
  const monthFmt = now.toLocaleDateString("en-US", { month: "long" });
  const day = now.getDate();
  const year = now.getFullYear();
  return {
    weekday: weekdayFmt.toUpperCase(),
    date: `${monthFmt} ${day}, ${year}`.toUpperCase(),
  };
}

export function UsageMasthead({
  now,
  rangeFrom,
  rangeTo,
  degraded,
  errorLines,
}: UsageMastheadProps) {
  const dateline = formatDateline(now);

  return (
    <header className="relative">
      <div className="flex flex-wrap items-end justify-between gap-3 pb-3">
        <div className="font-mono text-[10px] uppercase leading-none tracking-[0.22em] text-base-content/55">
          {dateline.weekday} · {dateline.date}
        </div>
        <div className="font-mono text-[10px] uppercase leading-none tracking-[0.22em] text-base-content/55">
          {SECTION_KICKERS.usage} &nbsp;·&nbsp; api &amp; llm spend
        </div>
      </div>

      {/* Double-rule top of masthead */}
      <div aria-hidden className="border-t-2 border-base-content/75" />
      <div aria-hidden className="mt-[3px] border-t border-base-content/40" />

      <div className="flex flex-wrap items-end justify-between gap-6 pt-4">
        <div className="min-w-0">
          <h1
            className="font-display text-[40px] font-semibold leading-[1.02] tracking-[-0.02em] text-base-content sm:text-[52px]"
            style={{ fontFamily: "'Fraunces', serif", fontOpticalSizing: "auto" }}
          >
            {MASTHEAD_TITLES.usage}
          </h1>
        </div>

        <div className="flex items-center gap-6 pb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-base-content/55">
          <div className="text-right">
            <div className="text-base-content/40">range</div>
            <div className="tabular-nums text-base-content/80">
              {rangeFrom.slice(0, 10)} → {rangeTo.slice(0, 10)}
            </div>
          </div>
          <div className="h-8 w-px bg-base-content/20" aria-hidden />
          <div className="text-right">
            <div className="text-base-content/40">printed</div>
            <div className="tabular-nums text-base-content/80">
              {String(now.getHours()).padStart(2, "0")}:{String(now.getMinutes()).padStart(2, "0")}{" "}
              JST
            </div>
          </div>
        </div>
      </div>

      {/* Bottom rule of masthead */}
      <div aria-hidden className="mt-4 border-t border-base-content/40" />
      <div aria-hidden className="mt-[3px] border-t-2 border-base-content/75" />

      {degraded && (
        <div className="mt-4 flex items-start gap-3 rounded-sm border border-dashed border-warning/60 bg-warning/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-[#7a4b00]">
          <RssSimple size={12} weight="bold" className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">回線オフライン · ローカルの代替データを表示しています</div>
            {errorLines.length > 0 && (
              <ul className="mt-1 space-y-0.5 normal-case tracking-normal text-[#7a4b00]/80">
                {errorLines.map((line) => (
                  <li key={line} className="truncate">
                    · {line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
