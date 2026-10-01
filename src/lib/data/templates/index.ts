import type { WorkspaceTemplate } from "../types";
import { landlordTemplate } from "./landlord";
import { fleetTemplate, genericTemplate, restaurantTemplate } from "./business";
import { personalTemplate } from "./personal";

/**
 * The template registry. Adding a new use case is adding one entry here —
 * no engine changes. This is what makes Castellan work for personal use and
 * "any business" alike.
 */
export const templates: WorkspaceTemplate[] = [
  personalTemplate,
  landlordTemplate,
  restaurantTemplate,
  fleetTemplate,
  genericTemplate,
];

/** Which templates are for individuals vs organisations (for onboarding). */
export const PERSONAL_TEMPLATE_IDS = new Set<string>([personalTemplate.id]);

export function getTemplate(id: string): WorkspaceTemplate {
  const t = templates.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown template: ${id}`);
  return t;
}

export { personalTemplate, landlordTemplate, restaurantTemplate, fleetTemplate, genericTemplate };
