import type { TextItem } from "pdfjs-dist/types/src/display/api";

export async function extractPDFText(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");

  // Use worker from /public
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib
    .getDocument({ data: new Uint8Array(arrayBuffer) })
    .promise;

  const pages: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const tc = await page.getTextContent();

    const items = tc.items
      .filter((it): it is TextItem => "str" in it && it.str.trim() !== "")
      .map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
      }));

    if (items.length === 0) continue;

    // Sort top-to-bottom (higher Y = higher on page in PDF coord space),
    // then left-to-right
    items.sort((a, b) => {
      if (Math.abs(a.y - b.y) > 4) return b.y - a.y;
      return a.x - b.x;
    });

    // Group into lines by Y proximity
    const lineGroups: { y: number; strs: string[] }[] = [];
    for (const it of items) {
      const last = lineGroups[lineGroups.length - 1];
      if (last && Math.abs(it.y - last.y) <= 4) {
        last.strs.push(it.str);
      } else {
        lineGroups.push({ y: it.y, strs: [it.str] });
      }
    }

    const pageText = lineGroups
      .map((g) => g.strs.join(" ").trim())
      .filter((l) => l)
      .join("\n");

    pages.push(pageText);
  }

  return pages.join("\n");
}
