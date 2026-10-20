'use strict';

// 保留原版十二題、是非題型、即時判分、米綠 × 奶油色系。
const QUESTIONS = [
  ['米粉是米做的嗎？','yes','一般米粉以米為主要原料，商品仍可能混合其他澱粉。'],
  ['一般的麵包是米做的嗎？','no','一般麵包主要使用小麥麵粉，也有特別製作的米麵包。'],
  ['麻糬是米做的嗎？','yes','傳統麻糬以糯米或糯米粉製作。'],
  ['一般的義大利麵是米做的嗎？','no','一般義大利麵主要使用小麥製作。'],
  ['飯糰是米做的嗎？','yes','飯糰的主要材料是米飯。'],
  ['一般的饅頭是米做的嗎？','no','一般饅頭主要以小麥麵粉製作。'],
  ['米苔目是米做的嗎？','yes','米苔目通常以米漿製作，配方可能混合其他澱粉。'],
  ['一般的烏龍麵是米做的嗎？','no','一般烏龍麵主要以小麥麵粉製作。'],
  ['年糕是米做的嗎？','yes','年糕常以糯米、粳米或米粉製作。'],
  ['玉米片是米做的嗎？','no','一般玉米片的主要原料是玉米。'],
  ['河粉是米做的嗎？','yes','河粉通常以米漿製作。'],
  ['一般的水餃皮是米做的嗎？','no','一般水餃皮主要以小麥麵粉製作。']
];

const $ = (id) => document.getElementById(id);
const show = (id, visible) => $(id).classList.toggle('hidden', !visible);
const DEPLOYED_CONFIG = window.RICE_CONFIG || {};
const SETTINGS_STORAGE = 'rice-magician-supabase-local-override-v1';
function getLocalOverride(){
  try {
    const obj=JSON.parse(localStorage.getItem(SETTINGS_STORAGE)||'null');
    return obj && typeof obj==='object' && typeof obj.supabaseUrl==='string' && typeof obj.supabaseAnonKey==='string' ? obj : null;
  } catch { return null; }
}
const LOCAL_OVERRIDE = getLocalOverride();
const CONFIG = LOCAL_OVERRIDE || DEPLOYED_CONFIG;
// 完全留白才進示範模式；只填一欄屬於設定錯誤，不能悄悄回退。
const DEMO = !CONFIG.supabaseUrl && !CONFIG.supabaseAnonKey;
const PARTIAL_CONFIG = !!CONFIG.supabaseUrl !== !!CONFIG.supabaseAnonKey;
const REQUIRED_DB_VERSION = '2.1';
const STORAGE = 'rice-magician-github-demo-v2';
const TEACHER_SESSION = 'rice-magician-teacher-tokens-v2';
const DEMO_CLASSES = [
  {class_name:'四年甲班（示範）',class_code:'RICE401',teacher_key:'DEMO-401'},
  {class_name:'四年乙班（示範）',class_code:'RICE402',teacher_key:'DEMO-402'}
];
const DEMO_CUSTOM_CLASSES_KEY='rice-magician-demo-custom-classes-v23';
try{
  const stored=JSON.parse(localStorage.getItem(DEMO_CUSTOM_CLASSES_KEY)||'[]');
  if(Array.isArray(stored)) for(const c of stored){
    if(c&&typeof c.class_name==='string'&&/^[A-Z0-9]{6,12}$/.test(c.class_code)&&
      typeof c.teacher_key==='string'&&!DEMO_CLASSES.some(d=>d.class_code===c.class_code)) DEMO_CLASSES.push(c);
  }
}catch{}
const DEMO_MANAGEMENT_CODE='DEMO-ADMIN';
const MANAGEMENT_REMEMBER_KEY='rice-magician-management-remember-v24';
const MANAGEMENT_SESSION_KEY='rice-magician-management-session-v24';
const managementState={token:'',remembered:false,expiresAt:''};
const managementProject=String(CONFIG.supabaseUrl||'DEMO').trim().toLowerCase();
function storeManagementCredential(value){
  clearManagementStorage();
  const item=JSON.stringify({project:managementProject,token:value.token,
    remembered:Boolean(value.remembered),expiresAt:value.expires_at});
  (value.remembered?localStorage:sessionStorage).setItem(
    value.remembered?MANAGEMENT_REMEMBER_KEY:MANAGEMENT_SESSION_KEY,item);
}
function clearManagementStorage(){
  localStorage.removeItem(MANAGEMENT_REMEMBER_KEY);
  sessionStorage.removeItem(MANAGEMENT_SESSION_KEY);
}
function readManagementCredential(){
  for(const [storage,key] of [[localStorage,MANAGEMENT_REMEMBER_KEY],[sessionStorage,MANAGEMENT_SESSION_KEY]]){
    try{
      const item=JSON.parse(storage.getItem(key)||'null');
      if(item?.project===managementProject && /^[a-f0-9]{64}$/.test(item?.token||'') &&
        Number.isFinite(Date.parse(item?.expiresAt)) && Date.parse(item.expiresAt)>Date.now())
        return item;
      if(item)storage.removeItem(key);
    }catch{storage.removeItem(key);}
  }
  return null;
}
function resetManagementState(){
  managementState.token='';managementState.remembered=false;managementState.expiresAt='';
  clearManagementStorage();renderManagementState();
}
function renderManagementState(){
  const unlocked=!!managementState.token && Date.parse(managementState.expiresAt)>Date.now();
  show('management-locked',!unlocked);
  show('management-unlocked',unlocked);
  if(unlocked){
    const expires=formatTime(managementState.expiresAt);
    $('management-active-description').textContent=managementState.remembered
      ?`已記住此瀏覽器，有效期限：${expires}。期間可直接建立班級。`
      :`本次操作已解鎖，有效期限：${expires}；關閉分頁或逾時後需重新驗證。`;
  }
}

const state = {
  current:0,answers:[],classCode:'',className:'',seat:0,runId:'',
  answered:false,saving:false,saved:false,remote:null,teacherData:[],
  teacherKeys:[],shownRecords:[],view:'student',ready:false,checking:false
};

function loadSessionKeys() {
  try { const a=JSON.parse(sessionStorage.getItem(TEACHER_SESSION)||'[]'); return Array.isArray(a)?a.filter(k=>typeof k==='string'):[]; }
  catch { return []; }
}
function saveSessionKeys(){sessionStorage.setItem(TEACHER_SESSION,JSON.stringify(state.teacherKeys));}
function readDemo(){
  try { const a=JSON.parse(localStorage.getItem(STORAGE)||'[]'); return Array.isArray(a)?a:[]; }
  catch { return []; }
}
function newRunId(){
  if(window.crypto?.randomUUID) return crypto.randomUUID();
  const b=new Uint8Array(16); crypto.getRandomValues(b);
  b[6]=(b[6]&15)|64; b[8]=(b[8]&63)|128;
  return [...b].map((x,i)=>([4,6,8,10].includes(i)?'-':'')+x.toString(16).padStart(2,'0')).join('');
}
function formatTime(raw){
  const d=new Date(raw);
  return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('zh-TW',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Taipei'}).format(d);
}
function errorMessage(e){
  if(!e) return '發生未知錯誤';
  const message=String(e.message||e);
  if(/Failed to fetch|NetworkError|Load failed/i.test(message)) return '網路連線失敗，請稍後再試。';
  if(/班級管理授權已過期或無效/.test(message)) return '班級管理授權已過期或無效，請重新解鎖。';
  if(/班級管理碼不正確/.test(message)) return '班級管理碼不正確，請確認 SQL Editor 提供的管理碼。';
  if(/班級代碼已存在/.test(message)) return '這個班級代碼已被使用，請改用其他代碼。';
  if(/查閱碼錯誤/.test(message)) return '查閱碼不正確。';
  if(/PGRST202|rice_health_check|schema cache|Could not find the function/i.test(message))
    return '尚未建立此版本的 Supabase 資料庫函式，請先執行 sql/01_schema.sql。';
  if(/不得使用|secret key|service_role/i.test(message)) return message;
  if(/Invalid API key|No API key found|API key is invalid|JWT|401|403/i.test(message))
    return 'Supabase 公開金鑰無效或缺少 API 權限，請檢查 config.js 與 SQL 授權。';
  if(/班級代碼錯誤/.test(message)) return '找不到此班級代碼。';
  if(/班級數量已達上限|班級名稱/.test(message)) return message;
  if(/限制|上限|過於頻繁|尚未準備好|尚未連接|必須同時填寫|Project URL 格式錯誤|請在 config.js|無法載入 Supabase|資料庫版本與網站不一致|資料庫版本不符|金鑰|不得使用|請輸入/.test(message)) return message;
  console.error('資料服務錯誤:',e);
  return '無法完成操作，請檢查資料庫連線或重新嘗試。';
}

const backend = {
  async call(name,args,skipReady=false){
    if(!state.remote || (!state.ready && !skipReady)) throw new Error('資料服務尚未準備好，請重新檢查連線');
    const {data,error}=await state.remote.rpc(name,args);
    if(error) throw error;
    return data;
  },
  async lookup(code){
    if(DEMO){
      const c=DEMO_CLASSES.find(c=>c.class_code===code);
      if(!c) throw new Error('班級代碼錯誤');
      return {class_name:c.class_name,class_code:c.class_code};
    }
    const data=await this.call('rice_lookup_class',{p_code:code});
    if(!data) throw new Error('班級代碼錯誤');
    return data;
  },
  async submit(code,seat,answers,runId){
    if(DEMO){
      const all=readDemo();
      const previous=all.find(r=>r.client_run_id===runId);
      if(previous) return previous;
      const cls=DEMO_CLASSES.find(c=>c.class_code===code);
      if(!cls) throw new Error('班級代碼錯誤');
      const wrong=answers.flatMap((answer,i)=>answer===QUESTIONS[i][1]?[]:[i+1]);
      const record={id:Date.now()*100+Math.floor(Math.random()*100),client_run_id:runId,
        class_code:code,seat_number:seat,score:12-wrong.length,total:12,
        wrong_items:wrong,submitted_at:new Date().toISOString()};
      all.push(record);localStorage.setItem(STORAGE,JSON.stringify(all));
      return record;
    }
    return this.call('rice_submit_attempt',{
      p_class_code:code,p_seat_number:seat,p_answers:answers,p_client_run_id:runId
    });
  },
  async managementUnlock(code,remember){
    if(DEMO){
      if(code!==DEMO_MANAGEMENT_CODE)throw new Error('班級管理碼不正確');
      return {token:newRunId().replaceAll('-','')+newRunId().replaceAll('-',''),
        remembered:remember,expires_at:new Date(Date.now()+(remember?30*24:4)*3600000).toISOString()};
    }
    return this.call('rice_management_unlock',{p_management_code:code,p_remember:remember});
  },
  async managementValidate(token){
    if(DEMO)return {valid:/^[a-f0-9]{64}$/.test(token),remembered:managementState.remembered};
    return this.call('rice_management_validate',{p_token:token});
  },
  async managementForget(token){
    if(DEMO)return true;
    return this.call('rice_management_forget',{p_token:token});
  },
  async createClassWithToken(token,classCode,className){
    if(DEMO){
      if(token!==managementState.token || Date.parse(managementState.expiresAt)<=Date.now())
        throw new Error('班級管理授權已過期或無效，請重新輸入管理碼');
      return this.createClass(DEMO_MANAGEMENT_CODE,classCode,className);
    }
    return this.call('rice_create_class_with_token',{
      p_token:token,p_class_code:classCode,p_class_name:className
    });
  },
  async createClass(managerCode,classCode,className){
    if(DEMO){
      if(managerCode!==DEMO_MANAGEMENT_CODE) throw new Error('班級管理碼不正確');
      if(DEMO_CLASSES.some(c=>c.class_code===classCode)) throw new Error('班級代碼已存在，請換一組代碼。');
      const newClass={class_name:className,class_code:classCode,teacher_key:'DEMO-'+newRunId()};
      DEMO_CLASSES.push(newClass);
      localStorage.setItem(DEMO_CUSTOM_CLASSES_KEY,JSON.stringify(DEMO_CLASSES.filter(c=>c.teacher_key!== 'DEMO-401' && c.teacher_key!=='DEMO-402')));
      return newClass;
    }
    return this.call('rice_create_class',{
      p_management_code:managerCode,p_class_code:classCode,p_class_name:className
    });
  },
  async teacher(key){
    if(DEMO){
      const cls=DEMO_CLASSES.find(c=>c.teacher_key===key);
      if(!cls) throw new Error('查閱碼錯誤');
      const records=readDemo().filter(r=>r.class_code===cls.class_code);
      return {class_name:cls.class_name,class_code:cls.class_code,records};
    }
    return this.call('rice_teacher_results',{p_teacher_key:key});
  }
};

function connectionStatus(kind,message,retry=false){
  const panel=$('connection-panel');
  show('connection-panel',true);
  $('environment-banner').className=`banner banner-${kind}`;
  $('environment-banner').textContent=message;
  show('retry-connection',retry);
}
function validateSupabaseSettings(urlInput,keyInput){
  const url=String(urlInput||'').trim().replace(/\/$/,'');
  const key=String(keyInput||'').trim();
  if(!url || !key) throw new Error('必須同時填寫 Project URL 與 publishable key。');
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url))
    throw new Error('Project URL 格式錯誤，請使用 https://專案ID.supabase.co。');
  if(key.startsWith('sb_secret_') || /service_role/i.test(key))
    throw new Error('不得使用 secret key 或 service_role 金鑰。');
  if(key.startsWith('eyJ')){
    try {
      const payload=key.split('.')[1];
      const decoded=JSON.parse(atob(payload.replace(/-/g,'+').replace(/_/g,'/')));
      if(decoded.role !== 'anon') throw new Error('不得使用 service_role 或非 anon 的 JWT 金鑰。');
    }catch(err){
      if(/不得使用/.test(String(err.message))) throw err;
      throw new Error('舊版 anon JWT 格式無效，請使用公開 anon key。');
    }
  } else if(!/^sb_publishable_[a-zA-Z0-9_-]+$/.test(key)){
    throw new Error('公開金鑰格式錯誤，只接受 sb_publishable_ 或舊版 anon JWT。');
  }
  return {supabaseUrl:url,supabaseAnonKey:key};
}
function checkBackendConfig(){
  return validateSupabaseSettings(CONFIG.supabaseUrl,CONFIG.supabaseAnonKey);
}
async function verifyConnection(){
  if(DEMO || state.checking) return;
  state.checking=true;state.ready=false;
  $('retry-connection').disabled=true;
  connectionStatus('working','正在驗證 Supabase 連線與資料庫版本…');
  try{
    checkBackendConfig();
    if(!window.supabase?.createClient)
      throw new Error('無法載入 Supabase JavaScript 函式庫。請檢查網路或 CDN 連線。');
    if(!state.remote){
      state.remote=window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey,{
        auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
      });
    }
    const result=await state.remote.rpc('rice_health_check',{});
    if(result.error) throw result.error;
    if(result.data?.app!=='rice-magician' || result.data?.schema_version!==REQUIRED_DB_VERSION || Number(result.data?.question_count)!==QUESTIONS.length){
      throw new Error('資料庫版本與網站不一致。請執行本版本的 sql/01_schema.sql。');
    }
    state.ready=true;
    connectionStatus('ok',`Supabase 已連線（${LOCAL_OVERRIDE?'此裝置自訂':'GitHub 部署'}）：班級與成績會同步儲存在雲端。`);
    await restoreManagement();
    if(state.view==='teacher' && state.teacherKeys.length) await refreshTeacher();
  }catch(err){
    connectionStatus('error',`尚未連接正式資料庫：${errorMessage(err)}`,true);
  }finally{
    state.checking=false;$('retry-connection').disabled=false;
  }
}

function selectView(view){
  const teacher=view==='teacher',student=view==='student',settings=view==='settings';
  state.view=view;
  show('student-view',student);show('teacher-view',teacher);show('settings-view',settings);
  for(const tab of ['student','teacher','settings']){
    $(tab+'-tab').classList.toggle('active',tab===view);
    $(tab+'-tab').setAttribute('aria-selected',String(tab===view));
  }
  if(teacher && state.teacherKeys.length && !state.teacherData.length && (DEMO || state.ready)) refreshTeacher();
}

function startQuiz(){
  state.current=0;state.answers=[];state.answered=false;state.saved=false;
  state.runId=newRunId();
  show('start-form',false);show('quiz-area',true);show('quiz-progress',true);
  $('student-identity').textContent=`${state.className} · ${state.seat} 號`;
  renderQuestion();
}
function renderQuestion(){
  const i=state.current;
  $('quiz-progress').textContent=`${i+1} / ${QUESTIONS.length}`;
  $('question-title').textContent=QUESTIONS[i][0];
  show('answer-feedback',false);show('question-explanation',false);
  show('next-button',false);show('quiz-complete',false);
  $('answer-options').querySelectorAll('button').forEach(b=>{
    b.disabled=false;b.classList.remove('correct','wrong');
  });
  $('question-title').focus({preventScroll:true});
}
async function handleAnswer(choice){
  if(state.answered || state.saved || state.answers.length!==state.current)return;
  state.answered=true;
  state.answers.push(choice);
  const correct=choice===QUESTIONS[state.current][1];
  $('answer-options').querySelectorAll('button').forEach(b=>{
    b.disabled=true;
    b.classList.toggle('correct',b.dataset.choice===QUESTIONS[state.current][1]);
    b.classList.toggle('wrong',b.dataset.choice===choice && !correct);
  });
  const feedback=$('answer-feedback');
  feedback.textContent=correct?'答對了！你真懂米食 ✦':'答錯了！正確答案已用綠色標示。';
  feedback.className=`feedback ${correct?'right':'incorrect'}`;
  show('answer-feedback',true);
  $('question-explanation').textContent=QUESTIONS[state.current][2];
  show('question-explanation',true);
  if(state.current===QUESTIONS.length-1){
    const score=state.answers.filter((a,i)=>a===QUESTIONS[i][1]).length;
    $('final-score').textContent=`測驗完成！你答對 ${score} / 12 題。`;
    show('quiz-complete',true);await saveResult();
  }else show('next-button',true);
}
async function saveResult(){
  if(state.saving || state.saved || state.answers.length!==QUESTIONS.length)return;
  state.saving=true;
  show('retry-save',false);show('restart-button',false);
  $('save-status').textContent='正在儲存結果…';
  try{
    const result=await backend.submit(state.classCode,state.seat,[...state.answers],state.runId);
    state.saved=true;
    $('final-score').textContent=`測驗完成！你答對 ${Number(result.score)} / 12 題。`;
    $('save-status').textContent=DEMO?'已儲存至這台裝置的示範資料，不會同步到其他裝置。':'成績已儲存，教師可在班級成效頁查看。';
    show('restart-button',true);
  }catch(err){
    $('save-status').textContent=`結果尚未儲存：${errorMessage(err)}`;
    show('retry-save',true);show('restart-button',true);
  }finally{state.saving=false;}
}

function normalizeRecords(){
  const sorted=state.teacherData.flatMap(cls=>(cls.records||[]).map(r=>({...r,class_name:cls.class_name,class_code:cls.class_code})))
    .sort((a,b)=>Date.parse(a.submitted_at)-Date.parse(b.submitted_at)||Number(a.id)-Number(b.id));
  const counts=new Map();
  return sorted.map((r,i)=>{
    const group=`${r.class_code}::${r.seat_number}`;
    const attempt=(counts.get(group)||0)+1;
    counts.set(group,attempt);
    return {...r,group,attempt,seq:i};
  });
}
function replaceOptions(select,options){
  const old=select.value;
  select.replaceChildren(...options.map(([value,label])=>new Option(label,value)));
  if(options.some(([value])=>value===old))select.value=old;
}
function renderDashboard(){
  const data=normalizeRecords();
  const currentClasses=[['all','全部已加入班級'],...state.teacherData.map(c=>[c.class_code,c.class_name])];
  replaceOptions($('class-filter'),currentClasses);
  const chosenClass=$('class-filter').value;
  const within=data.filter(r=>chosenClass==='all'||r.class_code===chosenClass);
  const maxAttempt=Math.max(1,...within.map(r=>r.attempt));
  replaceOptions($('attempt-filter'),Array.from({length:maxAttempt},(_,i)=>[String(i+1),`第 ${i+1} 次`]));
  const mode=$('view-mode').value;
  show('attempt-control',mode==='attempt');
  let rows=[];
  if(mode==='attempt')rows=within.filter(r=>r.attempt===Number($('attempt-filter').value));
  else if(mode==='best'||mode==='latest'){
    const chosen=new Map();
    for(const r of within){
      const prev=chosen.get(r.group);
      if(!prev||(mode==='latest')||(Number(r.score)>Number(prev.score))) chosen.set(r.group,r);
    }
    rows=[...chosen.values()];
  }else rows=[...within];
  rows.sort(mode==='all'?((a,b)=>b.seq-a.seq):((a,b)=>a.class_name.localeCompare(b.class_name,'zh-Hant')||a.seat_number-b.seat_number));
  state.shownRecords=rows;
  $('attempts-value').textContent=String(rows.length);
  $('students-value').textContent=String(new Set(rows.map(r=>r.group)).size);
  $('average-value').textContent=rows.length?`${(rows.reduce((s,r)=>s+Number(r.score),0)/rows.length).toFixed(1)} / 12`:'—';
  const name=chosenClass==='all'?'全部已加入班級':(state.teacherData.find(c=>c.class_code===chosenClass)?.class_name||chosenClass);
  const viewName=mode==='attempt'?`第 ${$('attempt-filter').value} 次測驗`:({all:'全部歷次紀錄',best:'歷史最佳成績',latest:'最新一次成績'}[mode]);
  $('filter-summary').textContent=`${name} · ${viewName}：${rows.length} 筆紀錄。平均與錯題次數只根據目前篩選結果計算。`;
  const wrong=Array(QUESTIONS.length).fill(0);
  rows.forEach(r=>{
    for(const n of new Set(Array.isArray(r.wrong_items)?r.wrong_items:String(r.wrong_items||'').split(',').map(Number))){
      if(Number.isInteger(Number(n))&&Number(n)>0&&Number(n)<=12)wrong[Number(n)-1]++;
    }
  });
  const target=$('wrong-stats');target.replaceChildren();
  wrong.forEach((count,i)=>{
    const row=document.createElement('div');
    row.innerHTML=`<div class="wrong-row-top"><span>第 ${i+1} 題</span><span>${count} 次（${rows.length?Math.round(count/rows.length*100):0}%）</span></div><div class="stat-bar"><div class="stat-fill" style="width:${rows.length?count/rows.length*100:0}%"></div></div>`;
    target.appendChild(row);
  });
  const tbody=$('records-body');tbody.replaceChildren();
  rows.forEach(r=>{
    const tr=document.createElement('tr');
    const wrongText=(Array.isArray(r.wrong_items)?r.wrong_items:String(r.wrong_items||'').split(',').filter(Boolean)).join('、')||'無';
    for(const x of [r.class_name,String(r.seat_number),`第 ${r.attempt} 次`,`${r.score} / 12`,wrongText,formatTime(r.submitted_at)]){
      const td=document.createElement('td');td.textContent=x;tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  show('empty-records',rows.length===0);show('records-wrap',rows.length!==0);
  $('empty-records').textContent=within.length?'所選測驗次數尚無紀錄。':'所選班級尚無完成測驗的紀錄。';
  show('dashboard-content',state.teacherData.length>0);
}
function renderClassChips(){
  const list=$('linked-classes');list.replaceChildren();
  state.teacherData.forEach(c=>{
    const chip=document.createElement('div');chip.className='class-chip';
    const text=document.createElement('span');text.textContent=`${c.class_name}（${c.class_code}）`;
    const btn=document.createElement('button');btn.type='button';btn.textContent='×';btn.title=`移除 ${c.class_name}`;
    btn.setAttribute('aria-label',`移除 ${c.class_name}`);
    btn.addEventListener('click',()=>{
      state.teacherKeys=state.teacherKeys.filter(k=>k!==c.teacherKey);
      state.teacherData=state.teacherData.filter(d=>d.teacherKey!==c.teacherKey);
      saveSessionKeys();renderClassChips();renderDashboard();
      if(!state.teacherKeys.length)$('dashboard-status').textContent='請先輸入班級成績查閱碼。';
    });
    chip.append(text,btn);list.appendChild(chip);
  });
}
async function refreshTeacher(){
  $('refresh-button').disabled=true;
  if(!state.teacherKeys.length){
    state.teacherData=[];renderClassChips();show('dashboard-content',false);
    $('dashboard-status').textContent='請先輸入班級成績查閱碼。';
    $('refresh-button').disabled=false;return;
  }
  $('dashboard-status').textContent='正在讀取班級成績…';
  const results=await Promise.allSettled(state.teacherKeys.map(key=>backend.teacher(key)));
  const success=[];const errors=[];const validKeys=[];
  results.forEach((result,i)=>{
    if(result.status==='fulfilled'){
      success.push({...result.value,teacherKey:state.teacherKeys[i]});
      validKeys.push(state.teacherKeys[i]);
    }else {
      errors.push(errorMessage(result.reason));
      // 網路暫時斷線時保留查閱碼以便重新整理；只有明確無效才移除。
      if(!/查閱碼錯誤/.test(String(result.reason?.message||result.reason)))
        validKeys.push(state.teacherKeys[i]);
    }
  });
  // 失敗的查閱碼不保留，避免誤植後無法從頁面清除。
  state.teacherKeys=validKeys;
  saveSessionKeys();
  state.teacherData=success;
  renderClassChips();renderDashboard();
  $('dashboard-status').textContent=errors.length?`有 ${errors.length} 個班級讀取失敗：${errors[0]}`:`已載入 ${success.length} 個班級的最新成績。`;
  $('refresh-button').disabled=false;
}
function csvSafe(value){
  let text=String(value??'');
  if(/^[=+@\-\t\r]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
function exportCsv(){
  const rows=[['班級','班級代碼','座號','第幾次','得分','總題數','答錯題號','完成時間']];
  state.shownRecords.forEach(r=>rows.push([r.class_name,r.class_code,r.seat_number,r.attempt,r.score,12,
    (Array.isArray(r.wrong_items)?r.wrong_items:String(r.wrong_items||'').split(',').filter(Boolean)).join('、'),formatTime(r.submitted_at)]));
  const blob=new Blob(['\ufeff'+rows.map(row=>row.map(csvSafe).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`米粒魔術師_成績_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500);
}

// Supabase 公開連線設定與班級管理介面分離：管理碼不可寫入 config.js。
function setSettingsFeedback(message,kind='neutral'){
  $('settings-feedback').textContent=message;
  $('settings-feedback').className=`message settings-${kind}`;
}
function setDiagnostic(rows){
  $('diagnostic-checks').replaceChildren(...rows.map(([ok,label])=>{
    const row=document.createElement('div');
    row.className=`diagnostic-row ${ok==='ok'?'diagnostic-ok':ok==='fail'?'diagnostic-fail':''}`;
    row.textContent=`${ok==='ok'?'✓':ok==='fail'?'✕':'○'} ${label}`;
    return row;
  }));
}
function getFormSettings(){return validateSupabaseSettings($('settings-url').value,$('settings-key').value);}
function describeSettingsSource(){
  $('config-source').textContent=LOCAL_OVERRIDE?'此裝置自訂設定':DEMO?'尚未部署連線設定':'GitHub 部署設定';
  const pub=String(DEPLOYED_CONFIG.supabaseUrl||'');
  $('published-config-info').textContent=pub?`目前 config.js：${pub}（公開金鑰已隱藏）`:'目前 config.js 未填寫 Supabase 連線資訊。';
  $('reset-settings').disabled=!LOCAL_OVERRIDE;
  $('settings-url').value=String(CONFIG.supabaseUrl||'');
  $('settings-key').value=String(CONFIG.supabaseAnonKey||'');
}
async function diagnoseSettings(){
  const btn=$('test-settings');btn.disabled=true;
  setDiagnostic([['wait','檢查公開設定格式'],['wait','連線至 Supabase API'],['wait','確認資料庫版本與題目數量']]);
  try{
    const config=getFormSettings();
    setDiagnostic([['ok','公開設定格式正確'],['wait','連線至 Supabase API'],['wait','確認資料庫版本與題目數量']]);
    if(!window.supabase?.createClient) throw new Error('無法載入 Supabase JavaScript 函式庫，請確認網路與 CDN。');
    const client=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
    });
    const {data,error}=await client.rpc('rice_health_check',{});
    if(error) throw error;
    setDiagnostic([['ok','公開設定格式正確'],['ok','Supabase API 已回應'],['wait','確認資料庫版本與題目數量']]);
    if(data?.app!=='rice-magician' || data?.schema_version!==REQUIRED_DB_VERSION || Number(data?.question_count)!==QUESTIONS.length){
      throw new Error(`資料庫版本不符（網站需要 ${REQUIRED_DB_VERSION} 與 ${QUESTIONS.length} 題）。請確認使用正確的 SQL。`);
    }
    setDiagnostic([['ok','公開設定格式正確'],['ok','Supabase API 已回應'],['ok',`資料庫 v${REQUIRED_DB_VERSION}、${QUESTIONS.length} 題，檢查通過`]]);
    setSettingsFeedback('連線測試通過！此操作尚未儲存設定，也未進行實際成績寫入。','success');
  }catch(error){
    const msg=errorMessage(error);
    setDiagnostic([['wait','請核對設定與 Supabase 函式'],['fail',msg],['wait','待連線成功後確認資料庫版本']]);
    setSettingsFeedback(`連線測試失敗：${msg}`,'error');
  }finally{btn.disabled=false;}
}
function getConfigFileContent(value){
  // 僅放入已驗證的公開設定；JSON.stringify 防止額外程式碼注入。
  return `/* GitHub Pages 公開 Supabase 設定（可提交至 GitHub）\n * 不得放入教師查閱碼、secret 或 service_role 金鑰。 */\nwindow.RICE_CONFIG = Object.freeze(${JSON.stringify(value,null,2)});\n`;
}
function downloadTextFile(text,filename){
  const url=URL.createObjectURL(new Blob([text],{type:'text/javascript;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=filename;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function setClassFeedback(message,kind='neutral'){
  const target=$('class-create-feedback');
  target.textContent=message;
  target.className=`message settings-${kind}`;
}
async function restoreManagement(){
  const saved=readManagementCredential();
  if(!saved){renderManagementState();return;}
  if(!DEMO && !state.ready){renderManagementState();return;}
  setClassFeedback('正在確認這台瀏覽器的管理授權…');
  try{
    const result=await backend.managementValidate(saved.token);
    if(result?.valid!==true)throw new Error('授權已失效');
    managementState.token=saved.token;
    managementState.remembered=Boolean(saved.remembered);
    managementState.expiresAt=String(result.expires_at||saved.expiresAt);
    renderManagementState();
    setClassFeedback('已恢復此瀏覽器的班級管理權限。','success');
  }catch(error){
    // 網路暫時異常時不刪除仍可能有效的裝置憑證，但不能跳過伺服器驗證。
    managementState.token='';renderManagementState();
    if(/授權已失效|過期|無效/.test(String(error.message||error))){
      clearManagementStorage();
      setClassFeedback('原有管理授權已失效，請重新輸入管理碼。','error');
    }else setClassFeedback(`暫時無法確認裝置授權：${errorMessage(error)}。請重新檢查連線。`,'error');
  }
}
function setupClassManagement(){
  renderManagementState();
  $('toggle-management-code').addEventListener('click',()=>{
    const inp=$('class-management-code');
    const reveal=inp.type==='password';
    inp.type=reveal?'text':'password';
    $('toggle-management-code').textContent=reveal?'隱藏':'顯示';
    $('toggle-management-code').setAttribute('aria-pressed',String(reveal));
  });
  $('management-unlock-form').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!DEMO && !state.ready){setClassFeedback('尚未連上 Supabase，請先檢查連線。','error');return;}
    const code=$('class-management-code').value.trim();
    if(!DEMO && !/^[a-f0-9]{64}$/.test(code)){
      setClassFeedback('請輸入 64 碼班級管理碼。','error');return;
    }
    const remember=$('remember-device').checked;
    const button=$('management-unlock-button');button.disabled=true;
    setClassFeedback('正在驗證管理碼…');
    try{
      const data=await backend.managementUnlock(code,remember);
      if(!/^[a-f0-9]{64}$/.test(data?.token||'') || !Number.isFinite(Date.parse(data?.expires_at)))
        throw new Error('管理授權回傳格式不正確');
      managementState.token=data.token;
      managementState.expiresAt=data.expires_at;
      managementState.remembered=Boolean(data.remembered);
      storeManagementCredential(data);
      $('class-management-code').value='';
      renderManagementState();
      setClassFeedback(remember?'已解鎖，這台瀏覽器將記住 30 天。':'已解鎖，本次可連續建立班級。','success');
    }catch(error){setClassFeedback(errorMessage(error),'error');}
    finally{button.disabled=false;}
  });
  $('management-forget-button').addEventListener('click',async()=>{
    const token=managementState.token;
    if(!token){resetManagementState();return;}
    $('management-forget-button').disabled=true;
    // 先在本機清除；資料庫端盡力撤銷，使即使憑證遭複製亦不可繼續使用。
    resetManagementState();
    setClassFeedback('已在此瀏覽器鎖定，正在撤銷 Supabase 授權…');
    try{
      await backend.managementForget(token);
      setClassFeedback('已鎖定並取消記住此瀏覽器；再次管理需輸入管理碼。','success');
    }catch(error){
      setClassFeedback(`此瀏覽器已清除授權，但 Supabase 撤銷未確認：${errorMessage(error)}。必要時請輪替管理碼。`,'error');
    }finally{$('management-forget-button').disabled=false;}
  });
  $('new-class-code').addEventListener('input',()=>{
    const inp=$('new-class-code');
    inp.value=inp.value.toUpperCase().replace(/[^A-Z0-9]/g,'');
  });
  $('create-class-form').addEventListener('submit',async event=>{
    event.preventDefault();
    show('class-created-result',false);
    const name=$('new-class-name').value.trim();
    const code=$('new-class-code').value.trim().toUpperCase();
    if(!name||name.length>40){setClassFeedback('班級名稱必須為 1～40 個字。','error');return;}
    if(!/^[A-Z0-9]{6,12}$/.test(code)){setClassFeedback('班級代碼只能使用 6～12 位英文字母或數字。','error');return;}
    if(!managementState.token || Date.parse(managementState.expiresAt)<=Date.now()){
      resetManagementState();setClassFeedback('管理授權已過期，請重新輸入管理碼。','error');return;
    }
    if(!DEMO && !state.ready){setClassFeedback('目前尚未連接 Supabase。','error');return;}
    const btn=$('create-class-button');btn.disabled=true;
    setClassFeedback('正在建立新班級…');
    try{
      const result=await backend.createClassWithToken(managementState.token,code,name);
      if(!result || result.class_code!==code || typeof result.teacher_key!=='string')
        throw new Error('新增班級成功，但回傳資料格式不符合預期。請至 SQL Editor 檢查。');
      $('created-class-name').textContent=result.class_name;
      $('created-class-code').textContent=result.class_code;
      $('created-teacher-key').value=result.teacher_key;
      if(!state.teacherKeys.includes(result.teacher_key))state.teacherKeys.push(result.teacher_key);
      saveSessionKeys();
      show('class-created-result',true);
      setClassFeedback(`已建立 ${result.class_name}（${result.class_code}），請立即備份教師查閱碼。`,'success');
    }catch(error){
      const msg=String(error?.message||'');
      if(/管理授權已過期|管理授權.*無效/.test(msg)){
        resetManagementState();setClassFeedback('管理授權失效，請重新解鎖。','error');
      }else if(/PGRST202|rice_create_class_with_token|Could not find the function/i.test(msg)){
        setClassFeedback('找不到 v2.4 班級管理函式，請先執行 sql/08_remember_device.sql。','error');
      }else setClassFeedback(errorMessage(error),'error');
    }finally{btn.disabled=false;}
  });
  $('copy-created-key').addEventListener('click',async()=>{
    const key=$('created-teacher-key').value;
    if(!key)return;
    try{await navigator.clipboard.writeText(key);setClassFeedback('教師查閱碼已複製，請妥善保存。','success');}
    catch{$('created-teacher-key').focus();$('created-teacher-key').select();setClassFeedback('瀏覽器無法自動複製，已選取文字，請手動複製。');}
  });
  $('open-created-class').addEventListener('click',()=>{
    selectView('teacher');refreshTeacher();
  });
}
function setupSettings(){
  describeSettingsSource();
  $('toggle-key').addEventListener('click',()=>{
    const visible=$('settings-key').type==='password';
    $('settings-key').type=visible?'text':'password';
    $('toggle-key').textContent=visible?'隱藏':'顯示';
    $('toggle-key').setAttribute('aria-pressed',String(visible));
  });
  $('test-settings').addEventListener('click',diagnoseSettings);
  $('supabase-settings-form').addEventListener('submit',e=>{
    e.preventDefault();
    try{
      const config=getFormSettings();
      localStorage.setItem(SETTINGS_STORAGE,JSON.stringify(config));
      // 防止切換 Supabase 後，把舊專案的教師查閱碼送給新服務。
      sessionStorage.removeItem(TEACHER_SESSION);
      clearManagementStorage();
      setSettingsFeedback('本機設定已儲存，正在重新載入以套用新連線…','success');
      window.location.reload();
    }catch(err){setSettingsFeedback(errorMessage(err),'error');}
  });
  $('download-config').addEventListener('click',()=>{
    try{
      const value=getFormSettings();
      downloadTextFile(getConfigFileContent(value),'config.js');
      setSettingsFeedback('已產生部署用 config.js。請將它取代 GitHub repository 根目錄的同名檔案並等待 Pages 部署。這不會自動修改 GitHub。','success');
    }catch(err){setSettingsFeedback(errorMessage(err),'error');}
  });
  $('reset-settings').addEventListener('click',()=>{
    localStorage.removeItem(SETTINGS_STORAGE);
    sessionStorage.removeItem(TEACHER_SESSION);
    clearManagementStorage();
    setSettingsFeedback('已清除本機覆蓋，正在重新載入 GitHub 部署設定…','success');
    window.location.reload();
  });
}

async function main(){
  state.teacherKeys=loadSessionKeys();
  if(DEMO){
    connectionStatus('demo','目前是示範模式：資料僅存在這台瀏覽器，不會跨裝置同步。學生班級代碼 RICE401／RICE402；教師查閱碼 DEMO-401／DEMO-402；新增示範班級請使用管理碼 DEMO-ADMIN。正式上線請設定 config.js 與 Supabase SQL。');
  }else{
    connectionStatus('working','正式資料庫尚在檢查中…');
  }
  $('retry-connection').addEventListener('click',verifyConnection);
  $('student-tab').addEventListener('click',()=>selectView('student'));
  $('teacher-tab').addEventListener('click',()=>selectView('teacher'));
  $('settings-tab').addEventListener('click',()=>selectView('settings'));
  setupSettings();
  setupClassManagement();
  $('start-form').addEventListener('submit',async e=>{
    e.preventDefault();show('start-error',false);
    const code=$('class-code').value.trim().toUpperCase();
    const seat=Number($('seat-number').value);
    if(!/^[A-Z0-9]{6,12}$/.test(code)||!Number.isInteger(seat)||seat<1||seat>99){
      $('start-error').textContent='請填寫正確班級代碼（6～12 碼英數）及 1～99 的座號。';show('start-error',true);return;
    }
    $('start-button').disabled=true;
    try{
      const found=await backend.lookup(code);
      state.classCode=found.class_code;state.className=found.class_name;state.seat=seat;
      startQuiz();
    }catch(err){$('start-error').textContent=errorMessage(err);show('start-error',true);}
    finally{$('start-button').disabled=false;}
  });
  $('answer-options').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>handleAnswer(b.dataset.choice)));
  $('next-button').addEventListener('click',()=>{if(!state.answered)return;state.current++;state.answered=false;renderQuestion();});
  $('retry-save').addEventListener('click',saveResult);
  $('restart-button').addEventListener('click',()=>{
    if(state.saving)return;
    show('quiz-area',false);show('quiz-progress',false);show('start-form',true);
    state.answers=[];state.current=0;state.answered=false;state.saved=false;state.runId='';
  });
  $('teacher-key-form').addEventListener('submit',async e=>{
    e.preventDefault();const key=$('teacher-key').value.trim();
    if(!key){return;}
    if(!state.teacherKeys.includes(key))state.teacherKeys.push(key);
    saveSessionKeys();$('teacher-key').value='';await refreshTeacher();
  });
  $('refresh-button').addEventListener('click',refreshTeacher);
  ['class-filter','view-mode','attempt-filter'].forEach(id=>$(id).addEventListener('change',renderDashboard));
  $('export-csv').addEventListener('click',exportCsv);
  // 教師可以用 hash 分享不含帳號的班級查閱連結；讀取後立即從網址移除查閱碼。
  const hash=new URLSearchParams(location.hash.replace(/^#/,''));
  const sharedKey=hash.get('teacher');
  if(sharedKey){
    if(!state.teacherKeys.includes(sharedKey))state.teacherKeys.push(sharedKey);
    saveSessionKeys();history.replaceState(null,'',location.pathname+location.search);
    selectView('teacher');
  }
  if(!DEMO) await verifyConnection();
  else { await restoreManagement(); if(sharedKey) await refreshTeacher(); }
}
main();
