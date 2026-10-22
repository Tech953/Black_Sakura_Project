const declarationPattern =
  /^export\s+(?:declare\s+)?(const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;

function exportedDeclarations(source) {
  const matches = [...source.matchAll(declarationPattern)];
  return new Map(
    matches.map((match, index) => {
      const start = match.index;
      const end = matches[index + 1]?.index ?? source.length;
      return [`${match[1]}:${match[2]}`, source.slice(start, end)];
    }),
  );
}

function routePaths(source) {
  return [
    ...new Set(
      [...source.matchAll(/[`'"]([^`'"]*\/[^`'"]*)[`'"]/g)]
        .map((match) => match[1])
        .filter((value) => value.startsWith("/"))
        .map((value) =>
          value.replace(/\$\{\s*([A-Za-z_$][\w$]*)[^}]*\}/g, "{$1}"),
        ),
    ),
  ];
}

export function changedExportNames(before, after) {
  const beforeDeclarations = exportedDeclarations(before);
  const afterDeclarations = exportedDeclarations(after);
  const changedKeys = new Set([
    ...beforeDeclarations.keys(),
    ...afterDeclarations.keys(),
  ]);

  return [...changedKeys]
    .filter((key) => beforeDeclarations.get(key) !== afterDeclarations.get(key))
    .map((key) => key.slice(key.indexOf(":") + 1))
    .sort();
}

export function describeGeneratedMismatch(relativePath, before, after) {
  const names = changedExportNames(before, after);
  const labels = names.length
    ? names.slice(0, 12).join(", ") +
      (names.length > 12 ? `, and ${names.length - 12} more` : "")
    : "generated module metadata or file layout";

  if (relativePath.includes("api-client-react/src/generated/api.ts")) {
    const paths = [...new Set([...routePaths(before), ...routePaths(after)])];
    const endpointLabel = paths.length
      ? `endpoint(s) ${paths.join(", ")}`
      : `endpoint/client exports ${labels}`;
    return `${endpointLabel}; exports: ${labels}`;
  }

  if (relativePath.includes("api-client-react/src/generated/api.schemas.ts")) {
    return `client schema/type exports: ${labels}`;
  }

  if (relativePath.includes("api-zod/src/generated/types/")) {
    const schemaName = relativePath.split("/").at(-1)?.replace(/\.ts$/, "");
    return `Zod schema ${schemaName ?? labels}; exports: ${labels}`;
  }

  if (relativePath.includes("api-zod/src/generated/api.ts")) {
    return `Zod endpoint/schema exports: ${labels}`;
  }

  return `generated exports: ${labels}`;
}
