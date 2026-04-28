import type { EngagementGateStealthConfig } from "../domain/entities.js";

export interface NormalizedStealthConfig {
  gateHourlyLimit: number | null;
  gateDailyLimit: number | null;
  accountHourlyLimit: number | null;
  accountDailyLimit: number | null;
  jitterMinSeconds: number;
  jitterMaxSeconds: number;
  backoffSeconds: number | null;
  templateVariants: string[];
}

export interface DeliveryCounts {
  gateHour: number;
  gateDay: number;
  accountHour: number;
  accountDay: number;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function nonNegativeInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

export function normalizeStealthConfig(
  config: EngagementGateStealthConfig | null | undefined,
): NormalizedStealthConfig | null {
  if (!config) return null;
  const jitterMinSeconds = nonNegativeInt(config.jitterMinSeconds) ?? 0;
  const rawJitterMaxSeconds = nonNegativeInt(config.jitterMaxSeconds) ?? jitterMinSeconds;
  const templateVariants = Array.isArray(config.templateVariants)
    ? config.templateVariants.map((value) => value.trim()).filter(Boolean)
    : [];

  return {
    gateHourlyLimit: positiveInt(config.gateHourlyLimit),
    gateDailyLimit: positiveInt(config.gateDailyLimit),
    accountHourlyLimit: positiveInt(config.accountHourlyLimit),
    accountDailyLimit: positiveInt(config.accountDailyLimit),
    jitterMinSeconds,
    jitterMaxSeconds: Math.max(jitterMinSeconds, rawJitterMaxSeconds),
    backoffSeconds: positiveInt(config.backoffSeconds),
    templateVariants,
  };
}

export function serializeStealthConfig(
  config: EngagementGateStealthConfig | null | undefined,
): EngagementGateStealthConfig | null {
  const normalized = normalizeStealthConfig(config);
  if (!normalized) return null;
  return {
    gateHourlyLimit: normalized.gateHourlyLimit,
    gateDailyLimit: normalized.gateDailyLimit,
    accountHourlyLimit: normalized.accountHourlyLimit,
    accountDailyLimit: normalized.accountDailyLimit,
    jitterMinSeconds: normalized.jitterMinSeconds,
    jitterMaxSeconds: normalized.jitterMaxSeconds,
    backoffSeconds: normalized.backoffSeconds,
    templateVariants: normalized.templateVariants.length ? normalized.templateVariants : null,
  };
}

export function renderTemplateVariation(input: {
  fallbackText: string | null;
  config: NormalizedStealthConfig | null;
  seed: string;
}): string | null {
  const variants = input.config?.templateVariants ?? [];
  if (!variants.length) return input.fallbackText;
  return variants[hashSeed(input.seed) % variants.length];
}

export function jitterReadyAt(input: {
  replyCreatedAt: Date | null;
  config: NormalizedStealthConfig | null;
  seed: string;
}): Date | null {
  if (!input.config || input.config.jitterMaxSeconds <= 0) return null;
  const base = input.replyCreatedAt;
  if (!base) return null;
  const range = input.config.jitterMaxSeconds - input.config.jitterMinSeconds;
  const jitterSeconds =
    input.config.jitterMinSeconds + (range === 0 ? 0 : hashSeed(input.seed) % (range + 1));
  return new Date(base.getTime() + jitterSeconds * 1000);
}

export function isRateLimited(
  config: NormalizedStealthConfig | null,
  counts: DeliveryCounts,
): boolean {
  if (!config) return false;
  return (
    (config.gateHourlyLimit !== null && counts.gateHour >= config.gateHourlyLimit) ||
    (config.gateDailyLimit !== null && counts.gateDay >= config.gateDailyLimit) ||
    (config.accountHourlyLimit !== null && counts.accountHour >= config.accountHourlyLimit) ||
    (config.accountDailyLimit !== null && counts.accountDay >= config.accountDailyLimit)
  );
}

export function nextBackoffUntil(now: Date, config: NormalizedStealthConfig | null): Date {
  const seconds = config?.backoffSeconds ?? 900;
  return new Date(now.getTime() + seconds * 1000);
}
