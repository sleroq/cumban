function quote(value: string): string {
  return JSON.stringify(value);
}

export function buildMigratedBaseFileContent(
  queryProperty: string,
  queryValue: string,
  groupByProperty: string,
): string {
  const filterExpr = `${queryProperty}.contains(${quote(queryValue)})`;

  return [
    "views:",
    "  - type: cumban",
    "    name: All",
    "    filters:",
    "      and:",
    `        - ${filterExpr}`,
    "    groupBy:",
    `      property: ${groupByProperty}`,
    "      direction: DESC",
    "    order:",
    "      - file.name",
    `      - ${groupByProperty}`,
    `      - ${queryProperty}`,
    "    sort:",
    "      - property: file.mtime",
    "        direction: DESC",
    "  - type: table",
    "    name: Grid",
    "    filters:",
    "      and:",
    `        - ${filterExpr}`,
    "    order:",
    "      - file.name",
    `      - ${groupByProperty}`,
    `      - ${queryProperty}`,
    "    sort:",
    "      - property: file.mtime",
    "        direction: DESC",
    "      - property: status",
    "        direction: ASC",
    "",
  ].join("\n");
}
