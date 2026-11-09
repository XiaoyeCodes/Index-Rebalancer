// GitHub Pages has no Python process. Use the configured browser model and the
// same assistant UI there. Each session has its own history and in-flight lock.
export const staticHosting = window.parent.location.hostname.endsWith('.github.io');
const prefix = 'heng.assistant.web.session.';
type Message = {message_id:string; role:string; content:string; linked_attempt_id?:string};
type Session = {session_id:string; title:string; updated_at:string; created_at:string; pinned:boolean;
  status:string; last_attempt_id?:string; last_attempt_status?:string; messages:Message[]};
declare global {
  interface Window { assistantBrowserResearch?: (messages:Message[], signal:AbortSignal) => Promise<string> }
}
const bus = new EventTarget();
const peers = staticHosting ? new BroadcastChannel('heng.assistant.web.events') : null;
const jobs = new Map<string, AbortController>();
type Update = {sid:string; name:string; data:Record<string,unknown>};
function receive(update:Update) {
  if(update.name==='cancel') jobs.get(update.sid)?.abort();
  bus.dispatchEvent(new CustomEvent(update.sid,{detail:update}));
}
if(peers) peers.onmessage = e => receive(e.data);
function publish(sid:string, name:string, data:Record<string,unknown>={}) {
  const update={sid,name,data}; receive(update); peers?.postMessage(update);
}
export class BrowserStream extends EventTarget {
  onopen: (()=>void) | null = null;
  onerror: (()=>void) | null = null;
  handler = (event:Event) => {
    const {name,data} = (event as CustomEvent<Update>).detail;
    this.dispatchEvent(new MessageEvent(name,{data:JSON.stringify(data)}));
  };
  constructor(private sid:string) {
    super(); bus.addEventListener(sid,this.handler); queueMicrotask(()=>this.onopen?.());
  }
  close(){bus.removeEventListener(this.sid,this.handler);}
}
function read(id:string):Session {
  const raw=localStorage.getItem(prefix+id);
  if(!raw) throw new Error('这份研究记录已删除。');
  return JSON.parse(raw);
}
function save(s:Session){s.updated_at=new Date().toISOString();localStorage.setItem(prefix+s.session_id,JSON.stringify(s));}
const clock=()=>new Date().toISOString();
const edit = <T>(id:string, fn:()=>T) => navigator.locks.request(prefix+id,fn);
const metadata = ({messages,...meta}:Session) => meta;
async function start(sid:string, prompt:string) {
  if(!window.parent.assistantBrowserResearch) throw new Error('请从主页面打开 AI 助手。');
  const attempt=crypto.randomUUID(), controller=new AbortController();
  let acknowledge!:()=>void, reject!:(e:unknown)=>void;
  const accepted=new Promise<void>((resolve,fail)=>{acknowledge=resolve;reject=fail;});
  void navigator.locks.request('run.'+prefix+sid,{ifAvailable:true},async lock=>{
    if(!lock) throw new Error('本次研究仍在进行中。');
    const history=await edit(sid,()=>{
      const s=read(sid);
      s.last_attempt_id=attempt;s.last_attempt_status='running';
      s.messages.push({message_id:crypto.randomUUID(),role:'user',content:prompt});
      save(s);return s.messages;
    });
    jobs.set(sid,controller);acknowledge();publish(sid,'attempt.started',{attempt_id:attempt});
    try {
      const summary=await window.parent.assistantBrowserResearch!(history,controller.signal);
      controller.signal.throwIfAborted();
      await edit(sid,()=>{
        const s=read(sid);
        s.messages.push({message_id:crypto.randomUUID(),role:'assistant',content:summary,linked_attempt_id:attempt});
        s.last_attempt_status='completed';save(s);
      });
      publish(sid,'attempt.completed',{attempt_id:attempt,summary});
    } catch(error) {
      if(localStorage.getItem(prefix+sid)) await edit(sid,()=>{const s=read(sid);s.last_attempt_status='failed';save(s);});
      publish(sid,'attempt.failed',{attempt_id:attempt,error:controller.signal.aborted?'cancelled':String((error as Error).message)});
    } finally {jobs.delete(sid);}
  }).catch(reject);
  await accepted;return {attempt_id:attempt};
}
export async function browserRequest(url:string, init?:RequestInit):Promise<unknown> {
  init?.signal?.throwIfAborted();
  const u=new URL(url, window.parent.location.origin), method=init?.method || 'GET', action=u.pathname.split('/').pop();
  const body=JSON.parse(String(init?.body || '{}'));
  const sid=body.sessionId || u.searchParams.get('sessionId');
  if(action==='sessions') {
    const locks=await navigator.locks.query();
    return Object.keys(localStorage).filter(key=>key.startsWith(prefix)).map(key=>{
      const s=read(key.slice(prefix.length));
      if(s.last_attempt_status==='running' && !locks.held?.some(l=>l.name==='run.'+key)) s.last_attempt_status='failed';
      return metadata(s);
    });
  }
  if(action==='session' && method==='POST'){
    if(sid){read(sid);return {sessionId:sid};}
    const id=crypto.randomUUID();
    save({session_id:id,title:String(body.prompt).slice(0,50),messages:[],status:'active',pinned:false,created_at:clock(),updated_at:clock()});
    return {sessionId:id};
  }
  if(action==='message') return start(sid,body.prompt);
  if(action==='messages') return read(sid).messages;
  if(action==='cancel'){publish(sid,'cancel');return {status:'cancelled'};}
  if(action==='session' && method==='PATCH') return edit(sid,()=>{
    const s=read(sid);if(typeof body.pinned==='boolean')s.pinned=body.pinned;if(body.title)s.title=body.title;
    save(s);return metadata(s);
  });
  if(action==='session' && method==='DELETE') return edit(sid,()=>{publish(sid,'cancel');localStorage.removeItem(prefix+sid);return {status:'deleted'};});
  throw new Error('不支持的研究操作。');
}
