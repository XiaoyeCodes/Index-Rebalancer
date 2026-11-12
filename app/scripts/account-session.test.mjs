import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('local remembered cookies last thirty days, short sessions expire, and logout revokes the token',()=>{
  const temporary=mkdtempSync(path.join(tmpdir(),'heng-session-test-'));
  try {
    execFileSync(process.execPath,['--input-type=module','-e',String.raw`
      import assert from 'node:assert/strict';
      import {Readable} from 'node:stream';
      import {initialize,login,authenticated,logout} from './scripts/vault.mjs';
      import {accountGate} from './scripts/account-gate.mjs';
      await initialize('fixture-password',{key:'fixture-key',baseUrl:'https://api.deepseek.com',model:'fixture'});
      let now=Date.now();Date.now=()=>now;
      const audience='http://127.0.0.1:5190',day=24*3600000;
      const remembered=await login('fixture-password',audience,true);
      now+=29*day;assert.ok(authenticated(remembered,audience));assert.equal(authenticated(remembered,'https://other.test'),false);
      now+=day;assert.equal(authenticated(remembered,audience),false);
      const short=await login('fixture-password',audience,false);
      now+=8*3600000;assert.equal(authenticated(short,audience),false);
      const token=await login('fixture-password',audience,true);logout(token);assert.equal(authenticated(token,audience),false);
      async function cookie(remember){
        const req=Readable.from([Buffer.from(JSON.stringify({password:'fixture-password',remember}))]);
        req.method='POST';req.headers={'content-type':'application/json'};
        const headers={},res={setHeader:(k,v)=>{headers[k]=v;},writeHead:()=>{},end:()=>{}};
        await accountGate(req,res,new URL(audience+'/api/account/login'));
        return headers['Set-Cookie'];
      }
      const persistent=await cookie(true),sessionOnly=await cookie(false);
      assert.ok(persistent.includes('HttpOnly')&&persistent.includes('SameSite=Strict')&&persistent.includes('Max-Age=2592000'));
      assert.ok(sessionOnly.includes('HttpOnly')&&!sessionOnly.includes('Max-Age='));
      const signedIn=await login('fixture-password',audience,true);
      async function verify(password){
        const req=Readable.from([Buffer.from(JSON.stringify({password}))]);
        req.method='POST';req.headers={'content-type':'application/json',cookie:'heng_session='+signedIn};
        const res={setHeader(){},writeHead(){},end(){}};
        return accountGate(req,res,new URL(audience+'/api/account/verify-password'));
      }
      assert.equal(await verify('fixture-password'),true);
      await assert.rejects(verify('incorrect'),/密码不正确/);
      assert.equal(authenticated(signedIn,audience),true);
    `],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,HENG_PRIVATE_DIR:temporary,HENG_MASTER_FILE:path.join(temporary,'master.key')},stdio:'pipe'});
  } finally {
    assert.equal(path.dirname(path.resolve(temporary)),path.resolve(tmpdir()));
    assert.ok(path.basename(temporary).startsWith('heng-session-test-'));
    rmSync(temporary,{recursive:true,force:true});
  }
});
