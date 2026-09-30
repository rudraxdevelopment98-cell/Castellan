"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { createWorkspaceSchema, inviteSchema, slugify } from "@/server/validation";
import {
  getMembershipsForUser,
  resolveWorkspaceForUser,
  uniqueWorkspaceSlug,
} from "@/server/context";
import { acceptInvite, createWorkspaceWithOwner, inviteMember } from "@/server/tenancy";
import { applyTemplateToWorkspace } from "@/server/templates_apply";
import { requireUser } from "@/server/session";
import { PermissionError } from "@/server/rbac";

export async function createWorkspaceAction(formData: FormData): Promise<void> {
  const user = await requireUser("/onboarding");
  const parsed = createWorkspaceSchema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone") || undefined,
    currency: formData.get("currency") || undefined,
    template: formData.get("template") || undefined,
  });
  if (!parsed.success) {
    redirect(`/onboarding?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Check your details.")}`);
  }
  const db = await getDb();
  const slug = await uniqueWorkspaceSlug(slugify(parsed.data.name));
  await createWorkspaceWithOwner(db, {
    ownerUserId: user.id,
    name: parsed.data.name,
    slug,
    timezone: parsed.data.timezone,
    currency: parsed.data.currency,
    defaultTemplate: parsed.data.template,
  });
  // Materialise the chosen template's objects/fields (+ sample data) so the new
  // workspace has something in the grid immediately.
  if (parsed.data.template) {
    try {
      await applyTemplateToWorkspace(db, {
        workspaceId: (await resolveWorkspaceForUser(user.id, slug))!.workspaceId,
        actorUserId: user.id,
        templateId: parsed.data.template,
        withSamples: formData.get("samples") === "on",
      });
    } catch (e) {
      console.error("template apply failed:", e);
    }
  }
  redirect(`/w/${slug}`);
}

export async function inviteMemberAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const slug = String(formData.get("slug") ?? "");
  const membership = await resolveWorkspaceForUser(user.id, slug);
  if (!membership) redirect("/signin");

  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role") || undefined,
  });
  if (!parsed.success) {
    redirect(`/w/${slug}/members?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Check the email.")}`);
  }

  const db = await getDb();
  try {
    const { token } = await inviteMember(db, {
      workspaceId: membership!.workspaceId,
      actorUserId: user.id,
      email: parsed.data.email,
      role: parsed.data.role,
    });
    // In production this link is emailed. In local dev (no mail) surface it so
    // the invite can be tested end-to-end.
    const link = `/invite/${token}`;
    redirect(`/w/${slug}/members?invited=${encodeURIComponent(parsed.data.email)}&link=${encodeURIComponent(link)}`);
  } catch (e) {
    if (e instanceof PermissionError) {
      redirect(`/w/${slug}/members?error=${encodeURIComponent("You do not have permission to invite members.")}`);
    }
    throw e;
  }
}

export async function createObjectAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const slug = String(formData.get("slug") ?? "");
  const membership = await resolveWorkspaceForUser(user.id, slug);
  if (!membership) redirect("/signin");
  const db = await getDb();
  const singular = String(formData.get("singular") ?? "").trim();
  const plural = String(formData.get("plural") ?? "").trim() || `${singular}s`;
  const apiName = String(formData.get("apiName") ?? "").trim().toLowerCase();
  try {
    const { objectId } = await import("@/server/metadata").then((m) =>
      m.createObject(db, {
        workspaceId: membership!.workspaceId, actorUserId: user.id, apiName,
        singularLabel: singular, pluralLabel: plural, titleFieldApiName: "name",
      }),
    );
    await import("@/server/metadata").then((m) =>
      m.addField(db, { workspaceId: membership!.workspaceId, actorUserId: user.id, objectId, apiName: "name", label: `${singular} name`, type: "text", required: true, position: 0 }),
    );
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    redirect(`/w/${slug}/data?error=${encodeURIComponent(e instanceof Error ? e.message : "Could not create object")}`);
  }
  redirect(`/w/${slug}/data`);
}

export async function addFieldAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const slug = String(formData.get("slug") ?? "");
  const membership = await resolveWorkspaceForUser(user.id, slug);
  if (!membership) redirect("/signin");
  const db = await getDb();
  const objectId = String(formData.get("objectId") ?? "");
  const type = String(formData.get("type") ?? "text");
  const optionsRaw = String(formData.get("options") ?? "").trim();
  const options = optionsRaw ? optionsRaw.split(",").map((s) => s.trim()).filter(Boolean).map((o) => ({ id: o, label: o })) : undefined;
  try {
    await import("@/server/metadata").then((m) =>
      m.addField(db, {
        workspaceId: membership!.workspaceId, actorUserId: user.id, objectId,
        apiName: String(formData.get("apiName") ?? "").trim().toLowerCase(),
        label: String(formData.get("label") ?? "").trim(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: type as any,
        required: formData.get("required") === "on",
        unique: formData.get("unique") === "on",
        config: options ? { options } : undefined,
        filterable: true,
      }),
    );
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    redirect(`/w/${slug}/data?error=${encodeURIComponent(e instanceof Error ? e.message : "Could not add field")}`);
  }
  redirect(`/w/${slug}/data`);
}

export async function acceptInviteAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const user = await requireUser(`/invite/${token}`);
  const db = await getDb();
  let target: string;
  try {
    const { workspaceId } = await acceptInvite(db, { token, userId: user.id });
    const wss = await getMembershipsForUser(user.id);
    const slug = wss.find((w) => w.workspaceId === workspaceId)?.slug;
    target = slug ? `/w/${slug}` : "/onboarding";
  } catch (e) {
    // redirect() throws NEXT_REDIRECT; never swallow it as an invite error.
    if (e && typeof e === "object" && "digest" in e && String((e as { digest?: string }).digest).startsWith("NEXT_REDIRECT")) {
      throw e;
    }
    console.error("acceptInvite failed:", e);
    redirect(`/invite/${token}?error=${encodeURIComponent("This invitation is invalid or has expired.")}`);
  }
  redirect(target);
}
