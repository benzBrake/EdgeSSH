import { pbkdf } from './bcrypt-pbkdf';

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const result = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
};
const u32 = (value: number): Uint8Array => new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
const sshString = (value: Uint8Array): Uint8Array => concat(u32(value.length), value);
const b64 = (value: Uint8Array): string => { let binary = ''; for (const byte of value) binary += String.fromCharCode(byte); return btoa(binary); };
const wrap = (value: string): string => value.match(/.{1,70}/g)?.join('\n') ?? '';

async function cryptPrivate(data: Uint8Array, passphrase: string, salt: Uint8Array, rounds: number, decrypt: boolean): Promise<Uint8Array> {
  const derived = new Uint8Array(48);
  const password = text(passphrase);
  if (pbkdf(password, password.length, salt, salt.length, derived, derived.length, rounds) !== 0) throw new Error('无法派生私钥加密密钥。');
  const key = await crypto.subtle.importKey('raw', derived.slice(0, 32) as BufferSource, 'AES-CTR', false, [decrypt ? 'decrypt' : 'encrypt']);
  return new Uint8Array(await crypto.subtle[decrypt ? 'decrypt' : 'encrypt']({ name: 'AES-CTR', counter: derived.slice(32) as BufferSource, length: 128 }, key, data as BufferSource)) as Uint8Array<ArrayBuffer>;
}

export async function generateEd25519KeyPair(passphrase: string, host: string, username: string, existingPair?: CryptoKeyPair): Promise<{ privateKey: string; publicKey: string }> {
  const pair = existingPair ?? await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const seed = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const seedRaw = seed.slice(seed.length - 32);
  const type = text('ssh-ed25519');
  const publicBlob = concat(sshString(type), sshString(publicRaw));
  const comment = `edgessh@${host.trim() || username.trim() || 'edgessh'}`;
  const check = new Uint8Array(4); crypto.getRandomValues(check);
  const privateSection = concat(check, check, sshString(type), sshString(publicRaw), sshString(concat(seedRaw, publicRaw)), sshString(text(comment)));
  const blockSize = passphrase ? 16 : 8;
  const padding = (blockSize - (privateSection.length % blockSize)) % blockSize;
  const padded = concat(privateSection, Uint8Array.from({ length: padding }, (_, i) => (i + 1) & 255));
  let cipher = text('none'); let kdf = text('none'); let options = new Uint8Array(); let body = padded;
  if (passphrase) {
    const salt = new Uint8Array(16); crypto.getRandomValues(salt);
    const rounds = 16; const optionsPayload = concat(sshString(salt), u32(rounds));
    kdf = text('bcrypt'); options = optionsPayload as Uint8Array<ArrayBuffer>; cipher = text('aes256-ctr');
    body = await cryptPrivate(padded, passphrase, salt, rounds, false) as Uint8Array<ArrayBuffer>;
  }
  const raw = concat(text('openssh-key-v1\0'), sshString(cipher), sshString(kdf), sshString(options), u32(1), sshString(publicBlob), sshString(body));
  return {
    privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\n${wrap(b64(raw))}\n-----END OPENSSH PRIVATE KEY-----\n`,
    publicKey: `ssh-ed25519 ${b64(publicBlob)} ${comment}`,
  };
}
