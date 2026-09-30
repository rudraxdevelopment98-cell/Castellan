import { describe, expect, it } from "vitest";
import {
  normaliseUkPostcode,
  parseUkDate,
  processField,
  sanitiseText,
  type FieldDefLite,
} from "@/server/pipeline/fieldtypes";

const f = (over: Partial<FieldDefLite> & { type: FieldDefLite["type"] }): FieldDefLite => ({
  apiName: "f",
  label: "Field",
  ...over,
});

describe("field registry: sanitise + normalise + validate", () => {
  it("sanitises text (trim, collapse spaces, NFC, strip controls)", () => {
    expect(sanitiseText("  a\u0000b   c  ")).toBe("ab c");
  });

  it("normalises UK postcodes (space before the 3-char inward code)", () => {
    expect(normaliseUkPostcode("e1 8ab")).toBe("E1 8AB");
    expect(normaliseUkPostcode("sw1a1aa")).toBe("SW1A 1AA");
    expect(normaliseUkPostcode("m11ae")).toBe("M1 1AE");
  });

  it("parses UK-first dates -> ISO (03/04/2027 => 3 April 2027)", () => {
    expect(parseUkDate("03/04/2027")).toBe("2027-04-03");
    expect(parseUkDate("2027-04-03")).toBe("2027-04-03");
    expect(parseUkDate("3.4.27")).toBe("2027-04-03");
    expect(parseUkDate("31/02/2027")).toBeNull(); // not a real date
    expect(parseUkDate("not a date")).toBeNull();
  });

  it("date field normalises and rejects bad input", () => {
    expect(processField("03/04/2027", f({ type: "date" }))).toEqual({ ok: true, value: "2027-04-03" });
    const bad = processField("nope", f({ type: "date" }));
    expect(bad.ok).toBe(false);
  });

  it("currency stores integer minor units", () => {
    expect(processField("£1,200.50", f({ type: "currency" }))).toEqual({ ok: true, value: 120050 });
    expect(processField(1200, f({ type: "currency" }))).toEqual({ ok: true, value: 120000 });
  });

  it("email lowercases and validates", () => {
    expect(processField("  Foo@Bar.COM ", f({ type: "email" }))).toEqual({ ok: true, value: "foo@bar.com" });
    expect(processField("nope", f({ type: "email" })).ok).toBe(false);
  });

  it("phone normalises to E.164 (GB default)", () => {
    expect(processField("020 7946 0000", f({ type: "phone" }))).toEqual({ ok: true, value: "+442079460000" });
    expect(processField("+1 415 555 0100", f({ type: "phone" }))).toEqual({ ok: true, value: "+14155550100" });
  });

  it("boolean accepts yes/no/true/false", () => {
    expect(processField("yes", f({ type: "boolean" }))).toEqual({ ok: true, value: true });
    expect(processField("0", f({ type: "boolean" }))).toEqual({ ok: true, value: false });
  });

  it("single_select maps label or id to option id; rejects unknown", () => {
    const field = f({ type: "single_select", config: { options: [{ id: "flat", label: "Flat" }, { id: "house", label: "House" }] } });
    expect(processField("Flat", field)).toEqual({ ok: true, value: "flat" });
    expect(processField("flat", field)).toEqual({ ok: true, value: "flat" });
    expect(processField("Castle", field).ok).toBe(false);
  });

  it("number honours min/max", () => {
    expect(processField("5", f({ type: "number", config: { min: 1, max: 10 } }))).toEqual({ ok: true, value: 5 });
    expect(processField("50", f({ type: "number", config: { max: 10 } })).ok).toBe(false);
  });

  it("url ensures a scheme", () => {
    expect(processField("example.com", f({ type: "url" }))).toEqual({ ok: true, value: "https://example.com/" });
  });

  it("required rejects empty, optional allows empty", () => {
    expect(processField("", f({ type: "text", required: true })).ok).toBe(false);
    expect(processField("", f({ type: "text" }))).toEqual({ ok: true, value: null });
  });

  it("address normalises an embedded postcode", () => {
    const res = processField({ line1: "1 High St", postcode: "e1 8ab" }, f({ type: "address" }));
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.value as { postcode: string }).postcode).toBe("E1 8AB");
  });
});
