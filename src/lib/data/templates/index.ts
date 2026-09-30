import type { WorkspaceTemplate } from "../types";
import { landlordTemplate } from "./landlord";
import { fleetTemplate, genericTemplate, restaurantTemplate } from "./business";

/**
 * The template registry. Adding a new industry is adding one entry here —
 * no engine changes. This is what makes Castellan work for "any business".
 */
export const templates: WorkspaceTemplate[] = [
  landlordTemplate,
  restaurantTemplate,
  fleetTemplate,
  genericTemplate,
];

export function getTemplate(id: string): WorkspaceTemplate {
  const t = templates.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown template: ${id}`);
  return t;
}

export { landlordTemplate, restaurantTemplate, fleetTemplate, genericTemplate };
