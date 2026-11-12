import test from 'node:test';
import assert from 'node:assert/strict';
import {githubBackups} from '../../sync/github-backups.js';
const env={GITHUB_BACKUP_TOKEN:'server-secret',GITHUB_BACKUP_REPOSITORY:'owner/private',GITHUB_BACKUP_BRANCH:'investment-backups'};
const id='20261112T064305570Z-00000000-0000-4000-8000-000000000001.json';
const backup={format:'heng-investment-backup',version:1,createdAt:'2026-11-12T06:43:05.570Z',blob:Buffer.alloc(60,42).toString('base64')};
const req=(suffix='',method='GET')=>new Request('https://sync.example/workspace/backups'+suffix,{method});
function github({privateRepo=true,corrupt=false,failPut=false}={}) {
  const writes=[];
  return {writes,fetch:async(url,options)=>{
    assert.equal(options.headers.Authorization,'Bearer server-secret');
    if(url.endsWith('/private'))return Response.json({private:privateRepo});
    if(url.includes('/git/trees/'))return Response.json({tree:[{type:'blob',path:'investment-backups/'+id,size:200},{type:'blob',path:'README.md'}]});
    if(options.method==='PUT'){
      writes.push(JSON.parse(options.body));
      return failPut?Response.json({}, {status:403}):Response.json({commit:{sha:'commit-sha'},content:{html_url:'https://github.com/owner/private/blob/investment-backups/investment-backups/'+id}},{status:201});
    }
    return Response.json(corrupt?{...backup,blob:backup.blob+'AAAA'}:backup);
  }};
}
test('GitHub backups require private storage and only send an encrypted envelope',async()=>{
  const f=github();const result=await githubBackups(req('','POST'),env,{id,backup},f.fetch);
  assert.equal(result.status,201);assert.equal(result.data.commit,'commit-sha');
  const content=JSON.parse(Buffer.from(f.writes[0].content,'base64').toString());
  assert.deepEqual(content,backup);assert.equal(content.state,undefined);assert.equal(f.writes[0].branch,'investment-backups');
  const publicRepo=github({privateRepo:false});await assert.rejects(githubBackups(req('','POST'),env,{id,backup},publicRepo.fetch),/私有/);assert.equal(publicRepo.writes.length,0);
});
test('backup list excludes all unrelated repository files and rejects path traversal',async()=>{
  const f=github(),result=await githubBackups(req(),env,null,f.fetch);
  assert.deepEqual(result.data.files,[{id,size:200}]);
  assert.equal((await githubBackups(req('/unrelated.json'),env,null,f.fetch)).status,400);
  assert.equal((await githubBackups(req('','POST'),env,{id:'../password.json',backup},f.fetch)).status,400);
});
test('GitHub write failures or corrupted readback never report a completed backup',async()=>{
  await assert.rejects(githubBackups(req('','POST'),env,{id,backup},github({failPut:true}).fetch),/授权失效/);
  await assert.rejects(githubBackups(req('','POST'),env,{id,backup},github({corrupt:true}).fetch),/回读校验失败/);
  await assert.rejects(githubBackups(req(),{...env,GITHUB_BACKUP_TOKEN:''},null,github().fetch),/尚未配置/);
});
