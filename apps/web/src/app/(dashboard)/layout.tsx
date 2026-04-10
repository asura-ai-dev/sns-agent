import { AppShell } from "@/components/layout";

// TODO: 認証チェックは後続タスクで実装
// async function checkAuth() { ... }

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
