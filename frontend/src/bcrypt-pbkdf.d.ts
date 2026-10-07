declare module './vendor/bcrypt-pbkdf.js' {
  interface BcryptPbkdfModule {
    pbkdf(pass: Uint8Array, passlen: number, salt: Uint8Array, saltlen: number, key: Uint8Array, keylen: number, rounds: number): number;
  }
  const bcryptPbkdf: BcryptPbkdfModule;
  export default bcryptPbkdf;
}
