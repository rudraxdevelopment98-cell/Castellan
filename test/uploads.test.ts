import { describe, expect, it } from "vitest";
import { downloadHeaders, inspectUpload, safeFilename } from "@/server/uploads";

/**
 * AUDIT H13: an uploaded file must never be able to run as active content on
 * the application's origin. The stored type comes from the file's content, only
 * an allow-list is accepted, and only passive formats may render inline.
 */

const PDF = Buffer.from("%PDF-1.7\n...");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("rest")]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const HTML = Buffer.from("<!doctype html><script>fetch('/api/export?slug=x')</script>");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe("upload inspection (AUDIT H13)", () => {
  it("accepts real PDFs and images and records the type from their content", () => {
    expect(inspectUpload("policy.pdf", PDF)).toEqual({ ok: true, filename: "policy.pdf", mime: "application/pdf" });
    expect(inspectUpload("photo.PNG", PNG)).toMatchObject({ ok: true, mime: "image/png" });
    expect(inspectUpload("scan.jpeg", JPEG)).toMatchObject({ ok: true, mime: "image/jpeg" });
  });

  it.each([
    ["page.html", HTML],
    ["page.htm", HTML],
    ["logo.svg", SVG],
    ["run.js", Buffer.from("alert(1)")],
    ["tool.exe", Buffer.from("MZ")],
    ["noextension", PDF],
  ])("refuses %s", (name, bytes) => {
    expect(inspectUpload(name, bytes).ok).toBe(false);
  });

  it("refuses active content disguised with a safe extension", () => {
    expect(inspectUpload("innocent.png", HTML).ok).toBe(false);
    expect(inspectUpload("innocent.pdf", SVG).ok).toBe(false);
    expect(inspectUpload("innocent.jpg", PNG).ok).toBe(false); // wrong signature for the extension
  });

  it("accepts office documents, which are only ever downloaded", () => {
    const res = inspectUpload("lease.docx", Buffer.from("PK\u0003\u0004..."));
    expect(res).toMatchObject({ ok: true, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  });

  it("reduces a hostile filename to a plain name", () => {
    expect(safeFilename("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(safeFilename("C:\\Users\\me\\tax return.pdf")).toBe("tax return.pdf");
    expect(safeFilename('evil"\r\nSet-Cookie: x=1.pdf')).not.toMatch(/["\r\n]/);
    expect(safeFilename("...")).toBe("document");
    expect(safeFilename("a".repeat(400) + ".pdf").length).toBeLessThanOrEqual(180);
  });
});

describe("download headers (AUDIT H13)", () => {
  it("renders PDFs and raster images inline, with sniffing disabled", () => {
    const h = downloadHeaders("application/pdf", "policy.pdf", 10);
    expect(h["Content-Type"]).toBe("application/pdf");
    expect(h["Content-Disposition"]).toMatch(/^inline;/);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
  });

  it.each(["text/html", "image/svg+xml", "text/plain", "application/xhtml+xml", "text/javascript", ""])(
    "forces a stored type of %j to download as an opaque, sandboxed file",
    (mime) => {
      const h = downloadHeaders(mime, "file.bin", 10);
      expect(h["Content-Type"]).toBe("application/octet-stream");
      expect(h["Content-Disposition"]).toMatch(/^attachment;/);
      expect(h["X-Content-Type-Options"]).toBe("nosniff");
      expect(h["Content-Security-Policy"]).toBe("default-src 'none'; sandbox");
    },
  );

  it("cannot be broken out of with a crafted filename", () => {
    const h = downloadHeaders("application/pdf", 'a"; filename="x.html\r\nX-Injected: 1', 10);
    const disposition = h["Content-Disposition"] ?? "";
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(disposition.match(/"/g)?.length).toBe(2); // only the two quotes we wrote
  });
});
