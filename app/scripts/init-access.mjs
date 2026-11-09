import fs from 'node:fs';
import {initialize} from './vault.mjs';
const input=fs.readFileSync(0,'utf8').replace(/^\uFEFF/,'').trimEnd();
const [key,baseUrl,model]=fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).slice(0,3).map(v=>v.trim());
await initialize(input,{key,baseUrl,model});
console.log('本地登录与加密 AI 配置已初始化。');
