import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash,createCipheriv,createDecipheriv,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const derive=promisify(scrypt);
const privateDir=process.env.HENG_PRIVATE_DIR || fileURLToPath(new URL('../../.private/',import.meta.url));
mkdirSync(privateDir,{recursive:true,mode:0o700});
const db=new DatabaseSync(path.join(privateDir,'access.sqlite'));
db.exec(`PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS account (id INTEGER PRIMARY KEY CHECK(id=1),salt BLOB NOT NULL,verifier BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY CHECK(id=1),iv BLOB NOT NULL,tag BLOB NOT NULL,ciphertext BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY,audience TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS attempts (id INTEGER PRIMARY KEY CHECK(id=1),count INTEGER NOT NULL,until INTEGER NOT NULL);`);
const masterFile=process.env.HENG_MASTER_FILE || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'.config'),'DynamicRebalancing','keys','vault.key');
function master(create=false) {
  if(create && !existsSync(masterFile)) {
    mkdirSync(path.dirname(masterFile),{recursive:true,mode:0o700});
    writeFileSync(masterFile,randomBytes(32),{flag:'wx',mode:0o600});
  }
  return readFileSync(masterFile);
}
export async function initialize(password,config) {
  if(!password || !config.key || !config.model || new URL(config.baseUrl).origin!=='https://api.deepseek.com') throw Error('密码或 DeepSeek 配置无效。');
  if(db.prepare('SELECT id FROM account').get()) throw Error('数据库已初始化。');
  const salt=randomBytes(16),hash=await derive(password,salt,64,{N:65536,r:8,p:1,maxmem:128*1024*1024});
  const {iv,tag,ciphertext}=seal(config,true);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO account VALUES(1,?,?)').run(salt,hash);
    db.prepare('INSERT INTO config VALUES(1,?,?,?)').run(iv,tag,ciphertext);
    db.exec('COMMIT');
  } catch(e){db.exec('ROLLBACK');throw e;}
}
export function modelSettings(){
  const row=db.prepare('SELECT * FROM config WHERE id=1').get();
  if(!row)throw Error('AI 尚未配置');
  const cipher=createDecipheriv('aes-256-gcm',master(),row.iv);
  cipher.setAuthTag(row.tag);
  return JSON.parse(Buffer.concat([cipher.update(row.ciphertext),cipher.final()]).toString('utf8'));
}
const hashToken=token=>createHash('sha256').update(token).digest('hex');
const error=(status,message)=>Object.assign(new Error(message),{status});
export async function login(password,audience,remember=false){
  const now=Date.now(), t=db.prepare('SELECT * FROM attempts WHERE id=1').get();
  if(t && t.until>now && t.count>=8)throw error(429,'尝试次数过多，请在 10 分钟后再试。');
  const row=db.prepare('SELECT salt,verifier FROM account WHERE id=1').get();
  if(!row)throw error(503,'本机登录数据库尚未初始化。');
  // Reserve the attempt before asynchronous hashing to bound parallel guesses.
  db.prepare('INSERT OR REPLACE INTO attempts VALUES(1,?,?)').run(t && t.until>now?t.count+1:1,t && t.until>now?t.until:now+600000);
  if(typeof password !== 'string' || password.length>512 || !timingSafeEqual(row.verifier,await derive(password,row.salt,64,{N:65536,r:8,p:1,maxmem:128*1024*1024})))throw error(401,'密码不正确。');
  db.prepare('DELETE FROM attempts').run();
  db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
  const token=randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hashToken(token),audience,now+(remember?30*24:8)*3600000);
  return token;
}
export function authenticated(token,audience){
  return !!token && !!db.prepare('SELECT 1 FROM sessions WHERE digest=? AND audience=? AND expires>?').get(hashToken(token),audience,Date.now());
}
export function logout(token){if(token)db.prepare('DELETE FROM sessions WHERE digest=?').run(hashToken(token));}

function seal(config,create=false){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',master(create),iv);
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(config),'utf8'),cipher.final()]);
  return {iv,tag:cipher.getAuthTag(),ciphertext};
}
export function updateModel({model,key,baseUrl}){
  const old=modelSettings();
  const url=new URL(baseUrl);
  if(url.origin!=='https://api.deepseek.com' || !['/','/v1','/v1/'].includes(url.pathname) || url.search || url.hash || url.username || url.password ||
      typeof model!=='string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(model) || (key && (typeof key!=='string'||/[\r\n]/.test(key))))
    throw Object.assign(new Error('请检查 DeepSeek 地址和模型名称。'),{status:400});
  const {iv,tag,ciphertext}=seal({model,key:key || old.key,baseUrl:url.href.replace(/\/+$/,'')});
  db.prepare('UPDATE config SET iv=?,tag=?,ciphertext=? WHERE id=1').run(iv,tag,ciphertext);
}
