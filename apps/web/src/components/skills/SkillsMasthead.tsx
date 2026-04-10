/**
 * SkillsMasthead — Task 5005
 *
 * Ornamental header for the `/skills` page. Matches the editorial /
 * broadsheet tone used by `SettingsShell` (paper grain, Fraunces display,
 * mono eyebrow, accent ruler) but lives outside of the settings left-rail
 * because `/skills` is a top-level destination.
 */
import type { ReactNode } from "react";

interface SkillsMastheadProps {
  eyebrow: string;
  title: string;
  description?: string;
  packageCount: number;
  actions?: ReactNode;
}

export function SkillsMasthead({
  eyebrow,
  title,
  description,
  packageCount,
  actions,
}: SkillsMastheadProps) {
  return (
    <header className="relative overflow-hidden rounded-box border border-base-300 bg-gradient-to-br from-base-100 via-base-100 to-base-200/60 px-6 py-6">
      {/* Paper grain */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, #000 0px, #000 1px, transparent 1px, transparent 28px)",
        }}
      />
      {/* Accent ruler */}
      <div className="pointer-events-none absolute inset-x-6 top-16 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />

      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-base-content/50">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
            {eyebrow}
          </p>
          <h1
            className="mt-2 font-display text-4xl font-semibold leading-none tracking-tight text-base-content"
            style={{ fontFamily: "'Fraunces', serif", fontFeatureSettings: "'ss01', 'ss02'" }}
          >
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-2xl text-sm text-base-content/60">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-sm border border-base-300 bg-base-100 px-4 py-2.5 text-right leading-tight">
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-base-content/50">
              packages
            </div>
            <div
              className="mt-0.5 font-display text-2xl font-semibold tabular-nums text-base-content"
              style={{ fontFamily: "'Fraunces', serif" }}
            >
              {packageCount}
            </div>
          </div>
          {actions}
        </div>
      </div>
    </header>
  );
}
