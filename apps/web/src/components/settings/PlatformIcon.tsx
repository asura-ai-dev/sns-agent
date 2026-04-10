/**
 * PlatformIcon - SNS プラットフォームの固有色チップ
 *
 * 監査ログの PlatformChip と意匠を揃えつつ、設定画面ではより大きな
 * アイコン + ブランドカラーでアカウントカードのシンボルとして使う。
 */
import { XLogo, InstagramLogo, ChatCircleDots } from "@phosphor-icons/react";
import type { CSSProperties } from "react";

export type Platform = "x" | "line" | "instagram";

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
  className?: string;
}

export function PlatformIcon({ platform, size = 40, className = "" }: PlatformIconProps) {
  const visual = PLATFORM_VISUALS[platform];
  const Icon = visual.icon;
  const style: CSSProperties = {
    width: size,
    height: size,
    background: visual.background,
    color: visual.color,
    boxShadow: `0 0 0 1px ${visual.ring}, 0 4px 12px -4px ${visual.ring}`,
  };
  return (
    <span
      aria-label={visual.label}
      className={`inline-flex shrink-0 items-center justify-center rounded-sm ${className}`}
      style={style}
    >
      <Icon size={Math.floor(size * 0.5)} weight="bold" />
    </span>
  );
}
