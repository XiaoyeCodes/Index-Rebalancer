/* All provider calls and credentials are handled by the authenticated service. */
(() => {
  const $ = id => document.getElementById(id);
  const account = () => window.privateAccount;
  async function request(path, options = {}) {
    const response = await account().api('/api/account/' + path, options);
    if (response.status === 401) { location.reload(); throw Error('请重新登录。'); }
    const data = await response.json();
    if (!response.ok) throw Error(data.detail || '服务暂时不可用。');
    return data;
  }
  async function json(prompt, {signal,onUsage}={}) {
    const data = await request('chat', {method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt})});
    onUsage?.(data.usage);
    if (signal?.aborted) throw signal.reason;
    try { return JSON.parse(data.text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')); }
    catch { throw Error('模型返回的内容无法解析，请重试。'); }
  }
  function bindSettings(){
    // Dispose of credentials retained by earlier browser-only versions.
    for(const storage of [localStorage,sessionStorage])storage.removeItem('heng.ai.key');
    localStorage.removeItem('heng.ai.config');
    $('aiConfigured').hidden=false;
    const form=$('aiSettingsForm'),dialog=$('aiSettings');
    $('openSettings').onclick=async()=>{
      dialog.showModal();
      const remote=account().pages;
      $('aiSettingsMessage').textContent=remote?'请在本机页面修改配置。':'';
      $('aiBaseUrl').readOnly=remote;$('aiModel').readOnly=remote;$('aiKeyField').hidden=remote;$('saveAI').hidden=remote;
      try { const settings=await request('settings');$('aiModel').value=settings.model;$('aiBaseUrl').value=settings.baseUrl; }
      catch(e){$('aiSettingsMessage').textContent=e.message;}
    };
    $('closeSettings').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{$('aiApiKey').value='';});
    $('accountLogout').onclick=()=>account().logout().catch(e=>{$('aiSettingsMessage').textContent=e.message;});
    form.onsubmit=async event=>{
      event.preventDefault();
      const draft={model:$('aiModel').value.trim(),baseUrl:$('aiBaseUrl').value.trim(),key:$('aiApiKey').value.trim()};
      try { await request('settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)});dialog.close(); }
      catch(e){$('aiSettingsMessage').textContent=e.message;}
    };
  }
  window.hengAI={bindSettings,json,available:()=>!!account(),hint:()=>'请先登录。',failureMessage:e=>e.message || 'AI 暂时没有响应。'};
})();
