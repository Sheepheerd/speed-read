// File → sections: [{ title, text }]. One section per chapter where the
// format can tell us (PDF outline, EPUB table of contents, Markdown
// headings); otherwise a single untitled section. Paragraph breaks are
// preserved as blank lines because the tokenizer pauses on them.

export async function extractSections(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return extractPdf(file);
  }
  if (name.endsWith(".epub") || file.type === "application/epub+zip") {
    return extractEpub(file);
  }
  return sectionsFromText(await file.text());
}

// Markdown-style headings (# through ###) become chapter titles.
export function sectionsFromText(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const sections = [];
  let current = { title: "", text: "" };
  for (const line of lines) {
    const h = line.match(/^#{1,3}\s+(.+?)\s*#*\s*$/);
    if (h) {
      if (current.text.trim()) sections.push(current);
      current = { title: h[1], text: "" };
    } else {
      current.text += line + "\n";
    }
  }
  if (current.text.trim()) sections.push(current);
  return sections.length ? sections : [{ title: "", text }];
}

// ---------------- PDF ----------------

async function extractPdf(file) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pageTexts = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      text += item.str;
      if (item.hasEOL) {
        // De-hyphenate words broken across lines; otherwise a line end
        // is just a space.
        text = text.endsWith("-") ? text.slice(0, -1) : text + " ";
      }
    }
    pageTexts.push(text.trim());
    page.cleanup();
  }

  // Chapters from the document outline (bookmarks), resolved to pages.
  const sections = [];
  try {
    const outline = await doc.getOutline();
    if (outline?.length) {
      const marks = [];
      for (const item of outline) {
        let dest = item.dest;
        if (typeof dest === "string") dest = await doc.getDestination(dest);
        if (!Array.isArray(dest) || !dest[0]) continue;
        const page = await doc.getPageIndex(dest[0]);
        marks.push({ title: item.title?.trim() || "Untitled", page });
      }
      marks.sort((a, b) => a.page - b.page);
      const dedup = marks.filter((m, i) => i === 0 || m.page > marks[i - 1].page);
      if (dedup.length && dedup[0].page > 0) {
        dedup.unshift({ title: "Front matter", page: 0 });
      }
      for (let i = 0; i < dedup.length; i++) {
        const end = i + 1 < dedup.length ? dedup[i + 1].page : pageTexts.length;
        const text = pageTexts.slice(dedup[i].page, end).filter(Boolean).join("\n\n");
        if (text) sections.push({ title: dedup[i].title, text });
      }
    }
  } catch {
    // Broken outlines are common; fall back to a single section.
  }
  await doc.destroy();

  if (!sections.length) {
    const text = pageTexts.filter(Boolean).join("\n\n");
    if (!text) throw new Error("No text found in this PDF");
    sections.push({ title: "", text });
  }
  return sections;
}

// ---------------- EPUB ----------------

// Resolve href relative to the directory of `fromPath`, dropping fragments.
function resolvePath(fromPath, href) {
  const clean = decodeURIComponent(href).replace(/#.*$/, "");
  if (!clean) return null;
  const base = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/") + 1) : "";
  const parts = (base + clean).split("/");
  const out = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

async function extractEpub(file) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const parser = new DOMParser();

  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  if (!containerXml) throw new Error("Not a valid EPUB (missing container.xml)");
  const container = parser.parseFromString(containerXml, "application/xml");
  const opfPath = container.querySelector("rootfile")?.getAttribute("full-path");
  if (!opfPath) throw new Error("Not a valid EPUB (no rootfile)");

  const opfXml = await zip.file(opfPath)?.async("string");
  const opf = parser.parseFromString(opfXml, "application/xml");

  const manifest = new Map(); // id -> zip path
  let navPath = null;
  for (const item of opf.querySelectorAll("manifest > item")) {
    const path = resolvePath(opfPath, item.getAttribute("href") ?? "");
    manifest.set(item.getAttribute("id"), path);
    if ((item.getAttribute("properties") ?? "").split(/\s+/).includes("nav")) {
      navPath = path;
    }
  }

  // Chapter titles from the TOC: EPUB3 nav.xhtml, else EPUB2 toc.ncx.
  const titles = new Map(); // zip path -> title
  if (navPath) {
    const navHtml = await zip.file(navPath)?.async("string");
    if (navHtml) {
      const nav = parser.parseFromString(navHtml, "text/html");
      const scope =
        nav.querySelector('nav[*|type="toc"], nav[role="doc-toc"]') ?? nav;
      for (const a of scope.querySelectorAll("a[href]")) {
        const path = resolvePath(navPath, a.getAttribute("href"));
        const title = a.textContent.replace(/\s+/g, " ").trim();
        if (path && title && !titles.has(path)) titles.set(path, title);
      }
    }
  }
  if (!titles.size) {
    const ncxId = opf.querySelector("spine")?.getAttribute("toc");
    const ncxPath = ncxId ? manifest.get(ncxId) : null;
    const ncxXml = ncxPath ? await zip.file(ncxPath)?.async("string") : null;
    if (ncxXml) {
      const ncx = parser.parseFromString(ncxXml, "application/xml");
      for (const point of ncx.querySelectorAll("navPoint")) {
        const src = point.querySelector("content")?.getAttribute("src");
        const title = point
          .querySelector("navLabel > text")
          ?.textContent.replace(/\s+/g, " ")
          .trim();
        const path = src ? resolvePath(ncxPath, src) : null;
        if (path && title && !titles.has(path)) titles.set(path, title);
      }
    }
  }

  const sections = [];
  for (const ref of opf.querySelectorAll("spine > itemref")) {
    const path = manifest.get(ref.getAttribute("idref"));
    if (!path) continue;
    const html = await zip.file(path)?.async("string");
    if (!html) continue;
    const doc = parser.parseFromString(html, "text/html");
    doc.querySelectorAll("script, style, nav").forEach((el) => el.remove());
    // Block elements become paragraphs so pauses land between them.
    const blocks = doc.body?.querySelectorAll(
      "p, h1, h2, h3, h4, h5, h6, li, blockquote, td, dt, dd"
    );
    let text;
    if (blocks?.length) {
      text = [...blocks].map((el) => el.textContent.trim()).filter(Boolean).join("\n\n");
    } else {
      text = doc.body?.textContent.trim() ?? "";
    }
    if (!text) continue;
    const title =
      titles.get(path) ??
      doc.querySelector("h1, h2, h3")?.textContent.replace(/\s+/g, " ").trim() ??
      "";
    sections.push({ title, text });
  }
  if (!sections.length) throw new Error("No readable text found in this EPUB");
  return sections;
}
