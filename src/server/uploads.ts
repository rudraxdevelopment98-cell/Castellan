/**
 * Upload inspection and safe download headers (AUDIT H13).
 *
 * Uploaded files are stored and served back from the application's own origin,
 * so a file must never be able to run as active content there. Three rules:
 *
 *  1. Only an allow-list of document and image types is accepted, by extension.
 *  2. The type we store comes from the file's CONTENT (magic bytes) for formats
 *     that have a signature — never from the browser-supplied Content-Type, which
 *     the uploader controls. Content that contradicts its extension is refused.
 *  3. On download, only passive formats (PDF and raster images) may render
 *     inline. Everything else is sent as an attachment under a sandboxing
 *     policy, and every response forbids MIME sniffing.
 */

export const MAX_FILENAME_LENGTH = 180;

/** Formats recognised by signature. `ext` lists the extensions each may carry. */
const SIGNED: { mime: string; ext: string[]; test: (b: Buffer) => boolean }[] = [
  { mime: "application/pdf", ext: ["pdf"], test: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  { mime: "image/png", ext: ["png"], test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", ext: ["jpg", "jpeg"], test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/gif", ext: ["gif"], test: (b) => ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("latin1")) },
  {
    mime: "image/webp",
    ext: ["webp"],
    test: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  },
];

/** Accepted formats without a reliable signature check; always downloaded, never rendered. */
const UNSIGNED: Record<string, string> = {
  txt: "text/plain",
  csv: "text/csv",
  rtf: "application/rtf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  heic: "image/heic",
  tif: "image/tiff",
  tiff: "image/tiff",
  eml: "message/rfc822",
  msg: "application/vnd.ms-outlook",
};

/** The only stored types a browser may render in place. */
const INLINE_SAFE = new Set(SIGNED.map((s) => s.mime));

export const ACCEPTED_EXTENSIONS: string[] = [...SIGNED.flatMap((s) => s.ext), ...Object.keys(UNSIGNED)].sort();

/** Strip any path, control characters and awkward punctuation from a client filename. */
export function safeFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "").normalize("NFC");
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, MAX_FILENAME_LENGTH);
  return cleaned || "document";
}

function extensionOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i > 0 ? filename.slice(i + 1).toLowerCase() : "";
}

export type UploadInspection =
  | { ok: true; filename: string; mime: string }
  | { ok: false; error: string };

/** Decide whether a file may be stored and what type it really is. */
export function inspectUpload(clientFilename: string, bytes: Buffer): UploadInspection {
  const filename = safeFilename(clientFilename);
  const ext = extensionOf(filename);
  const refused = `That file type is not supported. Accepted: ${ACCEPTED_EXTENSIONS.join(", ")}.`;
  if (!ext) return { ok: false, error: refused };

  const detected = SIGNED.find((s) => s.test(bytes));
  const declared = SIGNED.find((s) => s.ext.includes(ext));

  if (declared) {
    // The extension promises a signed format: the content must be that format.
    if (!detected || detected.mime !== declared.mime) {
      return { ok: false, error: `This file is not a valid .${ext} file.` };
    }
    return { ok: true, filename, mime: declared.mime };
  }

  const mime = UNSIGNED[ext];
  if (!mime) return { ok: false, error: refused };
  // An image or PDF renamed to another accepted extension is suspicious; refuse.
  if (detected) return { ok: false, error: `This file's content does not match its .${ext} extension.` };
  return { ok: true, filename, mime };
}

/** Response headers for sending a stored document back to its owner. */
export function downloadHeaders(mime: string, filename: string, size: number): Record<string, string> {
  const inline = INLINE_SAFE.has(mime);
  const name = safeFilename(filename);
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const headers: Record<string, string> = {
    // Never the stored string verbatim for unknown types: anything not on the
    // inline list is delivered as an opaque download.
    "Content-Type": inline ? mime : "application/octet-stream",
    "Content-Length": String(size),
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  };
  // Belt and braces for downloads: even if a browser were to render the
  // response, it would do so with no scripts, no network and a unique origin.
  if (!inline) headers["Content-Security-Policy"] = "default-src 'none'; sandbox";
  return headers;
}
