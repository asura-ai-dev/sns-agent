/**
 * PlatformIcon - SNS プラットフォームの固有色チップ
 *
 * 監査ログの PlatformChip と意匠を揃えつつ、設定画面ではより大きな
 * アイコン + ブランドカラーでアカウントカードのシンボルとして使う。
 *
 * @example
 * <PlatformIcon platform="x" />
 *
 * @example
 * <PlatformIcon platform="line" variant="outline" size={32} />
 *
 * @example
 * <PlatformIcon platform="instagram" variant="chip" />
 */
import { XLogo, InstagramLogo, ChatCircleDots } from "@phosphor-icons/react/dist/ssr";
import type { CSSProperties } from "react";

export type Platform = "x" | "line" | "instagram";
export type PlatformIconVariant = "solid" | "outline" | "chip";

interface PlatformVisual {
  label: string;
  icon: typeof XLogo;
  background: string;
  color: string;
  ring: string;
}

export const PLATFORM_VISUALS: Record<Platform, PlatformVisual> = {
  x: {
    label: "X",
    icon: XLogo,
    background: "linear-gradient(135deg, #111111 0%, #2a2a2a 100%)",
    color: "#FFFFFF",
    ring: "rgba(17,17,17,0.4)",
  },
  line: {
    label: "LINE",
    icon: ChatCircleDots,
    background: "linear-gradient(135deg, #06C755 0%, #04a446 100%)",
    color: "#FFFFFF",
    ring: "rgba(6,199,85,0.4)",
  },
  instagram: {
    label: "Instagram",
    icon: InstagramLogo,
    background: "linear-gradient(135deg, #F58529 0%, #DD2A7B 40%, #8134AF 75%, #515BD4 100%)",
    color: "#FFFFFF",
    ring: "rgba(221,42,123,0.4)",
  },
};

interface PlatformIconProps {
  platform: Platform;
  size?: number;
  variant?: PlatformIconVariant;
  className?: string;
}

function getSolidAccentColor(visual: PlatformVisual) {
  return visual.ring.replace(/,\s*[\d.]+\)$/, ")");
}

function getPlatformIconPresentation(
  visual: PlatformVisual,
  variant: PlatformIconVariant,
  size?: number,
): {
  className: string;
  iconSize: number;
  style: CSSProperties;
} {
  const resolvedSize = size ?? (variant === "chip" ? 20 : 40);

  if (variant === "chip") {
    return {
      className: "inline-flex rounded-full",
      iconSize: Math.floor(resolvedSize * 0.55),
      style: {
        width: resolvedSize,
        height: resolvedSize,
        background: visual.background,
        color: visual.color,
        boxShadow: `0 0 0 1px ${visual.ring}`,
      },
    };
  }

  if (variant === "outline") {
    const accentColor = getSolidAccentColor(visual);
    return {
      className: "inline-flex rounded-sm border",
      iconSize: Math.floor(resolvedSize * 0.5),
      style: {
        width: resolvedSize,
        height: resolvedSize,
        background: "transparent",
        borderColor: accentColor,
        color: accentColor,
        boxShadow: "none",
      },
    };
  }

  return {
    className: "inline-flex rounded-sm",
    iconSize: Math.floor(resolvedSize * 0.5),
    style: {
      width: resolvedSize,
      height: resolvedSize,
      background: visual.background,
      color: visual.color,
      boxShadow: `0 0 0 1px ${visual.ring}, 0 4px 12px -4px ${visual.ring}`,
    },
  };
}

export function PlatformIcon({
  platform,
  size,
  variant = "solid",
  className = "",
}: PlatformIconProps) {
  const visual = PLATFORM_VISUALS[platform];
  const Icon = visual.icon;
  const presentation = getPlatformIconPresentation(visual, variant, size);

  return (
    <span
      aria-label={visual.label}
      className={`${presentation.className} shrink-0 items-center justify-center ${className}`}
      style={presentation.style}
    >
      <Icon size={presentation.iconSize} weight="bold" />
    </span>
  );
}
