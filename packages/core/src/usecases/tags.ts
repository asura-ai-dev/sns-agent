import type { SocialAccount, Tag } from "../domain/entities.js";
import { NotFoundError, ValidationError } from "../errors/domain-error.js";
import type { AccountRepository, TagListFilters, TagRepository } from "../interfaces/index.js";

export interface TagUsecaseDeps {
  accountRepo: AccountRepository;
  tagRepo: TagRepository;
}

export interface CreateTagInput {
  workspaceId: string;
  socialAccountId: string;
  name: string;
  color?: string | null;
}

export interface UpdateTagInput {
  workspaceId: string;
  tagId: string;
  name?: string;
  color?: string | null;
}

export interface FollowerTagUsecaseInput {
  workspaceId: string;
  socialAccountId: string;
  followerId: string;
  tagId: string;
}

async function loadXAccount(
  deps: TagUsecaseDeps,
  workspaceId: string,
  socialAccountId: string,
): Promise<SocialAccount> {
  const account = await deps.accountRepo.findById(socialAccountId);
  if (!account || account.workspaceId !== workspaceId) {
    throw new NotFoundError("SocialAccount", socialAccountId);
  }
  if (account.platform !== "x") {
    throw new ValidationError("Tags are only supported for X accounts");
  }
  return account;
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new ValidationError("tag name is required");
  }
  return trimmed;
}

async function assertUniqueName(
  deps: TagUsecaseDeps,
  workspaceId: string,
  socialAccountId: string,
  name: string,
  exceptTagId?: string,
): Promise<void> {
  const existing = await deps.tagRepo.findByWorkspace(workspaceId, { socialAccountId });
  if (existing.some((tag) => tag.id !== exceptTagId && tag.name === name)) {
    throw new ValidationError("Tag already exists for this X account");
  }
}

async function loadWorkspaceTag(
  deps: TagUsecaseDeps,
  workspaceId: string,
  tagId: string,
): Promise<Tag> {
  const tag = await deps.tagRepo.findById(tagId);
  if (!tag || tag.workspaceId !== workspaceId) {
    throw new NotFoundError("Tag", tagId);
  }
  return tag;
}

export async function listTags(
  deps: TagUsecaseDeps,
  workspaceId: string,
  filters: TagListFilters = {},
): Promise<Tag[]> {
  if (filters.socialAccountId) {
    await loadXAccount(deps, workspaceId, filters.socialAccountId);
  }
  return deps.tagRepo.findByWorkspace(workspaceId, filters);
}

export async function createTag(deps: TagUsecaseDeps, input: CreateTagInput): Promise<Tag> {
  await loadXAccount(deps, input.workspaceId, input.socialAccountId);
  const name = normalizeName(input.name);
  await assertUniqueName(deps, input.workspaceId, input.socialAccountId, name);
  return deps.tagRepo.create({
    workspaceId: input.workspaceId,
    socialAccountId: input.socialAccountId,
    name,
    color: input.color ?? null,
  });
}

export async function updateTag(deps: TagUsecaseDeps, input: UpdateTagInput): Promise<Tag> {
  const tag = await loadWorkspaceTag(deps, input.workspaceId, input.tagId);
  await loadXAccount(deps, input.workspaceId, tag.socialAccountId);
  const name = input.name === undefined ? undefined : normalizeName(input.name);
  if (name !== undefined) {
    await assertUniqueName(deps, input.workspaceId, tag.socialAccountId, name, tag.id);
  }
  return deps.tagRepo.update(tag.id, {
    ...(name !== undefined ? { name } : {}),
    ...(input.color !== undefined ? { color: input.color } : {}),
  });
}

export async function deleteTag(
  deps: TagUsecaseDeps,
  workspaceId: string,
  tagId: string,
): Promise<void> {
  const tag = await loadWorkspaceTag(deps, workspaceId, tagId);
  await loadXAccount(deps, workspaceId, tag.socialAccountId);
  await deps.tagRepo.delete(tag.id);
}

export async function attachFollowerTag(
  deps: TagUsecaseDeps,
  input: FollowerTagUsecaseInput,
): Promise<void> {
  const tag = await loadWorkspaceTag(deps, input.workspaceId, input.tagId);
  if (tag.socialAccountId !== input.socialAccountId) {
    throw new ValidationError("Tag does not belong to the selected X account");
  }
  await loadXAccount(deps, input.workspaceId, input.socialAccountId);
  await deps.tagRepo.attachToFollower(input);
}

export async function detachFollowerTag(
  deps: TagUsecaseDeps,
  input: FollowerTagUsecaseInput,
): Promise<void> {
  const tag = await loadWorkspaceTag(deps, input.workspaceId, input.tagId);
  if (tag.socialAccountId !== input.socialAccountId) {
    throw new ValidationError("Tag does not belong to the selected X account");
  }
  await loadXAccount(deps, input.workspaceId, input.socialAccountId);
  await deps.tagRepo.detachFromFollower(input);
}
