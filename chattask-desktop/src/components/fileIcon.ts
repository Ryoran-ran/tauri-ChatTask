export const fileIcon = (name: string) => {
  const extension = name.split(".").pop()?.toLowerCase() || "";
  if (["md", "mdx"].includes(extension)) return { label: "M↓", type: "markdown" };
  if (extension === "pdf") return { label: "PDF", type: "pdf" };
  if (["doc", "docx"].includes(extension)) return { label: "W", type: "word" };
  if (["xls", "xlsx", "csv"].includes(extension)) return { label: extension === "csv" ? "CSV" : "X", type: "sheet" };
  if (["ppt", "pptx"].includes(extension)) return { label: "P", type: "slides" };
  if (["zip", "rar", "7z", "gz", "tar"].includes(extension)) return { label: "ZIP", type: "archive" };
  if (["js", "jsx", "ts", "tsx", "html", "css", "scss", "json", "xml", "yaml", "yml"].includes(extension)) return { label: "</>", type: "code" };
  if (["sql", "db", "sqlite", "sqlite3"].includes(extension)) return { label: "DB", type: "database" };
  if (["txt", "log"].includes(extension)) return { label: "TXT", type: "text" };
  return { label: extension ? extension.slice(0, 4).toUpperCase() : "FILE", type: "generic" };
};
