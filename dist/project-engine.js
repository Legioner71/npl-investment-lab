/* One project, one forecast contract, shared finance and simulation inputs. */
(function(root){
  'use strict';
  const N=root.NPL||(typeof require!=='undefined'?require('./engine.js'):null);
  const P=root.PRE||(typeof require!=='undefined'?require('./prepurchase-engine.js'):null);
  const S=root.STRATEGY||(typeof require!=='undefined'?require('./strategy-engine.js'):null);
  const SCHEMA='npl-project-v1',VERSION='0.9';
  const clone=x=>JSON.parse(JSON.stringify(x));
  const sum=a=>a.reduce((s,v)=>s+v,0);
  function hash(x){let h=2166136261;const stable=JSON.stringify(x,(_k,v)=>typeof v==='number'&&Number.isFinite(v)?Number(v.toPrecision(10)):v);for(const c of stable)h=Math.imul(h^c.charCodeAt(0),16777619);return(h>>>0).toString(16).padStart(8,'0');}
  function cleanOptions(o){return Object.fromEntries(Object.keys(N.DEFAULTS).map(k=>[k,clone(o[k]??N.DEFAULTS[k])]));}
  function monthDate(origin,n){const d=new Date(P.day(origin)),m=d.getUTCMonth()+n;return new Date(Date.UTC(d.getUTCFullYear(),m,Math.min(d.getUTCDate(),new Date(Date.UTC(d.getUTCFullYear(),m+1,0)).getUTCDate()))).toISOString().slice(0,10);}
  function create(rows,{name='Новий портфель',date='2026-11-02',options={},synthetic=false,history=null,operations=null}={}){
    N.validateRows(rows);P.day(date);
    name=String(name).trim().slice(0,100)||'Новий портфель';
    return {schema:SCHEMA,id:'portfolio-'+hash([name,date,rows]),name,as_of_date:date,synthetic,source:history?'ml':'scenario',rows:clone(rows),history:history?clone(history):null,operations:operations?clone(operations):{meta:{synthetic:false},accounts:[]},options:cleanOptions(options),strategy_params:{...S.DEFAULTS,start_date:date},applied_profile:null,mc_params:null,frozen:null,actuals:[],weekly_actuals:{}};
  }
  function fromPackage(pack,{name='Портфель із історією',options={},operations=null}={}){
    P.validatePackage(pack);const dates=[...new Set(pack.snapshots.map(s=>s.as_of_date))];
    if(dates.length!==1)throw Error('Один проєкт повинен мати єдину дату оцінки.');
    const keys=['loan_id','borrower_id','segment','principal','interest','penalty','excluded_amount','dpd','quality'];
    return create(pack.snapshots.map(s=>Object.fromEntries(keys.map(k=>[k,s[k]]))),{name,date:dates[0],options,history:pack,operations,synthetic:pack.meta?.synthetic===true});
  }
  function packFor(project){
    if(project.history){
      P.validatePackage(project.history);
      const index=new Map(project.history.snapshots.map(s=>[s.loan_id,s]));
      if(index.size!==project.rows.length)throw Error('Історія не відповідає кількості договорів.');
      for(const r of project.rows){const s=index.get(r.loan_id);if(!s||s.as_of_date!==project.as_of_date||Object.keys(r).some(k=>s[k]!==r[k]))throw Error('Історія не відповідає реєстру або даті оцінки.');}
      return clone(project.history);
    }
    return {meta:{synthetic:project.synthetic},snapshots:project.rows.map(r=>({...r,portfolio_id:project.id,seller_id:'unknown',as_of_date:project.as_of_date,issued_at:project.as_of_date,history_complete:false,history_start_date:project.as_of_date})),payments:[]};
  }
  function forecast(project,model){
    const pack=packFor(project);let f;
    if(project.source==='ml'){
      if(!project.history)throw Error('Для ML потрібна історія платежів. Завантажте JSON-пакет.');
      f=P.scorePackage(model,pack);
    }else if(project.source==='scenario'){
      f={model_id:'scenario-segments-v1',synthetic_training:false,horizon_months:36,scores:pack.snapshots.map(r=>{const b=r.principal+r.interest+r.penalty-r.excluded_amount,s=N.SEGMENTS[r.segment],ok=r.quality==='ready'&&b>0;return {loan_id:r.loan_id,borrower_id:r.borrower_id,segment:r.segment,as_of_date:project.as_of_date,horizon_end:monthDate(project.as_of_date,36),status:ok?'scored':r.quality==='review'?'legal_review':'zero_basis',probability:ok?s.payer:null,conditional:ok?b*s.recovery/s.payer:null,expected:ok?b*s.recovery:null};})};
    }else throw Error('Невідоме джерело прогнозу.');
    const ids=new Set(project.rows.map(r=>r.loan_id)),ops=new Set();
    for(const a of project.operations.accounts){if(!ids.has(a.loan_id)||ops.has(a.loan_id))throw Error('Невідомий або повторний ID операційного статусу.');ops.add(a.loan_id);}
    const op=new Map(project.operations.accounts.map(a=>[a.loan_id,a]));
    f.scores=f.scores.map(s=>{if(op.get(s.loan_id)?.legal_review_required)return {...s,status:'legal_hold',probability:null,conditional:null,expected:null};return s;});
    const index=new Map(f.scores.map(s=>[s.loan_id,s]));f.scores=project.rows.map(r=>index.get(r.loan_id));
    const scored=f.scores.filter(s=>s.status==='scored');
    return {...f,total:project.rows.length,scored:scored.length,expected_payers:sum(scored.map(s=>s.probability)),expected_gross:sum(scored.map(s=>s.expected))};
  }
  function strategyForecast(project,f,r){
    return {...f,scores:r.records.map((v,i)=>({...f.scores[i],status:v.estimated?'scored':v.forecast_status,probability:v.estimated?v.probability:null,conditional:v.estimated?v.conditional:null,expected:v.estimated?v.gross:null,monthly_expected:v.estimated?[...Array(r.options.delay).fill(0),...v.weights.map(w=>w*v.gross)]:null}))};
  }
  function overlayFor(project,plan,months){
    const costs=Array(months).fill(0),replace=Array(months).fill(0),replace_events=Array(months).fill(0),uplifts=Object.create(null);
    const origin=P.day(project.as_of_date),start=P.day(plan.start_date),end=P.day(S.addDays(plan.end_date,1));
    const bucket=date=>{const d=P.day(date);for(let m=0;m<months;m++)if(d<=P.day(monthDate(project.as_of_date,m+1)))return m;throw Error('Дія виходить за межі прогнозу.');};
    for(let m=0;m<months;m++){const a=P.day(monthDate(project.as_of_date,m)),b=P.day(monthDate(project.as_of_date,m+1));replace[m]=Math.max(0,Math.min(end,b)-Math.max(start,a))/(b-a);replace_events[m]=b>=start&&b<end?1:0;}
    for(const w of plan.weeks){costs[bucket(w.end_date)]+=w.fixed_cost+w.external_cost;for(const task of w.tasks){if(task.incremental_gross<=0)continue;const flows=uplifts[task.loan_id]??=Array(months).fill(0);task.incremental_flow.forEach((cash,i)=>{flows[bucket(plan.weeks[i].end_date)]+=cash;});}}
    return {plan_id:plan.plan_id,costs,replace,replace_events,uplifts,probabilities:Object.fromEntries(plan.rows.filter(r=>r.probability_12m!==null).map(r=>[r.loan_id,r.probability_12m]))};
  }
  function evaluate(project,model,overrides={}){
    N.validateRows(project.rows);P.day(project.as_of_date);if(!project.operations||!Array.isArray(project.operations.accounts))throw Error('Потрібен операційний шар accounts.');
    const f=forecast(project,model),baseOptions={...cleanOptions(project.options),...cleanOptions({...project.options,...overrides}),collection_months:f.horizon_months,forecast_meta:{source:project.source,model_id:f.model_id,horizon_months:f.horizon_months,as_of_date:project.as_of_date},loan_forecast:f.scores.map(s=>({loan_id:s.loan_id,status:s.status,probability:s.probability,conditional:s.conditional}))};
    const base=N.evaluate(project.rows,baseOptions),sf=strategyForecast(project,f,base),params={...project.strategy_params,annual_discount:base.options.annual_return,commission_rate:base.options.cost_rate};
    const plans=S.buildPlans(packFor(project),project.operations,sf,params);
    let result=base,applied=null;
    if(project.applied_profile){applied=plans.plans.find(p=>p.profile===project.applied_profile);if(!applied||!applied.budget.feasible||applied.totals.cost*baseOptions.expense_multiplier>applied.budget.spend_limit+1e-6)throw Error('Застосований план виходить за бюджет з урахуванням множника витрат. Зніміть його або змініть параметри.');result=N.evaluate(project.rows,{...baseOptions,strategy_overlay:overlayFor(project,applied,f.horizon_months)});}
    const effective={...f,scores:result.records.map((v,i)=>({...f.scores[i],status:v.estimated?'scored':v.forecast_status,probability:v.estimated?v.probability:null,conditional:v.estimated?v.conditional:null,expected:v.estimated?v.gross:null})),expected_payers:result.payers,expected_gross:result.gross_total,scored:result.ready_count};
    const fingerprint=hash({id:project.id,rows:project.rows,date:project.as_of_date,forecast:f,options:cleanOptions(baseOptions),operations:project.operations,strategy_params:params,applied_profile:project.applied_profile});
    return {...result,project_context:{fingerprint,forecast:effective,base_forecast:sf,plans,applied_plan_id:applied?.plan_id??null,source:project.source,horizon_months:f.horizon_months,model_id:f.model_id}};
  }
  function freeze(project,result){const input={...clone(project),frozen:null,actuals:[],weekly_actuals:{}};return {...clone(project),frozen:{fingerprint:result.project_context.fingerprint,as_of_date:project.as_of_date,source:project.source,model_id:result.project_context.model_id,created_at:new Date().toISOString(),input,result:clone(result)},actuals:[]};}
  function validateActuals(items,horizon){if(!Array.isArray(items)||items.length>horizon)throw Error('Некоректний місячний факт.');const seen=new Set();for(const a of items){if(!a||!Number.isInteger(a.month)||a.month<1||a.month>horizon||seen.has(a.month)||!Number.isFinite(a.gross)||a.gross<0||!Number.isFinite(a.cost)||a.cost<0)throw Error('Перевірте місяць, збори та витрати; дублікати не дозволено.');seen.add(a.month);}return clone(items).sort((a,b)=>a.month-b.month);}
  function validateProject(input,model){
    if(!input||input.schema!==SCHEMA||typeof input.id!=='string'||!input.id||typeof input.name!=='string'||!input.name.trim()||input.name.length>120)throw Error('Несумісний файл проєкту.');
    const p=clone(input);evaluate(p,model);
    if(p.frozen){const f=p.frozen,r=f.result;if(!r||!Array.isArray(r.gross)||!Array.isArray(r.costs)||r.gross.length!==r.costs.length||r.gross.length>84||r.gross.some(v=>!Number.isFinite(v)||v<0)||r.costs.some(v=>!Number.isFinite(v)||v<0)||!Number.isFinite(r.options?.price)||r.options.price<=0||!Number.isFinite(r.options?.startup)||r.options.startup<0)throw Error('Некоректна зафіксована оцінка.');if(!f.input||f.input.id!==p.id)throw Error('Відсутні вхідні дані зафіксованого рішення.');const original=evaluate(f.input,model);if(original.project_context.fingerprint!==f.fingerprint||['gross','costs'].some(k=>original[k].length!==r[k].length||original[k].some((v,i)=>Math.abs(v-r[k][i])>1e-6+Math.abs(v)*1e-10)))throw Error('Зафіксований план не звіряється з його даними.');p.actuals=validateActuals(p.actuals||[],r.gross.length);}else if(p.actuals?.length)throw Error('Факт потребує зафіксованого плану.');
    return p;
  }
  const api={SCHEMA,VERSION,hash,cleanOptions,monthDate,create,fromPackage,packFor,forecast,evaluate,freeze,validateActuals,validateProject};
  root.PROJECT=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
