const crypto = require('crypto');

/**
 * Password hashing using Node's built-in crypto.scrypt (no native build / npm install
 * required). Stored format: "<saltHex>:<derivedKeyHex>". Functionally equivalent to a
 * salted bcrypt hash for this app's purpose (no plaintext credentials, no hardcoding).
 */
const KEYLEN = 64;

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, KEYLEN, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve) => {
    if (!stored || typeof stored !== 'string' || !stored.includes(':')) {
      return resolve(false);
    }
    const [salt, keyHex] = stored.split(':');
    const keyBuffer = Buffer.from(keyHex, 'hex');
    crypto.scrypt(password, salt, KEYLEN, (err, derivedKey) => {
      if (err) return resolve(false);
      // Length guard before timingSafeEqual (it throws on length mismatch)
      if (keyBuffer.length !== derivedKey.length) return resolve(false);
      resolve(crypto.timingSafeEqual(keyBuffer, derivedKey));
    });
  });
}

module.exports = { hashPassword, verifyPassword };
