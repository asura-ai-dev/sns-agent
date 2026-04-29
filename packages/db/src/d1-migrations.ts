export type D1MigrationSource = {
  filename: string;
  sql: string;
};

export function buildD1MigrationBundle(sources: D1MigrationSource[]): string {
  const sqlFiles = sources
    .filter((source) => source.filename.endsWith(".sql"))
    .sort((a, b) => a.filename.localeCompare(b.filename));

  const chunks = sqlFiles.map((source) => {
    return [`-- Source: ${source.filename}`, source.sql.trim()].join("\n");
  });

  return `${chunks.join("\n\n")}\n`;
}
