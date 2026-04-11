/**
 * 設定トップページ
 *
 * Task 3008: /settings
 * デフォルトカテゴリである「アカウント接続」にリダイレクトする。
 * SettingsShell の左ナビでカテゴリを切り替える運用のため、
 * トップ URL は alias として扱う。
 */
import { redirect } from "next/navigation";

export default function SettingsPage() {
  redirect("/settings/accounts");
}
