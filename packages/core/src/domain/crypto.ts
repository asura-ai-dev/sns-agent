/**
 * 暗号化ユーティリティ - AES-256-GCM
 *
 * design.md セクション 8 に準拠。
 * OAuth トークン、LLM API キー等の暗号化・復号に使用する。
 */
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM 推奨 96 bits
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * AES-256-GCM で平文を暗号化する。
 *
 * 出力形式: base64( IV || ciphertext || authTag )
 *
 * @param plaintext - 暗号化対象の平文
 * @param key - 256-bit (32 bytes) の暗号化キー（hex 文字列）
 * @returns base64 エンコードされた暗号文
 */
export function encrypt(plaintext: string, key: string): string {
  const keyBuffer = Buffer.from(key, "hex");
  if (keyBuffer.length !== 32) {
    throw new Error("Encryption key must be 32 bytes (64 hex characters)");
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keyBuffer, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // IV || ciphertext || authTag
  const combined = Buffer.concat([iv, encrypted, authTag]);
  return combined.toString("base64");
}

/**
 * AES-256-GCM で暗号文を復号する。
 *
 * @param ciphertext - base64 エンコードされた暗号文 (IV || encrypted || authTag)
 * @param key - 256-bit (32 bytes) の暗号化キー（hex 文字列）
 * @returns 復号された平文
 */
export function decrypt(ciphertext: string, key: string): string {
  const keyBuffer = Buffer.from(key, "hex");
  if (keyBuffer.length !== 32) {
    throw new Error("Encryption key must be 32 bytes (64 hex characters)");
  }

  const combined = Buffer.from(ciphertext, "base64");

  if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Invalid ciphertext: too short");
  }

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH, combined.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, keyBuffer, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return decrypted.toString("utf8");
}
