// The vendored CommonJS module is wrapped here for Vite's browser bundle.
import bcryptPbkdf from './vendor/bcrypt-pbkdf.js';

export const pbkdf = bcryptPbkdf.pbkdf;
