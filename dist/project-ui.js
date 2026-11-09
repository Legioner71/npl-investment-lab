'use strict';
let project=null,projectModel=null,projectDemo=null,projectDirty=false,projectSavedHash='',projectLastHash='';
const projectSteps=[['register','1 · Дані'],['prepurchase','2 · Прогноз'],['strategy','3 · План і бюджет'],['overview','4 · Оцінка'],['montecarlo','5 · Ризик'],['monitoring','6 · Рішення і факт']];
function projectSource(){return project.source==='ml'?'ML · Logistic + Ridge':'Сценарні частки сегментів';}
function projectEvaluate(next=options){return PROJECT.evaluate({...project,rows,options:PROJECT.cleanOptions(next),strategy_params:strategyState.loaded?strategyState.params:project.strategy_params},projectModel);}
async function projectInitialize(){
  const load=async name=>{const r=await fetch(name);if(!r.ok)throw Error('Не вдалося завантажити '+name);return r.json();};
  const [pack,ops,model,validation]=await Promise.all(['prepurchase-case.json','strategy-operations.json','prepurchase-model.json','prepurchase-validation.json'].map(load));
  projectModel=model;preState.model=model;preState.validation=validation;
  projectDemo=PROJECT.fromPackage(pack,{name:'UA Consumer / демопортфель',options:demo.meta.defaults,operations:ops});
  project=structuredClone(projectDemo);rows=project.rows;options=PROJECT.cleanOptions(project.options);result=PROJECT.evaluate(project,projectModel);options=result.options;
  projectSavedHash=result.project_context.fingerprint;projectLastHash=projectSavedHash;projectSync();
}
function projectSync(){
  if(!project||!result.project_context)return;
  project.rows=rows;project.options=PROJECT.cleanOptions(options);project.strategy_params={...(strategyState.loaded?strategyState.params:project.strategy_params)};
  portfolioName=project.name;imported=!project.synthetic;
  const c=result.project_context;
  if(projectLastHash&&projectLastHash!==c.fingerprint)projectDirty=true;
  projectLastHash=c.fingerprint;
  preState.loaded=true;preState.external=!project.synthetic;preState.case=PROJECT.packFor(project);preState.result=c.forecast;
  strategyState.loaded=true;strategyState.external=!project.synthetic;strategyState.externalName=project.name;strategyState.case=preState.case;strategyState.operations=project.operations;strategyState.baseModel=projectModel;strategyState.forecast=c.base_forecast;strategyState.result=c.plans;strategyState.params={...project.strategy_params,annual_discount:options.annual_return,commission_rate:options.cost_rate};strategyState.actuals=project.weekly_actuals||{};
  if(!c.plans.plans.some(p=>p.profile===strategyState.selected))strategyState.selected=c.plans.recommendation||'balanced';
}
function projectBar(){
  if(!project)return;
  const ctx=result.project_context,el=$('#project-bar');
  el.innerHTML=`<div class="project-identity"><div><span class="eyebrow">ЄДИНИЙ ПРОЄКТ · v0.9</span><strong>${esc(project.name)}</strong><span>${esc(project.as_of_date)} · ${num(rows.length)} договорів · версія ${esc(ctx.fingerprint)}${projectDirty?' · є незбережені зміни':''}</span></div><div class="project-actions"><button class="button secondary small" data-project-action="import">↑ Відкрити дані / проєкт</button><button class="button secondary small" data-project-action="save">↓ Зберегти проєкт</button></div></div><div class="project-source"><label>Джерело прогнозу <select id="project-source"><option value="ml" ${project.source==='ml'?'selected':''} ${!project.history?'disabled':''}>ML · 12 місяців</option><option value="scenario" ${project.source==='scenario'?'selected':''}>Сценарний · 36 місяців</option></select></label><span>Прогноз: ${ctx.horizon_months} міс. · календар коштів: ${result.gross.length} міс.</span><span>${num(result.ready_count)} оцінено / ${num(result.unknown_count)} без оцінки</span><span>Стратегія: ${project.applied_profile?'застосована':'ще не застосована'}</span></div><nav class="project-steps" aria-label="Маршрут оцінки">${projectSteps.map(([tab,label])=>`<button class="${active===tab?'selected':''}" data-goto="${tab}">${label}</button>`).join('')}</nav>`;
  $('#portfolio-code').textContent=project.name;$('#data-badge').textContent=project.synthetic?'СИНТЕТИЧНІ ДАНІ':project.source==='ml'?'ІМПОРТ · ДЕМО ML':'ІМПОРТ · СЦЕНАРІЙ';
}
function projectAfterRender(){
  if(active==='costs'&&project.applied_profile)$('#tab-costs').insertAdjacentHTML('afterbegin','<div class="notice project-note">Застосований план замінює регулярні та стандартні витрати дій за свій період. Додаткові витрати зберігаються окремо; комісія від загальних зборів враховується один раз. Множник витрат застосовується і до плану.</div>');
  if(active==='method')$('#tab-method').insertAdjacentHTML('afterbegin',projectForecastNotice()+'<div class="panel project-note"><h2>Єдиний розрахунок v0.9</h2><p>Реєстр та операційні статуси → обраний прогноз → план і бюджет → грошовий потік → оцінка та Монте-Карло → зафіксоване рішення і факт.</p><p>ML оцінює суму за 12 місяців. Розподіл у часі задається нормованою сегментною кривою, не навчається цією моделлю. Після прогнозного горизонту нові збори не додаються; витрати можуть тривати довше. Стрес зсуває строки тих самих модельних зборів, не додаючи нових платежів.</p><p>Бюджет стратегії замінює регулярні витрати пропорційно дням. Разові стандартні дії замінюються, коли дата кінця їх місяця потрапляє в період плану. Додаткові статті зберігаються. Тижневі витрати плану та ефект дій віднесено до місяця завершення тижня. Оцінка дисконтує на кінець місяця, стратегія — на кінець тижня.</p><p>Інтервали Монте-Карло умовні на прогнозі. Помилка ML, правові, воєнні та макрофактори окремо не відкалібровані. Зафіксований план незмінний, місячний факт не перезаписує його.</p></div>');
}
function projectRefresh(){result=projectEvaluate(options);options=result.options;projectSync();renderActive();}
function projectInstall(candidate){
  const checked=PROJECT.evaluate(candidate,projectModel);
  if(mcState.worker){mcState.worker.terminate();mcState.worker=null;}mcState.result=null;mcState.message='';
  project=candidate;rows=project.rows;options=checked.options;result=checked;strategyState.loaded=false;strategyState.params={...project.strategy_params};strategyState.selected=project.applied_profile||checked.project_context.plans.recommendation||'balanced';
  filter={segment:'',quality:'',search:''};registryPage=0;preState.search='';preState.selected=null;preState.view='forecast';
  projectLastHash=checked.project_context.fingerprint;projectDirty=true;projectSync();error('');updateSource();renderActive();
}
function projectConfirmReplace(){return !projectDirty||window.confirm('Є незбережені зміни. Відкрити інший портфель? Поточний проєкт спочатку можна зберегти у JSON.');}
function projectExport(){projectSync();project.mc_params={...mcState.params};project.weekly_actuals=strategyState.actuals;if(riskState.loaded)project.risk_collection=riskCollection();download('npl-project-'+project.id+'.json',JSON.stringify(project,null,2),'application/json;charset=utf-8');projectDirty=false;projectSavedHash=result.project_context.fingerprint;projectBar();toast('Проєкт збережено: дані, джерело прогнозу, параметри, стратегія, зафіксований план і факт.');}
function projectForecastNotice(){return `<div class="notice">${project.source==='ml'?'ML навченa на синтетичних даних; потрібні перевірка та калібрування на історії компанії.':'Ймовірності задано сценарними припущеннями за сегментами.'} Цей самий прогноз використовується в оцінці, стратегії та Монте-Карло. Суми за межами ${result.collection_months} місяців не екстраполюються. Строки всередині горизонту — припущення сегментної кривої.</div>`;}
renderPrepurchase=function(){
  projectSync();$('#report-button').disabled=false;const c=result.project_context;
  $('#tab-prepurchase').innerHTML=projectForecastNotice()+`<div class="pre-tabs">${[['forecast','Прогноз проєкту'],['comparison','Діагностика моделей'],['validation','Перевірка базової моделі'],['data','Схема даних']].map(([v,label])=>`<button data-pre-view="${v}" class="${preState.view===v?'selected':''}">${label}</button>`).join('')}<span class="pre-model-id">${esc(c.model_id)}</span></div><div id="pre-body"></div>`;
  if(preState.view==='comparison'){renderModelComparison();$('#pre-body').insertAdjacentHTML('afterbegin',`<div class="notice">Поточний проєкт: ${esc(projectSource())}. Нижче — збережений тест кандидатів на синтетичній історії. Він пояснює якість моделей, не замінює прогноз поточного реєстру і не перемикає його модель.</div>`);return;}
  if(preState.view==='validation'){renderPreValidation();return;}
  if(preState.view==='data'){renderPreData();return;}
  const r=c.forecast;
  $('#pre-body').innerHTML=`<div class="metrics">${metric('Оцінено договорів',num(r.scored)+' / '+num(r.total),'Без оцінки — окрема група','emphasis')}${metric('Очікувані платні договори',num(r.expected_payers,1),'За '+r.horizon_months+' місяців')}${metric('Очікувані збори',mln(r.expected_gross),'Поточний прогноз з урахуванням застосованого плану')}${metric('Без оцінки',num(r.total-r.scored),'Витрати на їх обслуговування збережено')}</div><div class="panel"><div class="panel-heading"><div><h2>Прогноз договорів поточного проєкту</h2><p>P × умовна сума = очікувані збори. Джерело: ${esc(projectSource())}.</p></div><button class="button secondary" data-action="pre-export">↓ Прогноз CSV</button></div><div class="toolbar"><input id="pre-search" value="${esc(preState.search)}" placeholder="ID договору" aria-label="Пошук у прогнозі"><select id="pre-filter" aria-label="Статус прогнозу"><option value="scored">Оцінені</option><option value="review">Без оцінки</option><option value="all">Усі</option></select></div><div class="table-wrap"><table><thead><tr><th>Договір</th><th>Сегмент</th><th class="num">P · ${r.horizon_months} міс.</th><th class="num">Сума при платежі</th><th class="num">Очікувана сума</th><th>Статус</th></tr></thead><tbody id="pre-rows"></tbody></table></div><div class="pager"><span id="pre-row-count"></span><span>До 30 записів</span></div></div>`;
  $('#pre-filter').value=preState.filter;renderPreRows();
};
PRE_REASONS.legal_hold='Перевірка документів за операційним статусом';
const projectOldLoan=showPreLoan;
showPreLoan=function(id){const s=preState.result.scores.find(r=>r.loan_id===id);if(s?.effects)return projectOldLoan(id);if(!s)return;$('#report-content').innerHTML=`<article class="memo"><h2>${esc(id)}</h2><p>${esc(projectSource())} · ${result.collection_months} місяців. P: ${pct(s.probability)}; умовна сума: ${s.conditional===null?'—':money(s.conditional)}; очікувані збори: ${s.expected===null?'—':money(s.expected)}.</p><p>Сценарні частки не є індивідуально навченою моделлю. Ефект застосованих дій — окреме припущення.</p></article>`;$('#report-dialog .dialog-actions').hidden=true;$('#report-dialog').showModal();};
strategyForecast=function(){return result.project_context.base_forecast;};
calculateStrategy=function(){project.strategy_params={...strategyState.params};projectRefresh();};
renderStrategy=function(){
  projectSync();const plan=selectedStrategy();
  $('#tab-strategy').innerHTML=`<div class="notice">План використовує прогноз цього проєкту. Базові збори за 90 днів взято з його місячної кривої; окремий множник 30% не використовується. Ефект дій — припущення. Контакти та позови не виконуються автоматично.</div><div class="panel strategy-source"><div><h2>${esc(projectSource())}</h2><p>${esc(project.name)} · ${num(rows.length)} договорів · прогноз ${result.collection_months} міс.</p></div><div class="strategy-period"><b>${esc(plan.start_date)} → ${esc(plan.end_date)}</b><span>90 днів · 13 тижнів</span></div><div class="download-links"><button class="button secondary" data-project-action="operations">↑ Операційні статуси</button><button class="button primary" data-project-action="apply-strategy">Застосувати обраний план</button>${project.applied_profile?'<button class="button secondary" data-project-action="remove-strategy">Зняти застосований план</button>':''}</div></div><div class="notice">${project.applied_profile?'До оцінки застосовано: '+esc(STRATEGY.PROFILES.find(p=>p.key===project.applied_profile).label)+'.':'Поки використовується загальний бюджет вкладки «Витрати». Вибір картки лише переглядає варіант.'} Застосування замінює операційний бюджет періоду плану та додає ефект дій один раз. За межами періоду зберігається загальний бюджет.</div><div class="pre-tabs">${[['overview','План і сценарії'],['calendar','Календар і завдання'],['review','Контроль тижня'],['assumptions','Припущення й дані']].map(([key,label])=>`<button data-strategy-view="${key}" class="${strategyState.view===key?'selected':''}">${label}</button>`).join('')}<span class="pre-model-id">${esc(plan.plan_id)}</span></div><div id="strategy-body"></div>`;
  if(strategyState.view==='overview')renderStrategyOverview();else if(strategyState.view==='calendar')renderStrategyCalendar();else if(strategyState.view==='review')renderStrategyReview();else {renderStrategyAssumptions();for(const key of ['annual_discount','commission_rate','share_90d']){const el=$('#strategy-param-'+key);if(el)el.parentElement.hidden=true;}}
};
function projectMonitoring(){
  const frozen=project.frozen;
  if(!frozen){$('#tab-monitoring').innerHTML=`<div class="panel"><h2>Зафіксуйте рішення перед контролем факту</h2><p>Поточна версія ${esc(result.project_context.fingerprint)}. Ціна ${money(options.price)}, NPV ${signed(result.npv)}. Фіксація збереже прогноз і бюджет; наступні зміни їх не перепишуть.</p><button class="button primary" data-project-action="freeze">Зафіксувати поточне рішення</button></div>`;return;}
  const r=frozen.result,a=project.actuals||[],plannedGross=a.reduce((s,x)=>s+r.gross[x.month-1],0),plannedCost=a.reduce((s,x)=>s+r.costs[x.month-1],0),ag=a.reduce((s,x)=>s+x.gross,0),ac=a.reduce((s,x)=>s+x.cost,0),lookup=new Map(a.map(x=>[x.month,x]));
  let contiguous=0;while(lookup.has(contiguous+1))contiguous++;
  $('#tab-monitoring').innerHTML=`<div class="notice">Зафіксовано ${esc(frozen.fingerprint)} · ${esc(frozen.as_of_date)} · поточна версія ${esc(result.project_context.fingerprint)}. Факт вводиться окремо. Пропущені місяці не прирівнюються до нуля.</div><div class="metrics">${metric('Місяців із фактом',num(a.length),'Із '+r.gross.length)}${metric('Виконання зборів',plannedGross?pct(ag/plannedGross):'—','Лише за місяці з фактом')}${metric('Витрати / план',plannedCost?pct(ac/plannedCost):'—','Ті самі спостережені місяці')}${metric('Відхилення зборів',signed(ag-plannedGross),'Факт мінус зафіксований план')}</div><div class="panel"><h2>Внести місячний факт</h2><form id="project-actual-form" class="project-actual-form"><label>Місяць<input id="actual-month" type="number" min="1" max="${r.gross.length}" required></label><label>Збори, ₴<input id="actual-gross" type="number" min="0" step="any" required></label><label>Витрати, ₴<input id="actual-cost" type="number" min="0" step="any" required></label><button class="button primary">Зберегти місяць</button></form><div class="download-links"><button class="button secondary" data-project-action="actual-import">↑ Факт CSV</button><button class="button secondary" data-project-action="actual-template">↓ Шаблон CSV</button><button class="button secondary" data-project-action="save">↓ Проєкт із фактом</button></div></div>${contiguous?'<div class="panel" style="margin-top:18px"><h2>Накопичені збори до першого пропуску</h2>'+chart([{values:cumulative(r.gross.slice(0,contiguous)),color:'#6ad3a5'},{values:cumulative(Array.from({length:contiguous},(_,i)=>lookup.get(i+1).gross)),color:'#c7ad77',points:true}],{months:contiguous})+'</div>':''}<div class="panel table-panel" style="margin-top:18px"><div class="panel-heading"><h2>План і факт</h2></div><div class="table-wrap"><table><thead><tr><th>Місяць</th><th>План зборів</th><th>Факт зборів</th><th>План витрат</th><th>Факт витрат</th></tr></thead><tbody>${r.gross.map((v,i)=>`<tr><td>${i+1}</td><td>${money(v)}</td><td>${lookup.has(i+1)?money(lookup.get(i+1).gross):'—'}</td><td>${money(r.costs[i])}</td><td>${lookup.has(i+1)?money(lookup.get(i+1).cost):'—'}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function projectReport(){
  let body=`<div class="memo-label">ПРОЄКТ ${esc(project.name)} · ${esc(result.project_context.fingerprint)} · ${esc(project.as_of_date)}</div><p>Джерело: ${esc(projectSource())}; прогноз ${result.collection_months} міс.; календар коштів ${result.gross.length} міс. Стратегія: ${project.applied_profile?esc(result.project_context.applied_plan_id):'не застосована'}. Без оцінки ${num(result.unknown_count)} договорів.</p>`;
  if(mcState.result&&!mcStale())body+=`<h3>Монте-Карло цієї версії</h3><p>${num(mcState.result.params.draws)} симуляцій; seed ${mcState.result.params.seed}. NPV &lt; 0: ${pct(mcState.result.probabilities.negative_npv.value)}; неповернення вкладень: ${pct(mcState.result.probabilities.capital_loss.value)}. Це умовні частоти моделі.</p>`;
  else body+='<p>Актуальний результат Монте-Карло для цієї версії відсутній. За потреби повторіть симуляцію.</p>';
  if(project.frozen){const f=project.frozen,a=project.actuals,pg=a.reduce((s,v)=>s+f.result.gross[v.month-1],0),pc=a.reduce((s,v)=>s+f.result.costs[v.month-1],0);body+=`<h3>Зафіксоване рішення та факт</h3><p>Початкова версія ${esc(f.fingerprint)}. Місяців із фактом: ${a.length}. Збори / план тих самих місяців: ${money(a.reduce((s,v)=>s+v.gross,0))} / ${money(pg)}; витрати / план: ${money(a.reduce((s,v)=>s+v.cost,0))} / ${money(pc)}. Пропуски не включені як нулі.</p>`;}
  return body;
}
prepurchaseMemo=function(){if(preState.view==='comparison')return comparisonMemo();const f=result.project_context.forecast;return `<article class="memo"><h2>Прогноз договорів проєкту</h2><p>Джерело: ${esc(projectSource())}. Горизонт ${f.horizon_months} місяців. Модель ${esc(f.model_id)}.</p><p>Оцінено ${f.scored} із ${f.total}; очікувані платні договори ${num(f.expected_payers,1)}; збори ${money(f.expected_gross)}. Прогноз використовується у поточній фінансовій оцінці та симуляції; витрати та ціна показані в загальному висновку.</p><p>ML навчена на синтетиці. Сценарні частки й ефект дій є припущеннями. Модель строків задає форму місячної кривої; вона не підтверджена історією компанії.</p></article>`;};
document.addEventListener('change',async e=>{
  const id=e.target.id;
  if(id==='project-source'){e.stopImmediatePropagation();try{const next={...project,source:e.target.value,applied_profile:null};const checked=PROJECT.evaluate({...next,options:PROJECT.cleanOptions(options)},projectModel);project=next;result=checked;options=checked.options;projectSync();renderActive();error('');}catch(err){error(err.message);projectBar();}return;}
  if(!['csv-input','pre-input','strategy-input','project-input','actual-input'].includes(id))return;
  e.stopImmediatePropagation();const file=e.target.files[0];if(!file)return;
  try{
    if(file.size>50*1024*1024)throw Error('Файл перевищує 50 МБ.');const text=await file.text();
    if(id==='actual-input'){
      if(!project.frozen)throw Error('Спочатку зафіксуйте рішення.');const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/),header=lines.shift().trim();if(header!=='month,gross,cost')throw Error('Заголовок CSV: month,gross,cost.');const values=lines.map(line=>{const v=line.split(',');if(v.length!==3||v.some(x=>!x.trim()))throw Error('Порожнє поле факту.');return {month:Number(v[0]),gross:Number(v[1]),cost:Number(v[2])};});project.actuals=PROJECT.validateActuals(values,project.frozen.result.gross.length);projectDirty=true;projectMonitoring();projectBar();
    }else if(id==='csv-input'||(id==='project-input'&&file.name.toLowerCase().endsWith('.csv'))){
      const parsed=NPL.parseCSV(text);if(!projectConfirmReplace())return;projectInstall(PROJECT.create(parsed,{name:file.name,date:new Date().toISOString().slice(0,10),options:baseOptions}));
    }else{
      const data=JSON.parse(text);
      if(data.schema===PROJECT.SCHEMA){const checked=PROJECT.validateProject(data,projectModel);if(checked.risk_collection)RISK.validateCollection(checked.risk_collection);const mc=checked.mc_params?MC.validate(checked.mc_params,checked.rows.length):{...MC.DEFAULTS};if(!projectConfirmReplace())return;projectInstall(checked);mcState.params=mc;if(checked.risk_collection){riskState.loaded=true;riskState.snapshots=checked.risk_collection.snapshots;riskState.rate=checked.risk_collection.annual_return;}projectDirty=false;projectBar();}
      else if(data.accounts&&!data.case&&!data.snapshots){const next={...project,operations:data,options:PROJECT.cleanOptions(options),applied_profile:null};const checked=PROJECT.evaluate(next,projectModel);project=next;result=checked;options=checked.options;projectRefresh();}
      else {const next=PROJECT.fromPackage(data.case||data,{name:file.name,options:baseOptions,operations:data.operations});PROJECT.evaluate(next,projectModel);if(!projectConfirmReplace())return;projectInstall(next);}
    }
    error('');toast('Дані перевірено. Усі вкладки використовують поточний проєкт.');
  }catch(err){error('Імпорт не виконано: '+err.message);}finally{e.target.value='';}
},true);
document.addEventListener('click',e=>{
  const action=e.target.closest('[data-project-action]')?.dataset.projectAction;
  const legacy=e.target.closest('[data-action]')?.dataset.action,sa=e.target.closest('[data-strategy-action]')?.dataset.strategyAction;
  if(['restore-demo','pre-reset'].includes(legacy)||sa==='demo'){e.stopImmediatePropagation();if(projectConfirmReplace())projectInstall(structuredClone(projectDemo));return;}
  if(sa==='reset'){e.stopImmediatePropagation();strategyState.params={...STRATEGY.DEFAULTS,start_date:project.as_of_date};project.strategy_params={...strategyState.params};projectRefresh();return;}
  if(!action)return;e.stopImmediatePropagation();
  try{
    if(action==='import')$('#project-input').click();
    if(action==='operations')$('#strategy-input').click();
    if(action==='save')projectExport();
    if(action==='apply-strategy'){const p=selectedStrategy();if(!p.budget.feasible)throw Error('Обраний план виходить за бюджет.');project.applied_profile=p.profile;options={...options,cost_mode:'detailed'};projectRefresh();toast('План включено до оцінки та Монте-Карло.');}
    if(action==='remove-strategy'){project.applied_profile=null;projectRefresh();}
    if(action==='freeze'){if(project.frozen)throw Error('Початковий план уже зафіксовано.');project=PROJECT.freeze(project,result);projectDirty=true;projectMonitoring();projectBar();}
    if(action==='actual-import')$('#actual-input').click();
    if(action==='actual-template')download('actual-template.csv','month,gross,cost\r\n','text/csv;charset=utf-8');
  }catch(err){error(err.message);}
},true);
document.addEventListener('submit',e=>{
  if(e.target.id==='project-actual-form'){e.preventDefault();e.stopImmediatePropagation();try{const month=Number($('#actual-month').value),gross=Number($('#actual-gross').value),cost=Number($('#actual-cost').value);const next=[...project.actuals.filter(a=>a.month!==month),{month,gross,cost}];project.actuals=PROJECT.validateActuals(next,project.frozen.result.gross.length);projectDirty=true;projectMonitoring();projectBar();error('');}catch(err){error(err.message);}}
  if(e.target.id==='strategy-params-form'){e.preventDefault();e.stopImmediatePropagation();try{const params={...strategyState.params};e.target.querySelectorAll('[data-strategy-param]').forEach(el=>{if(el.parentElement.hidden)return;if(!el.value)throw Error('Заповніть параметри.');params[el.dataset.strategyParam]=el.dataset.strategyKind==='date'?el.value:Number(el.value)/(el.dataset.strategyKind==='percent'?100:1);});const next={...project,options:PROJECT.cleanOptions(options),strategy_params:STRATEGY.normalizeParams(params)};const checked=PROJECT.evaluate(next,projectModel);project=next;strategyState.params={...next.strategy_params};result=checked;options=checked.options;strategyState.view='overview';projectSync();renderActive();error('');}catch(err){error('План не змінено: '+err.message);}}
},true);
window.addEventListener('beforeunload',e=>{if(projectDirty){e.preventDefault();e.returnValue='';}});
document.addEventListener('input',e=>{if(e.target.dataset.mcParam){projectDirty=true;projectBar();}});
document.addEventListener('click',e=>{if(e.target.closest('[data-strategy-action="review"]')){project.weekly_actuals=strategyState.actuals;projectDirty=true;projectBar();}});
