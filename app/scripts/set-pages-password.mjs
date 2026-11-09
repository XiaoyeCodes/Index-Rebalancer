// Run locally; pass the shared Pages password on standard input.
import { generateKeyPairSync, randomBytes, pbkdf2Sync, createCipheriv } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const password = readFileSync(0, 'utf8').replace(/^\uFEFF/, '').replace(/\r?\n$/, '');
if (!password || password.length > 512) throw Error('Provide the Pages password on stdin.');
const {publicKey, privateKey} = generateKeyPairSync('rsa', {modulusLength: 3072});
const salt = randomBytes(16), iv = randomBytes(12), iterations = 600000;
const key = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
const cipher = createCipheriv('aes-256-gcm', key, iv);
const sealed = Buffer.concat([cipher.update(privateKey.export({format:'der',type:'pkcs8'})), cipher.final(), cipher.getAuthTag()]);
const access = { publicKey: publicKey.export({format:'pem',type:'spki'}), iterations,
  salt:salt.toString('base64'), iv:iv.toString('base64'), sealed:sealed.toString('base64') };
writeFileSync(new URL('../pages-access.json', import.meta.url), JSON.stringify(access, null, 2)+'\n');
