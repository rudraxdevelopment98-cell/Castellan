import type { WorkspaceTemplate } from "../types";

/**
 * Home & personal documents.
 *
 * For individuals and households: keep passports, licences, insurance, MOT,
 * warranties and bills in one place, and get reminded before anything expires.
 * Personal reminders come from each document's key date (see the Documents area),
 * so this template ships no rules — just a simple "Item" to group documents
 * around (a car, the house, a phone, an appliance) plus the common document types.
 */
export const personalTemplate: WorkspaceTemplate = {
  id: "personal-home",
  name: "Home & personal documents",
  tagline: "Passports, licences, insurance, MOT, warranties and bills — never miss a renewal.",
  audience: "Individuals and households keeping track of important papers.",
  recordNoun: "Item",
  recordNounPlural: "Items",
  recordTypes: [
    {
      id: "item",
      name: "Item",
      fields: [
        {
          key: "category",
          label: "Category",
          type: "select",
          options: ["Vehicle", "Home", "Insurance", "Finance", "Identity", "Utilities", "Subscription", "Health", "Other"],
        },
        { key: "provider", label: "Provider / issuer", type: "text" },
        { key: "reference", label: "Reference / policy no.", type: "text" },
        { key: "renewal_date", label: "Renewal / expiry date", type: "date" },
        { key: "note", label: "Note", type: "text" },
      ],
    },
  ],
  documentTypes: [
    { id: "passport", name: "Passport", isBuiltin: true, fieldSchema: [
      { key: "number", label: "Passport no.", type: "text" },
      { key: "expiry_date", label: "Expiry", type: "date", critical: true },
    ]},
    { id: "driving_licence", name: "Driving licence", isBuiltin: true, fieldSchema: [
      { key: "number", label: "Licence no.", type: "text" },
      { key: "expiry_date", label: "Expiry", type: "date", critical: true },
    ]},
    { id: "insurance_policy", name: "Insurance policy", isBuiltin: true, fieldSchema: [
      { key: "insurer", label: "Insurer", type: "text" },
      { key: "policy_number", label: "Policy no.", type: "text" },
      { key: "renewal_date", label: "Renewal date", type: "date", critical: true },
    ]},
    { id: "mot_certificate", name: "MOT certificate", isBuiltin: true, fieldSchema: [
      { key: "registration", label: "Registration", type: "text" },
      { key: "expiry_date", label: "Expiry", type: "date", critical: true },
    ]},
    { id: "vehicle_tax", name: "Vehicle tax", isBuiltin: true, fieldSchema: [
      { key: "registration", label: "Registration", type: "text" },
      { key: "due_date", label: "Next due", type: "date", critical: true },
    ]},
    { id: "warranty", name: "Warranty / guarantee", isBuiltin: true, fieldSchema: [
      { key: "item", label: "Item", type: "text" },
      { key: "expiry_date", label: "Expires", type: "date", critical: true },
    ]},
    { id: "tenancy_or_mortgage", name: "Tenancy / mortgage", isBuiltin: true, fieldSchema: [
      { key: "provider", label: "Landlord / lender", type: "text" },
      { key: "key_date", label: "Renewal / fixed-rate ends", type: "date", critical: true },
    ]},
    { id: "utility_bill", name: "Utility / broadband", isBuiltin: true, fieldSchema: [
      { key: "provider", label: "Provider", type: "text" },
      { key: "contract_end", label: "Contract ends", type: "date", critical: true },
    ]},
    { id: "tv_licence", name: "TV licence", isBuiltin: true, fieldSchema: [
      { key: "expiry_date", label: "Expiry", type: "date", critical: true },
    ]},
    { id: "other_document", name: "Other document", isBuiltin: true, fieldSchema: [
      { key: "key_date", label: "Key date", type: "date", critical: true },
    ]},
  ],
  rules: [],
};
