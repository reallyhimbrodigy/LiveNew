export function parseNamedImports(source) {
  const imports = [];
  const importRegex = /import\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/g;
  let match;
  while ((match = importRegex.exec(source))) {
    const rawList = match[1];
    const specifier = match[2];
    const names = rawList
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const parts = entry.split(/\s+as\s+/i).map((part) => part.trim());
        return parts[0];
      })
      .filter(Boolean);
    if (names.length) imports.push({ specifier, names });
  }
  return imports;
}

export function parseNamedExports(source) {
  const names = new Set();
  const reexports = [];
  const exportAll = [];

  const exportDefaultRegex = /export\s+default\b/g;
  if (exportDefaultRegex.test(source)) {
    names.add("default");
  }

  const exportFnRegex = /export\s+function\s+([A-Za-z_$][\w$]*)/g;
  const exportClassRegex = /export\s+class\s+([A-Za-z_$][\w$]*)/g;
  const exportVarRegex = /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;

  let match;
  while ((match = exportFnRegex.exec(source))) names.add(match[1]);
  while ((match = exportClassRegex.exec(source))) names.add(match[1]);
  while ((match = exportVarRegex.exec(source))) names.add(match[1]);

  const exportListRegex = /export\s*\{([\s\S]*?)\}\s*(?:from\s*["']([^"']+)["'])?/g;
  while ((match = exportListRegex.exec(source))) {
    const list = match[1];
    const specifier = match[2] || null;
    const specifiers = list
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const parts = entry.split(/\s+as\s+/i).map((part) => part.trim());
        const local = parts[0];
        const exported = parts[1] || parts[0];
        return { local, exported };
      });
    specifiers.forEach((spec) => names.add(spec.exported));
    if (specifier) reexports.push({ specifier, specifiers });
  }

  const exportAllRegex = /export\s*\*\s*from\s*["']([^"']+)["']/g;
  while ((match = exportAllRegex.exec(source))) {
    exportAll.push(match[1]);
  }

  return { names, reexports, exportAll };
}

export function isRelativeSpecifier(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../");
}
