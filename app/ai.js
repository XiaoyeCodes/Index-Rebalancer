/* The hosted site uses a browser-owned model. The desktop entry uses its local account. */
(() => {
  const $ = id => document.getElementById(id);
  const account = () => window.privateAccount;
  let configured = false;
  const hint = () => '请先在设置中填写自己的 API 密钥。';
  async function request(path, options = {}) {
    const response = await account().api('/api/account/' + path, options);
    if (response.status === 401) { location.reload(); throw Error('请重新登录。'); }
    const data = await response.json();
    if (!response.ok) throw Error(data.detail || '服务暂时不可用。');
    return data;
  }
  async function json(prompt, {signal,onUsage}={}) {
    const data = account().pages ? await account().model.chat(prompt,signal) : await request('chat', {method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt})});
    onUsage?.(data.usage);
    if (signal?.aborted) throw signal.reason;
    try { return JSON.parse(data.text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')); }
    catch { throw Error('模型返回的内容无法解析，请重试。'); }
  }
  function bindSettings(){
    // Dispose of credentials retained by earlier browser-only versions.
    for(const storage of [localStorage,sessionStorage])storage.removeItem('heng.ai.key');
    localStorage.removeItem('heng.ai.config');
    const browser = account().pages, model = account().model;
    const form=$('aiSettingsForm'),dialog=$('aiSettings');
    const feedback = message => { $('aiSettingsMessage').textContent = message; };
    const getSettings = () => browser ? model.settings() : request('settings');
    function showStatus(value) {
      configured = value;
      $('aiConfigured').hidden = !value;
      $('clearAI').hidden = !browser || !value;
    }
    if (browser) {
      $('aiSettingsIntro').textContent = '填写自己的模型和 API 密钥后即可使用 AI 分析。密钥加密保存在当前浏览器，分析时直接连接你填写的服务。';
      getSettings().then(settings => showStatus(settings.configured)).catch(() => showStatus(false));
    } else { showStatus(true); }
    $('openSettings').onclick=async()=>{
      if (!dialog.open) dialog.showModal();
      feedback('');
      $('saveAI').disabled = $('clearAI').disabled = true;
      try {
        const settings=await getSettings();
        showStatus(browser ? settings.configured : true);
        if (settings.reset) feedback('访问密码已更新，请重新填写 API 密钥。');
        $('aiModel').value=settings.model;
        $('aiBaseUrl').value=settings.baseUrl;
        $('aiApiKey').required=browser && !configured;
        $('aiApiKey').placeholder=configured?'已保存，留空可继续使用':'输入你的 API 密钥';
      } catch(e){ feedback(e.message); }
      finally { $('saveAI').disabled = $('clearAI').disabled = false; }
    };
    $('clearAI').onclick=async()=>{
      try { await model.clear(); showStatus(false); dialog.close(); }
      catch(e){ feedback(e.message); }
    };
    window.canStartBrowserResearch = () => {
      if (configured) return true;
      $('openSettings').click();
      return false;
    };
    $('closeSettings').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{$('aiApiKey').value='';});
    $('accountLogout').onclick=()=>account().logout().catch(e=>{$('aiSettingsMessage').textContent=e.message;});
    form.onsubmit=async event=>{
      event.preventDefault();
      const draft={model:$('aiModel').value.trim(),baseUrl:$('aiBaseUrl').value.trim(),key:$('aiApiKey').value.trim()};
      try {
        if (browser) await model.save(draft);
        else await request('settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)});
        showStatus(true);
        dialog.close();
      }
      catch(e){$('aiSettingsMessage').textContent=e.message;}
    };
  }
  window.hengAI={bindSettings,json,available:()=>configured,hint,failureMessage:e=>e.message || 'AI 暂时没有响应。'};
})();
