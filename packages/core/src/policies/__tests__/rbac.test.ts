import { describe, expect, it } from "vitest";
import { ROLES } from "@sns-agent/config";
import {
  checkPermission,
  rolePermissions,
  xHarnessApiKeyScopeMapping,
  xHarnessStaffRoleMapping,
} from "../rbac.js";

describe("X Harness staff/API key parity", () => {
  it("documents each X Harness staff role as an existing sns-agent role", () => {
    expect(xHarnessStaffRoleMapping).toEqual({
      owner: "owner",
      admin: "admin",
      editor: "editor",
      viewer: "viewer",
    });

    for (const role of Object.values(xHarnessStaffRoleMapping)) {
      expect(ROLES).toContain(role);
      expect(role).not.toBe("agent");
    }
  });

  it("documents API key scopes as agent identity roles backed by RBAC permissions", () => {
    expect(xHarnessApiKeyScopeMapping).toEqual({
      read: {
        agentIdentityRole: "viewer",
        permissions: ["account:read", "post:read", "schedule:read", "usage:read", "inbox:read"],
      },
      compose: {
        agentIdentityRole: "operator",
        permissions: ["post:create", "chat:use"],
      },
      engage: {
        agentIdentityRole: "agent",
        permissions: ["post:create", "inbox:reply"],
      },
      publish: {
        agentIdentityRole: "editor",
        permissions: ["post:publish", "schedule:create", "inbox:reply"],
      },
    });

    for (const { agentIdentityRole, permissions } of Object.values(xHarnessApiKeyScopeMapping)) {
      expect(rolePermissions[agentIdentityRole]).toEqual(expect.arrayContaining(permissions));
      for (const permission of permissions) {
        expect(checkPermission(agentIdentityRole, permission)).toBe(true);
      }
    }
  });
});
