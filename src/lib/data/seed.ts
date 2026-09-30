import { addDays, addMonths, type IsoDate } from "../rules/dates";
import type { TrackedRecord } from "../rules/types";
import type { TrackedDocument, User } from "./types";

/**
 * Deterministic demo data. A seeded PRNG makes the whole demo stable: the
 * Today list, the matrix and the review queue look the same on every load,
 * which matters for screenshots and acceptance tests.
 *
 * All names and addresses are fictional (seed_data_for_demo instruction).
 */

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BOROUGHS: { name: string; districts: string[] }[] = [
  { name: "Tower Hamlets", districts: ["E1", "E2", "E3", "E14"] },
  { name: "Hackney", districts: ["E5", "E8", "E9", "N1", "N16"] },
  { name: "Newham", districts: ["E6", "E7", "E13", "E15"] },
  { name: "Southwark", districts: ["SE1", "SE5", "SE15", "SE16"] },
  { name: "Lambeth", districts: ["SW2", "SW4", "SW8", "SW9"] },
  { name: "Camden", districts: ["NW1", "NW3", "NW5", "WC1"] },
  { name: "Ealing", districts: ["W3", "W5", "W7", "W13"] },
];

const STREETS = [
  "Cable Street", "Mare Street", "Elm Road", "Cornwall Avenue", "Bethnal Green Road",
  "Brick Lane", "Roman Road", "Chatsworth Road", "Rye Lane", "Coldharbour Lane",
  "Acre Lane", "Camden High Street", "Prince of Wales Road", "Uxbridge Road",
  "Well Street", "Dalston Lane", "Green Lanes", "Old Kent Road", "Walworth Road",
  "Kentish Town Road", "Hanwell Broadway", "The Grove", "Victoria Park Road",
];

const ENTITIES = ["A. Whitmore (personal)", "Castellan Estates Ltd", "Marlow Holdings Ltd"];
const EPC_RATINGS = ["B", "C", "C", "D", "D", "D", "E", "E", "F"]; // ~40% D or below

export function seedLandlordRecords(count = 520): TrackedRecord[] {
  const rnd = mulberry32(20260930);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]!;

  const records: TrackedRecord[] = [];
  for (let i = 0; i < count; i++) {
    const borough = pick(BOROUGHS);
    const district = pick(borough.districts);
    const houseNo = 1 + Math.floor(rnd() * 240);
    const street = pick(STREETS);
    const postcode = `${district} ${1 + Math.floor(rnd() * 9)}${String.fromCharCode(65 + Math.floor(rnd() * 26))}${String.fromCharCode(65 + Math.floor(rnd() * 26))}`;
    const isHmo = i < 30; // 30 HMOs
    const type = isHmo ? "HMO" : rnd() > 0.55 ? "House" : "Flat";
    const hasGas = rnd() > 0.15;
    const epc = pick(EPC_RATINGS);
    const hasMortgage = rnd() > 0.3;
    const depositAmount = 1000 + Math.floor(rnd() * 40) * 100;

    // "Last done" dates seeded a comfortable distance into the current cycle so
    // most obligations are valid and Today stays a focused daily plan. Expiry
    // dates (insurance, licence) are pushed into the future — a well-run
    // portfolio renews on time — with a curated handful of urgent items added
    // deliberately below to drive the demo narrative.
    const gasLast = addDays("2026-09-30", -Math.floor(rnd() * 300)); // due within ~2 months..1yr
    const eicrLast = addDays("2026-09-30", -Math.floor(rnd() * 365 * 4));
    const epcLast = addDays("2026-09-30", -Math.floor(rnd() * 365 * 8));
    const insuranceEnd = addDays("2026-09-30", 20 + Math.floor(rnd() * 330)); // future
    const hmoExpiry = addDays("2026-09-30", 40 + Math.floor(rnd() * 365 * 3)); // future

    const triggers: TrackedRecord["triggers"] = {
      GAS_SAFETY: hasGas ? gasLast : undefined,
      EICR: eicrLast,
      EPC: epcLast,
      LEGIONELLA: addDays("2026-09-30", -Math.floor(rnd() * 365 * 2)),
      SMOKE_CO_ALARMS: addDays("2026-09-30", -Math.floor(rnd() * 300)),
      INSURANCE_END: insuranceEnd,
      HMO_LICENCE_EXPIRY: isHmo ? hmoExpiry : undefined,
    };

    if (depositAmount > 0) {
      // Established tenancies protected their deposit on time in the past
      // (one-off obligation, long since satisfied → shows valid in the matrix).
      triggers.DEPOSIT_PROTECTION = addDays("2026-09-30", -(120 + Math.floor(rnd() * 800)));
    }
    if (hasMortgage) {
      triggers.MORTGAGE_PRODUCT_END = addDays("2026-09-30", 30 + Math.floor(rnd() * 870));
    }

    records.push({
      id: `p${i + 1}`,
      label: `${houseNo} ${street}`,
      sublabel: postcode,
      recordTypeId: "property",
      fields: {
        postcode,
        borough: borough.name,
        region: "London",
        type,
        bedrooms: isHmo ? 3 + Math.floor(rnd() * 5) : 1 + Math.floor(rnd() * 3),
        has_gas: hasGas,
        is_hmo: isHmo,
        has_common_parts: isHmo || rnd() > 0.9,
        needs_selective_licence: !isHmo && rnd() > 0.85,
        epc_rating: epc,
        rent_pcm: 900 + Math.floor(rnd() * 30) * 100,
        deposit_amount: depositAmount,
        has_mortgage: hasMortgage,
        ownership_entity: pick(ENTITIES),
        key_safe_code: `••••`, // sensitive; masked in demo
      },
      triggers,
    });
  }

  // --- Curated urgent items, so the demo's Today mirrors the spec narrative ---
  // Missing evidence (gaps in the matrix, surfaced on Today).
  if (records[3]) records[3].triggers.GAS_SAFETY = undefined;
  if (records[7]) records[7].triggers.INSURANCE_END = undefined; // uninsured!

  // An overdue gas check (spec: "Gas check at 22 Cable Street, due 27 Sep").
  const set = (i: number, key: string, iso: IsoDate) => {
    if (records[i]) records[i]!.triggers[key] = iso;
  };
  set(0, "GAS_SAFETY", addMonths("2026-09-27", -12)); // due 2026-09-27 (overdue by 3)
  set(1, "DEPOSIT_PROTECTION", addDays("2026-09-30", -29)); // deposit due tomorrow
  set(6, "DEPOSIT_PROTECTION", addDays("2026-09-30", -20)); // deposit clock running (due +10)
  set(9, "DEPOSIT_PROTECTION", addDays("2026-09-30", -27)); // deposit clock running (due +3)
  set(2, "INSURANCE_END", "2026-10-30"); // Aldgate-style renewal, ~30 days out
  set(4, "EICR", addMonths("2026-09-30", -60 + 1)); // EICR due in ~1 month -> "book now"
  set(5, "GAS_SAFETY", addMonths("2026-11-01", -12)); // due 2026-11-01 (rung fires soon)
  set(8, "INSURANCE_END", "2026-09-26"); // lapsed 4 days ago (overdue, uninsured risk)

  return records;
}

export const demoUsers: User[] = [
  { id: "u_owner", name: "You (owner)", role: "owner" },
  { id: "u_ravi", name: "Ravi (office manager)", role: "staff" },
  { id: "u_amara", name: "Amara (property manager)", role: "staff" },
  { id: "u_book", name: "Bookkeeper", role: "accountant" },
];

/** A handful of documents sitting in the review queue (needs_review). */
export function seedLandlordDocuments(records: TrackedRecord[]): TrackedDocument[] {
  const r0 = records[0]?.label ?? "22 Cable Street";
  return [
    {
      id: "d1",
      fileName: "gas_cert_scan_0142.pdf",
      documentTypeId: "gas_safety_record",
      documentTypeGuesses: [
        { typeId: "gas_safety_record", confidence: 0.97 },
        { typeId: "eicr", confidence: 0.02 },
      ],
      status: "needs_review",
      recordMatchSuggestions: [
        { recordId: records[3]?.id ?? "p4", confidence: 0.91 },
        { recordId: records[12]?.id ?? "p13", confidence: 0.05 },
      ],
      uploadedAt: "2026-09-30",
      suppliesTriggerFor: "GAS_SAFETY",
      extracted: [
        { key: "inspection_date", label: "Inspection date", value: "2026-09-28", confidence: 0.98, page: 1, snippet: "Date of inspection: 28/09/2026", confirmed: false },
        { key: "engineer_name", label: "Engineer", value: "M. Okafor", confidence: 0.95, page: 1, snippet: "Engineer: M. Okafor", confirmed: false },
        { key: "gas_safe_number", label: "Gas Safe no.", value: "512834", confidence: 0.88, page: 1, snippet: "Gas Safe Reg: 512834", confirmed: false },
        { key: "next_due_date", label: "Next due", value: "2027-09-28", confidence: 0.72, page: 2, snippet: "Next inspection due: 28/09/2027", confirmed: false },
      ],
    },
    {
      id: "d2",
      fileName: "aldgate_block_insurance.pdf",
      documentTypeId: "insurance_schedule",
      documentTypeGuesses: [{ typeId: "insurance_schedule", confidence: 0.94 }],
      status: "needs_review",
      recordMatchSuggestions: [{ recordId: records[7]?.id ?? "p8", confidence: 0.83 }],
      uploadedAt: "2026-09-29",
      suppliesTriggerFor: "INSURANCE_END",
      extracted: [
        { key: "insurer", label: "Insurer", value: "Aviva", confidence: 0.96, page: 1, snippet: "Insurer: Aviva plc", confirmed: false },
        { key: "policy_number", label: "Policy no.", value: "LL-88213-A", confidence: 0.9, page: 1, confirmed: false },
        { key: "premium", label: "Premium", value: "4820.00", confidence: 0.86, page: 1, snippet: "Total premium: £4,820.00", confirmed: false },
        { key: "end_date", label: "Renewal date", value: "2026-10-30", confidence: 0.79, page: 1, snippet: "Cover to: 30 Oct 2026", confirmed: false },
        { key: "unoccupancy_days", label: "Unoccupancy limit (days)", value: "30", confidence: 0.61, page: 3, snippet: "unoccupied for more than 30 consecutive days", confirmed: false },
      ],
    },
    {
      id: "d3",
      fileName: "eicr_scan_march.pdf",
      documentTypeId: "eicr",
      status: "confirmed",
      recordId: records[1]?.id,
      uploadedAt: "2026-09-20",
      suppliesTriggerFor: "EICR",
      extracted: [
        { key: "inspection_date", label: "Inspection date", value: "2026-03-11", confidence: 0.99, page: 1, confirmed: true },
        { key: "overall_result", label: "Result", value: "Satisfactory", confidence: 0.97, page: 1, confirmed: true },
        { key: "next_inspection_date", label: "Next inspection", value: "2031-03-11", confidence: 0.95, page: 1, confirmed: true },
      ],
    },
    {
      id: "d4",
      fileName: "unknown_scan_5571.jpg",
      documentTypeId: "tenancy_agreement",
      documentTypeGuesses: [
        { typeId: "tenancy_agreement", confidence: 0.54 },
        { typeId: "licence", confidence: 0.31 },
        { typeId: "epc", confidence: 0.08 },
      ],
      status: "received",
      uploadedAt: "2026-09-30",
      extracted: [],
    },
  ];
}
