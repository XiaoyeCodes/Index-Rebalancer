const namePattern=/^\d{8}T\d{9}Z-[0-9a-f-]{36}\.json$/;
const envelopeValid=value=>value?.format==='heng-investment-backup'&&value.version===1&&typeof value.createdAt==='string'&&Number.isFinite(Date.parse(value.createdAt))&&typeof value.blob==='string'&&value.blob.length>=40&&value.blob.length<=1450000&&/^[A-Za-z0-9+/]+={0,2}$/.test(value.blob);
const encode=value=>{const data=new TextEncoder().encode(value);let text='';for(let i=0;i<data.length;i+=8192)text+=String.fromCharCode(...data.subarray(i,i+8192));return btoa(text);};
export async function githubBackups(req,env,payload,fetcher=fetch) {
  const repo=env.GITHUB_BACKUP_REPOSITORY,branch=env.GITHUB_BACKUP_BRANCH||'codex/investment-backups';
  if(!env.GITHUB_BACKUP_TOKEN||!/^[-\w.]+\/[-\w.]+$/.test(repo||''))throw Error('GitHub备份尚未配置。');
  const api='https://api.github.com/repos/'+repo;
  const headers={Authorization:'Bearer '+env.GITHUB_BACKUP_TOKEN,'User-Agent':'Index-Rebalancer-Backups','X-GitHub-Api-Version':'2022-11-28',Accept:'application/vnd.github+json'};
  async function call(path,options={}) {
    const response=await fetcher(api+path,{...options,headers:{...headers,...options.headers},redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error(response.status===401||response.status===403?'GitHub备份授权失效，请联系网站维护者。':'GitHub备份暂时不可用（'+response.status+'）。');
    return response;
  }
  // Refuse to store even encrypted investment backups in a public repository.
  if(!(await (await call('')).json()).private)throw Error('备份仓库必须为私有仓库。');
  const suffix=new URL(req.url).pathname.slice('/workspace/backups'.length);
  const file=suffix.startsWith('/')?suffix.slice(1):'';
  if(file&&!namePattern.test(file))return {status:400,data:{detail:'备份编号无效。'}};
  const contents=file=>'/contents/investment-backups/'+file;
  async function read(file) {
    const response=await call(contents(file)+'?ref='+encodeURIComponent(branch),{headers:{Accept:'application/vnd.github.raw+json'}});
    const value=await response.json();
    if(!envelopeValid(value))throw Error('GitHub中的备份格式无效。');
    return value;
  }
  if(req.method==='GET'&&file)return {data:await read(file)};
  if(req.method==='GET'&&!suffix) {
    const tree=await (await call('/git/trees/'+encodeURIComponent(branch)+'?recursive=1')).json();
    if(tree.truncated)throw Error('备份目录过大，请联系维护者归档后再恢复。');
    const files=tree.tree.filter(row=>row.type==='blob'&&row.path.startsWith('investment-backups/')&&namePattern.test(row.path.slice(19)))
      .map(row=>({id:row.path.slice(19),size:row.size})).sort((a,b)=>b.id.localeCompare(a.id));
    return {data:{files}};
  }
  if(req.method!=='POST'||suffix)return {status:405,data:{}};
  const {id,backup}=payload||{};
  if(!namePattern.test(id||'')||!envelopeValid(backup))return {status:400,data:{detail:'备份数据无效或超过容量。'}};
  const body=JSON.stringify(backup);
  const response=await call(contents(id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({branch,message:'Back up encrypted investment workspace '+id,content:encode(body)})});
  const saved=await response.json();
  // A successful HTTP write alone is insufficient: verify the committed file.
  if(JSON.stringify(await read(id))!==body)throw Error('GitHub备份回读校验失败，未确认备份成功。');
  return {status:201,data:{id,commit:saved.commit.sha,url:saved.content.html_url}};
}
