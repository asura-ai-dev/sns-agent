/**
 * policies/ バレルエクスポート
 */
export { PERMISSIONS, rolePermissions, checkPermission } from "./rbac.js";
export type { Permission } from "./rbac.js";

export { requiresApproval, DEFAULT_APPROVAL_POLICY } from "./approval.js";
export type { ApprovalAction, ApprovalContext, ApprovalPolicyConfig } from "./approval.js";
