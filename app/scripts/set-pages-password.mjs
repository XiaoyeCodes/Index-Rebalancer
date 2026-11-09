// Run locally; pass the shared Pages password on standard input.
import { generateKeyPairSync, randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv, createHash, hkdfSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const accessFile = new URL('../pages-access.json',import.meta.url);
const input = readFileSync(0,'utf8').replace(/^\uFEFF/,'').replace(/\r?\n$/,'').split(/\r?\n/);
const existing = existsSync(accessFile);
if (input.length !== (existing ? 2 : 1)) throw Error('Existing workspace: provide current password and new password on separate lines.');
const password = input.at(-1);
if (!password || password.length > 512) throw Error('Invalid new password.');
let publicKey, privateBytes;
if (existing) {
  const old=JSON.parse(readFileSync(accessFile,'utf8'));
  const oldKey=pbkdf2Sync(input[0],Buffer.from(old.salt,'base64'),old.iterations,32,'sha256');
  const data=Buffer.from(old.sealed,'base64'), decoder=createDecipheriv('aes-256-gcm',oldKey,Buffer.from(old.iv,'base64'));
  decoder.setAuthTag(data.subarray(-16));
  privateBytes=Buffer.concat([decoder.update(data.subarray(0,-16)),decoder.final()]);
  publicKey=old.publicKey;
} else {
  const pair=generateKeyPairSync('rsa',{modulusLength:3072});
  publicKey=pair.publicKey.export({format:'pem',type:'spki'});
  privateBytes=pair.privateKey.export({format:'der',type:'pkcs8'});
}
const salt = randomBytes(16), iv = randomBytes(12), iterations = 600000;
const key = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
const cipher = createCipheriv('aes-256-gcm', key, iv);
const sealed = Buffer.concat([cipher.update(privateBytes), cipher.final(), cipher.getAuthTag()]);
const access = { publicKey, iterations,
  salt:salt.toString('base64'), iv:iv.toString('base64'), sealed:sealed.toString('base64') };
writeFileSync(accessFile, JSON.stringify(access, null, 2)+'\n');
const sha = data=>createHash('sha256').update(data).digest();
const token=Buffer.from(hkdfSync('sha256',sha(privateBytes),'heng.workspace.v1','access',32)).toString('hex');
writeFileSync(new URL('../../sync/access.json',import.meta.url),JSON.stringify({digest:sha(token).toString('hex')})+'\n');
