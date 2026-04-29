import { describe, expect, it } from "vitest";
import { buildD1MigrationBundle } from "../src/d1-migrations.js";

describe("buildD1MigrationBundle", () => {
  it("combines sqlite migrations in filename order with source annotations", () => {
    const bundle = buildD1MigrationBundle([
      { filename: "0002_followers.sql", sql: "CREATE TABLE followers (id text PRIMARY KEY);" },
      { filename: "0001_accounts.sql", sql: "CREATE TABLE accounts (id text PRIMARY KEY);" },
    ]);

    expect(bundle).toContain("-- Source: 0001_accounts.sql");
    expect(bundle).toContain("-- Source: 0002_followers.sql");
    expect(bundle.indexOf("0001_accounts.sql")).toBeLessThan(bundle.indexOf("0002_followers.sql"));
    expect(bundle).toMatch(/CREATE TABLE accounts/);
    expect(bundle).toMatch(/CREATE TABLE followers/);
    expect(bundle.endsWith("\n")).toBe(true);
  });

  it("excludes drizzle metadata files from the D1 bundle", () => {
    const bundle = buildD1MigrationBundle([
      { filename: "meta/_journal.json", sql: "{\"entries\":[]}" },
      { filename: "0001_accounts.sql", sql: "CREATE TABLE accounts (id text PRIMARY KEY);" },
    ]);

    expect(bundle).toContain("0001_accounts.sql");
    expect(bundle).not.toContain("_journal.json");
    expect(bundle).not.toContain("\"entries\"");
  });
});
