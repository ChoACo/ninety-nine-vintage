export function parseSupabaseMigrationList(output) {
  const jsonStart = output.indexOf("{");
  const jsonEnd = output.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const payload = JSON.parse(output.slice(jsonStart, jsonEnd + 1));
      if (Array.isArray(payload.migrations)) return payload.migrations;
    } catch {
      // Newer CLI versions may ignore JSON output and print a table instead.
    }
  }

  const migrations = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(
      /^\s*`?(\d{14})`?\s*\|\s*`?\s*(\d{14})?\s*`?\s*\|/,
    );
    if (!match) continue;
    migrations.push({ local: match[1], remote: match[2] ?? "" });
  }
  return migrations;
}
