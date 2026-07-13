import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { env } from './env'

function getMasterKey(): Buffer {
  const hex = env('YT_KEY_ENCRYPT_SECRET')
  if (!hex || hex.length !== 64) {
    throw new Error(
      '[crypto] YT_KEY_ENCRYPT_SECRET is missing or not 64 hex chars (32 bytes). ' +
      'Generate with: openssl rand -hex 32 and add to Vercel environment variables.'
    )
  }
  return Buffer.from(hex, 'hex')
}

let _masterKey: Buffer | null = null
function masterKey(): Buffer {
  if (!_masterKey) _masterKey = getMasterKey()
  return _masterKey
}

/**
 * Encrypts a plaintext string with AES-256-GCM.
 * Output format (hex): IV(12 bytes) || AuthTag(16 bytes) || Ciphertext
 * Throws if YT_KEY_ENCRYPT_SECRET env var is missing or invalid.
 */
export function encryptKey(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('hex')
}

/**
 * Decrypts a hex string produced by encryptKey.
 * Throws on tampered ciphertext (auth tag mismatch) or invalid format.
 */
export function decryptKey(hex: string): string {
  const buf = Buffer.from(hex, 'hex')
  if (buf.length < 29) throw new Error('[crypto] encrypted key too short — corrupted data')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ciphertext = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
