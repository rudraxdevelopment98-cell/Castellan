import type { ObligationRule, TrackedRecord } from "../rules/types";

/**
 * Application-level data model (the shape the UI reads). In production these
 * map to the PostgreSQL tables in the spec's data_model, with row-level
 * security by account_id. For the Phase-1 demo they are served from an
 * in-memory seed store (see store.ts) so the app runs with no database.
 */

export type UserRole = "owner" | "admin" | "staff" | "accountant" | "contractor";

export interface User {
  id: string;
  name: string;
  role: UserRole;
  /** Staff only see records assigned to them (spec acceptance test). */
  assignedRecordIds?: string[];
}

/** A workspace = one customer account, shaped by a template. */
export interface Workspace {
  id: string;
  name: string;
  templateId: string;
  dataRegion: string; // UK by default
  /** The noun this business tracks, e.g. "Property", "Vehicle", "Location". */
  recordNoun: string;
  recordNounPlural: string;
}

/** A kind of tracked thing, with the custom fields it carries. */
export interface RecordType {
  id: string;
  name: string;
  icon?: string;
  fields: CustomFieldDef[];
}

export interface CustomFieldDef {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "date" | "select";
  options?: string[];
  /** Encrypted at rest (e.g. key safe code, account reference). */
  sensitive?: boolean;
}

export type DocumentStatus = "received" | "read" | "needs_review" | "confirmed";

export interface DocumentType {
  id: string;
  name: string;
  isBuiltin: boolean;
  /** Fields the extractor pulls, with the trigger date it seeds. */
  fieldSchema: ExtractedFieldDef[];
}

export interface ExtractedFieldDef {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "money";
  /** Whether this field is a legal date/money that always needs human review. */
  critical?: boolean;
}

export interface ExtractedField {
  key: string;
  label: string;
  value: string;
  confidence: number; // 0..1
  page: number;
  snippet?: string; // where it was found (evidence)
  confirmed: boolean;
}

export interface TrackedDocument {
  id: string;
  fileName: string;
  documentTypeId: string;
  documentTypeGuesses?: { typeId: string; confidence: number }[];
  status: DocumentStatus;
  recordId?: string;
  recordMatchSuggestions?: { recordId: string; confidence: number }[];
  uploadedAt: string;
  extracted: ExtractedField[];
  supersedesDocumentId?: string;
  /** Which rule's trigger date this document supplies when confirmed. */
  suppliesTriggerFor?: string;
}

/** A complete, self-contained template that shapes a workspace. */
export interface WorkspaceTemplate {
  id: string;
  name: string;
  tagline: string;
  audience: string;
  recordNoun: string;
  recordNounPlural: string;
  recordTypes: RecordType[];
  documentTypes: DocumentType[];
  rules: ObligationRule[];
}

/** Everything the demo store hands to the UI for one workspace. */
export interface WorkspaceData {
  workspace: Workspace;
  template: WorkspaceTemplate;
  users: User[];
  records: TrackedRecord[];
  documents: TrackedDocument[];
}
