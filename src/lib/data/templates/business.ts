import type { ObligationRule } from "../../rules/types";
import type { WorkspaceTemplate } from "../types";

const V = "2026-09-30";

/**
 * Generic business templates. Same engine, different rule packs — proof that
 * Castellan is not a landlord tool but a document-and-deadline operations desk
 * for any business that must track paperwork and never miss a date.
 *
 * These rules are illustrative starting points, not legal advice — several are
 * marked needsVerification so a new customer confirms their own obligations.
 */

// --- Hospitality / food business -------------------------------------------
const restaurantRules: ObligationRule[] = [
  {
    code: "FOOD_HYGIENE_RATING",
    title: "Food hygiene rating",
    why: "Keep evidence current; re-inspections follow the risk rating.",
    appliesWhen: [{ kind: "always" }],
    triggerField: "FOOD_HYGIENE_RATING",
    cadence: { kind: "recurring_years", every: 1 },
    reminderLadderDays: [60, 30, 7],
    evidenceRequired: true,
    category: "Hygiene",
    lastVerified: V,
    enabled: true,
    needsVerification: true,
  },
  {
    code: "FIRE_RISK_ASSESSMENT",
    title: "Fire risk assessment",
    why: "Annual review of the premises fire risk assessment.",
    appliesWhen: [{ kind: "always" }],
    triggerField: "FIRE_RISK_ASSESSMENT",
    cadence: { kind: "recurring_years", every: 1 },
    reminderLadderDays: [60, 30, 7],
    evidenceRequired: true,
    category: "Fire",
    lastVerified: V,
    enabled: true,
  },
  {
    code: "PAT_TESTING",
    title: "Electrical (PAT / fixed wiring)",
    why: "Portable appliance and fixed-wiring checks per your policy.",
    appliesWhen: [{ kind: "always" }],
    triggerField: "PAT_TESTING",
    cadence: { kind: "recurring_years", every: 1 },
    reminderLadderDays: [30, 7],
    evidenceRequired: true,
    category: "Electric",
    lastVerified: V,
    enabled: true,
  },
  {
    code: "PREMISES_LICENCE",
    title: "Premises / alcohol licence",
    why: "Annual fee and any renewal conditions.",
    appliesWhen: [{ field: "sells_alcohol", op: "eq", value: true }],
    triggerField: "PREMISES_LICENCE",
    cadence: { kind: "recurring_years", every: 1 },
    reminderLadderDays: [60, 30, 7],
    evidenceRequired: false,
    category: "Licence",
    lastVerified: V,
    enabled: true,
  },
  {
    code: "PUBLIC_LIABILITY_INSURANCE",
    title: "Insurance renewal",
    why: "Public liability / buildings / contents renewal.",
    appliesWhen: [{ kind: "always" }],
    triggerField: "INSURANCE_END",
    cadence: { kind: "recurring_years", every: 1 },
    reminderLadderDays: [60, 30, 14, 7, 1],
    evidenceRequired: true,
    category: "Insurance",
    lastVerified: V,
    enabled: true,
  },
];

export const restaurantTemplate: WorkspaceTemplate = {
  id: "hospitality",
  name: "Hospitality / food business",
  tagline: "Hygiene, fire, licences and insurance across your sites.",
  audience: "Restaurants, cafés and multi-site food businesses.",
  recordNoun: "Site",
  recordNounPlural: "Sites",
  recordTypes: [
    {
      id: "site",
      name: "Site",
      fields: [
        { key: "postcode", label: "Postcode", type: "text" },
        { key: "sells_alcohol", label: "Sells alcohol", type: "boolean" },
        { key: "covers", label: "Covers", type: "number" },
      ],
    },
  ],
  documentTypes: [
    { id: "hygiene_cert", name: "Hygiene certificate", isBuiltin: true, fieldSchema: [
      { key: "rating", label: "Rating", type: "text" },
      { key: "inspection_date", label: "Inspected", type: "date", critical: true },
    ]},
    { id: "insurance_schedule", name: "Insurance schedule", isBuiltin: true, fieldSchema: [
      { key: "insurer", label: "Insurer", type: "text" },
      { key: "end_date", label: "Renewal date", type: "date", critical: true },
    ]},
  ],
  rules: restaurantRules,
};

// --- Fleet / vehicles ------------------------------------------------------
const fleetRules: ObligationRule[] = [
  {
    code: "MOT",
    title: "MOT test",
    why: "Annual roadworthiness test; driving without it is an offence.",
    appliesWhen: [{ kind: "always" }],
    triggerField: "MOT",
    cadence: { kind: "recurring_years", every: 1 },
    reminderLadderDays: [30, 14, 7, 1],
    evidenceRequired: true,
    category: "MOT",
    lastVerified: V,
    enabled: true,
  },
  {
    code: "VEHICLE_INSURANCE",
    title: "Vehicle insurance",
    why: "Continuous insurance is a legal requirement.",
    appliesWhen: [{ kind: "always" }],
    triggerField: "INSURANCE_END",
    cadence: { kind: "recurring_years", every: 1 },
    reminderLadderDays: [30, 14, 7, 1],
    evidenceRequired: true,
    category: "Insurance",
    lastVerified: V,
    enabled: true,
  },
  {
    code: "ROAD_TAX",
    title: "Vehicle tax (VED)",
    why: "Renew vehicle tax; DVLA penalties for a lapse.",
    appliesWhen: [{ kind: "always" }],
    triggerField: "ROAD_TAX",
    cadence: { kind: "recurring_months", every: 12 },
    reminderLadderDays: [30, 7, 1],
    evidenceRequired: false,
    category: "Tax",
    lastVerified: V,
    enabled: true,
  },
  {
    code: "SERVICE",
    title: "Scheduled service",
    why: "Manufacturer service interval to protect warranty and safety.",
    appliesWhen: [{ kind: "always" }],
    triggerField: "SERVICE",
    cadence: { kind: "recurring_months", every: 12 },
    reminderLadderDays: [30, 7],
    evidenceRequired: true,
    category: "Service",
    lastVerified: V,
    enabled: true,
  },
];

export const fleetTemplate: WorkspaceTemplate = {
  id: "fleet",
  name: "Vehicle fleet",
  tagline: "MOT, tax, insurance and servicing for every vehicle.",
  audience: "Any business running a fleet of vehicles.",
  recordNoun: "Vehicle",
  recordNounPlural: "Vehicles",
  recordTypes: [
    {
      id: "vehicle",
      name: "Vehicle",
      fields: [
        { key: "make", label: "Make", type: "text" },
        { key: "model", label: "Model", type: "text" },
        { key: "year", label: "Year", type: "number" },
      ],
    },
  ],
  documentTypes: [
    { id: "mot_cert", name: "MOT certificate", isBuiltin: true, fieldSchema: [
      { key: "test_date", label: "Test date", type: "date", critical: true },
      { key: "expiry", label: "Expiry", type: "date", critical: true },
    ]},
  ],
  rules: fleetRules,
};

// --- Generic business (contracts, certs, renewals) -------------------------
const genericRules: ObligationRule[] = [
  {
    code: "CONTRACT_RENEWAL",
    title: "Contract / subscription renewal",
    why: "Review before auto-renewal or notice deadline.",
    appliesWhen: [{ kind: "always" }],
    triggerField: "CONTRACT_END",
    cadence: { kind: "recurring_years", every: 1 },
    reminderLadderDays: [90, 30, 7],
    evidenceRequired: false,
    category: "Contracts",
    lastVerified: V,
    enabled: true,
  },
  {
    code: "INSURANCE_RENEWAL",
    title: "Insurance renewal",
    why: "Keep cover continuous.",
    appliesWhen: [{ kind: "always" }],
    triggerField: "INSURANCE_END",
    cadence: { kind: "recurring_years", every: 1 },
    reminderLadderDays: [60, 30, 14, 7, 1],
    evidenceRequired: true,
    category: "Insurance",
    lastVerified: V,
    enabled: true,
  },
  {
    code: "CERTIFICATION",
    title: "Certification / accreditation",
    why: "ISO, membership or accreditation renewal.",
    appliesWhen: [{ kind: "always" }],
    triggerField: "CERTIFICATION",
    cadence: { kind: "recurring_years", every: 1 },
    reminderLadderDays: [90, 30, 7],
    evidenceRequired: true,
    category: "Certification",
    lastVerified: V,
    enabled: true,
    needsVerification: true,
  },
  {
    code: "LICENCE_PERMIT",
    title: "Licence / permit",
    why: "Operating licence or permit renewal.",
    appliesWhen: [{ kind: "always" }],
    triggerField: "LICENCE_PERMIT",
    cadence: { kind: "recurring_years", every: 1 },
    reminderLadderDays: [60, 30, 7],
    evidenceRequired: false,
    category: "Licence",
    lastVerified: V,
    enabled: true,
  },
];

export const genericTemplate: WorkspaceTemplate = {
  id: "generic-business",
  name: "General business",
  tagline: "Track any document with a date, and get told before it expires.",
  audience: "Any business tracking contracts, certificates and renewals.",
  recordNoun: "Record",
  recordNounPlural: "Records",
  recordTypes: [
    {
      id: "record",
      name: "Record",
      fields: [
        { key: "category", label: "Category", type: "text" },
        { key: "owner", label: "Internal owner", type: "text" },
      ],
    },
  ],
  documentTypes: [
    { id: "generic_doc", name: "Document", isBuiltin: true, fieldSchema: [
      { key: "title", label: "Title", type: "text" },
      { key: "expiry", label: "Expiry / renewal date", type: "date", critical: true },
    ]},
  ],
  rules: genericRules,
};
