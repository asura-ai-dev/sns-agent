"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type PlatformViewMode = "unified" | "columns";

const DEFAULT_MODE: PlatformViewMode = "unified";
const STORAGE_KEYS = {
  posts: "sns-agent.view-mode.posts",
  inbox: "sns-agent.view-mode.inbox",
} as const;

function parseMode(value: string | null): PlatformViewMode | null {
  if (value === "unified" || value === "columns") {
    return value;
  }
  return null;
}

export function usePlatformViewMode(pageKey: "posts" | "inbox") {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const storageKey = STORAGE_KEYS[pageKey];
  const urlMode = parseMode(searchParams.get("view"));
  const [storedMode, setStoredMode] = useState<PlatformViewMode>(DEFAULT_MODE);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (urlMode) {
      window.localStorage.setItem(storageKey, urlMode);
      setStoredMode(urlMode);
      return;
    }

    const restoredMode = parseMode(window.localStorage.getItem(storageKey)) ?? DEFAULT_MODE;
    setStoredMode(restoredMode);
  }, [storageKey, urlMode]);

  const mode = urlMode ?? storedMode;

  const setMode = (nextMode: PlatformViewMode) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, nextMode);
    }

    setStoredMode(nextMode);

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("view", nextMode);
    const nextQuery = nextParams.toString();

    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  };

  return { mode, setMode };
}
