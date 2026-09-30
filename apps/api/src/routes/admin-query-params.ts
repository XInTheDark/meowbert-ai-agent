export function parseCsvList(value: string | undefined, maxItems: number): string[] {
  if (!value) {
    return [];
  }

  return Array.from(new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  )).slice(0, maxItems);
}

export function parseUuidCsvList(value: string | undefined, maxItems: number): string[] {
  return parseCsvList(value, maxItems).filter((entry) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry)
  );
}
