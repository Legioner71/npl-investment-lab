/* Shared browser/Node engine. Draft scenario allocation, not a causal action model. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.STRATEGY=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION='strategy-90d-v1';
  const ROUTES={
    plan_support:{label:'Супровід домовленості',role:'operator',hours:.25,cash:true},
    voluntary_offer:{label:'Добровільне врегулювання',role:'operator',hours:.75,cash:true},
    legal_review:{label:'Перевірка документів юристом',role:'legal',hours:1,cash:false},
    data_review:{label:'Уточнення історії та даних',role:'analyst',hours:.5,cash:false},
    permission_review:{label:'Перевірка допустимості взаємодії',role:'analyst',hours:.25,cash:false},
    monitor:{label:'Облік і спостереження',role:null,hours:0,cash:false}
  };
  const PROFILES=[
    {key:'economy',label:'Економний',operator_fraction:.45,offer_fraction:.35,min_benefit_cost:3},
    {key:'balanced',label:'Збалансований',operator_fraction:.75,offer_fraction:.7,min_benefit_cost:1.5},
    {key:'capacity',label:'У межах усієї місткості',operator_fraction:1,offer_fraction:1,min_benefit_cost:1}
  ];
  const DEFAULTS={horizon_days:90,start_date:'2026-10-29',budget:400000,reserve_share:.1,
    annual_discount:.6,share_90d:.3,commission_rate:.08,
    analyst_hours_week:12,operator_hours_week:20,legal_hours_week:8,
    analyst_hour_cost:250,operator_hour_cost:200,legal_hour_cost:500,
    overhead_week:2000,servicing_account_week:1,
    support_uplift:.04,offer_uplift:.2,support_external:0,offer_external:20,
    legal_external:100,data_external:5,permission_external:0,
    support_lag_days:7,offer_lag_days:14,stress_baseline_factor:.8,stress_uplift_factor:.5,
    review_collection_floor:.8,review_cost_ceiling:1.1};
  function fail(message){throw new Error(message);}
  function day(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))fail('Дата має бути YYYY-MM-DD.');const v=Date.parse(s+'T00:00:00Z');if(!Number.isFinite(v)||new Date(v).toISOString().slice(0,10)!==s)fail('Некоректна дата.');return v;}
  function addDays(s,n){return new Date(day(s)+n*86400000).toISOString().slice(0,10);}
  function hash(v){const s=JSON.stringify(v);let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return (h>>>0).toString(16).padStart(8,'0');}
  function normalizeParams(input){
    const p={...DEFAULTS,...input};day(p.start_date);
    if(p.horizon_days!==90)fail('Поточний модуль має горизонт рівно 90 днів.');
    for(const key of Object.keys(DEFAULTS).filter(k=>k!=='start_date'))if(typeof p[key]!=='number'||!Number.isFinite(p[key])||p[key]<0||p[key]>1e10)fail('Некоректний параметр: '+key);
    for(const key of ['share_90d','commission_rate','support_uplift','offer_uplift','stress_baseline_factor','stress_uplift_factor','review_collection_floor'])if(p[key]>1)fail('Частка має бути від 0 до 1: '+key);
    if(p.reserve_share>=1||p.share_90d<=0||p.annual_discount>5||p.budget>1e10||p.review_cost_ceiling<1||p.review_cost_ceiling>5)fail('Параметри поза допустимими межами.');
    for(const role of ['analyst','operator','legal'])if(p[role+'_hours_week']>168||p[role+'_hour_cost']>1e5)fail('Перевірте місткість та вартість команди.');
    for(const key of ['support_lag_days','offer_lag_days'])if(!Number.isInteger(p[key])||p[key]>90)fail('Затримка має бути цілим числом 0–90 днів.');
    return p;
  }
  function validateInputs(pack,operations,forecast,p){
    if(!pack||!Array.isArray(pack.snapshots)||!pack.snapshots.length||pack.snapshots.length>50000)fail('Потрібні зрізи договорів.');
    if(!operations||!Array.isArray(operations.accounts))fail('Потрібна таблиця операційних статусів accounts.');
    if(!forecast||!Array.isArray(forecast.scores)||![12,36].includes(forecast.horizon_months))fail('Потрібен узгоджений прогноз за 12 або 36 місяців.');
    const snapshots=new Map(),borrowers=new Set();
    for(const s of pack.snapshots){
      if(typeof s.loan_id!=='string'||!s.loan_id.trim()||snapshots.has(s.loan_id)||typeof s.borrower_id!=='string'||!s.borrower_id.trim())fail('Некоректні або дубльовані ID договорів.');
      if(day(s.as_of_date)>day(p.start_date))fail('План не може починатися раніше зрізу.');
      for(const key of ['principal','interest','penalty','excluded_amount'])if(typeof s[key]!=='number'||!Number.isFinite(s[key])||s[key]<0||s[key]>1e12)fail('Некоректна сума вимоги.');
      if(s.excluded_amount>s.principal+s.interest+s.penalty)fail('Виключення перевищує вимогу.');
      if(!['ready','review'].includes(s.quality))fail('Невідомий статус якості.');
      snapshots.set(s.loan_id,s);borrowers.add(s.borrower_id);
    }
    const op=new Map();
    for(const a of operations.accounts){
      if(!snapshots.has(a.loan_id)||op.has(a.loan_id))fail('Операційний статус має невідомий або повторний ID.');
      if(!['allowed','blocked','unknown'].includes(a.contact_status)||typeof a.rules_verified!=='boolean'||typeof a.active_payment_plan!=='boolean'||typeof a.legal_review_required!=='boolean')fail('Некоректні операційні статуси.');
      day(a.updated_at);if(day(a.updated_at)>day(p.start_date))fail('Операційний статус ще не був відомий на початку плану.');
      op.set(a.loan_id,a);
    }
    const scores=new Map();
    for(const s of forecast.scores){
      if(!snapshots.has(s.loan_id)||scores.has(s.loan_id))fail('Прогноз має невідомий або повторний ID.');
      if(s.as_of_date!==snapshots.get(s.loan_id).as_of_date)fail('Дата прогнозу не збігається зі зрізом.');
      if(day(addDays(p.start_date,89))>day(s.horizon_end))fail('90-денний план виходить за межі 12-місячного прогнозу. Оновіть зріз і прогноз.');
      if(s.status==='scored'){
        const basis=snapshots.get(s.loan_id).principal+snapshots.get(s.loan_id).interest+snapshots.get(s.loan_id).penalty-snapshots.get(s.loan_id).excluded_amount;
        for(const k of ['expected','conditional','probability'])if(typeof s[k]!=='number'||!Number.isFinite(s[k])||s[k]<0)fail('Некоректний прогноз.');
        if(s.probability>1||s.expected>s.conditional+.02||s.conditional>basis+.02||Math.abs(s.expected-s.probability*s.conditional)>.02)fail('Прогноз не звіряється з P × сумою.');
        if(snapshots.get(s.loan_id).quality!=='ready')fail('Неперевірена вимога не може мати прогноз.');
      }else if(s.expected!==null||s.conditional!==null||s.probability!==null)fail('Відмова від прогнозу має бути null, а не нуль.');
      scores.set(s.loan_id,s);
    }
    if(scores.size!==snapshots.size)fail('Прогноз має містити кожен договір.');
    return {snapshots,op,scores,borrowers};
  }
  function classify(s,score,op,borrowerBlocked=false){
    if(s.quality==='review'||score.status==='legal_review'||op?.legal_review_required)return {route:'legal_review',reason:'Потрібна внутрішня перевірка документів; контакти не плануються.'};
    if(score.status!=='scored')return {route:'data_review',reason:'Недостатньо підтверджених даних для прогнозу; можливі надходження не прирівняні до нуля.'};
    if(borrowerBlocked||op?.contact_status==='blocked')return {route:'monitor',reason:'Є заборона взаємодії за договором цього позичальника; завдань контакту немає.'};
    if(!op||op.contact_status!=='allowed'||!op.rules_verified)return {route:'permission_review',reason:'Допустимість взаємодії не підтверджена; лише внутрішня перевірка.'};
    if(op.active_payment_plan)return {route:'plan_support',reason:'Підтверджена чинна домовленість; чернетка супроводу після перевірки виконавцем.'};
    return {route:'voluntary_offer',reason:'Операційні прапорці дозволяють розглянути добровільне врегулювання; умови погоджує працівник.'};
  }
  function buildRows(input,p){
    const blocked=new Set([...input.op.values()].filter(a=>a.contact_status==='blocked').map(a=>input.snapshots.get(a.loan_id).borrower_id));
    return [...input.snapshots.values()].map(s=>{
      const score=input.scores.get(s.loan_id),op=input.op.get(s.loan_id),r=classify(s,score,op,blocked.has(s.borrower_id));
      const basis=s.principal+s.interest+s.penalty-s.excluded_amount;
      return {loan_id:s.loan_id,borrower_id:s.borrower_id,segment:s.segment,as_of_date:s.as_of_date,basis,
        probability_12m:score.probability,expected_12m:score.expected,base_90d:score.expected===null||r.route==='legal_review'?null:score.expected*p.share_90d,
        planning_status:r.route==='legal_review'&&score.status==='scored'?'legal_hold':score.status==='scored'?'estimated':'unscored',
        forecast_status:score.status,monthly_expected:score.monthly_expected||null,forecast_origin:s.as_of_date,max_incremental_expected:score.status==='scored'?score.probability*Math.max(0,basis-score.conditional):0,route:r.route,reason:r.reason,contact_allowed:!blocked.has(s.borrower_id)&&op?.contact_status==='allowed'&&op.rules_verified===true,
        scheduled_week:null,disposition:r.route==='monitor'?'monitor':'pending'};
    });
  }
  function calendar(p){return Array.from({length:13},(_,i)=>{
    const first=i*7,last=Math.min(90,(i+1)*7),factor=(last-first)/7;
    const staff={};for(const role of ['analyst','operator','legal'])staff[role]={capacity:p[role+'_hours_week']*factor,used:0,cost:p[role+'_hours_week']*p[role+'_hour_cost']*factor};
    return {week:i+1,start_date:addDays(p.start_date,first),end_date:addDays(p.start_date,last-1),start_day:first,end_day:last,days:last-first,
      staff,tasks:[],base_gross:0,incremental_gross:0,fixed_cost:0,external_cost:0,commission:0,gross:0,cost:0,net:0};
  });}
  function pv(value,dayNumber,p){return value/Math.pow(1+p.annual_discount,dayNumber/365);}
  function externalCost(route,p){return p[({plan_support:'support',voluntary_offer:'offer',legal_review:'legal',data_review:'data',permission_review:'permission'})[route]+'_external'];}
  function effect(row,week,p){
    const route=ROUTES[row.route];if(!route.cash)return {amount:0,activation_day:null,flow:[],pv_net:0};
    const prefix=row.route==='plan_support'?'support':'offer',activation=week.end_day+p[prefix+'_lag_days'];
    const remaining=Math.max(0,90-activation),amount=Math.min(Math.max(0,row.basis-row.base_90d),row.monthly_expected?row.max_incremental_expected:Infinity,row.base_90d*p[prefix+'_uplift']*remaining/90);
    const flow=[];let value=0;
    for(let i=0;i<13;i++){
      const start=i*7,end=Math.min(90,(i+1)*7),days=Math.max(0,end-Math.max(start,activation)),cash=remaining?amount*days/remaining:0;
      flow.push(cash);value+=pv(cash*(1-p.commission_rate),end,p);
    }
    return {amount,activation_day:activation,flow,pv_net:value};
  }
  function evaluateProfile(rowsInput,p,profile){
    const rows=rowsInput.map(r=>({...r})),weeks=calendar(p),total=rows.length;
    const known=rows.filter(r=>r.base_90d!==null);let base=known.reduce((s,r)=>s+r.base_90d,0);
    const fixedWeek=['analyst','operator','legal'].reduce((s,r)=>s+p[r+'_hours_week']*p[r+'_hour_cost'],0)+p.overhead_week+total*p.servicing_account_week;
    for(const w of weeks){w.base_gross=base*w.days/90;w.fixed_cost=fixedWeek*w.days/7;}
    if(rows.some(r=>r.monthly_expected)){
      const monthDate=(origin,m)=>{const d=new Date(day(origin)),year=d.getUTCFullYear(),month=d.getUTCMonth()+m;return Date.UTC(year,month,Math.min(d.getUTCDate(),new Date(Date.UTC(year,month+1,0)).getUTCDate()));};
      for(const w of weeks)w.base_gross=0;
      rows.forEach(r=>{if(!r.monthly_expected||r.base_90d===null)return;let total90=0;weeks.forEach(w=>{let value=0;const a=day(w.start_date),b=day(addDays(w.end_date,1));r.monthly_expected.forEach((cash,m)=>{const start=monthDate(r.forecast_origin,m),end=monthDate(r.forecast_origin,m+1);value+=cash*Math.max(0,Math.min(b,end)-Math.max(a,start))/(end-start);});w.base_gross+=value;total90+=value;});r.base_90d=total90;});
    }
    base=weeks.reduce((s,w)=>s+w.base_gross,0);
    const baseCost=weeks.reduce((s,w)=>s+w.fixed_cost+w.base_gross*p.commission_rate,0);
    const spendLimit=p.budget*(1-p.reserve_share),initialFeasible=baseCost<=spendLimit+.000001;
    let reserved=baseCost,offerCount=0;
    const maxOffers=Math.ceil(rows.filter(r=>r.route==='voluntary_offer').length*profile.offer_fraction);
    const queue=rows.filter(r=>r.route!=='monitor');
    for(const w of weeks){
      const contacted=new Set();
      const pending=queue.filter(r=>r.scheduled_week===null).map(row=>{
        const e=effect(row,w,p),cost=externalCost(row.route,p),info=ROUTES[row.route];
        return {row,e,cost,info,priority:info.cash?(e.pv_net-pv(cost,w.end_day,p))/info.hours:1e15+(row.route==='legal_review'?1e9:0)};
      }).sort((a,b)=>b.priority-a.priority||a.row.loan_id.localeCompare(b.row.loan_id));
      for(const item of pending){
        const {row,e,cost,info}=item;
        if(!initialFeasible)continue;
        if(info.cash&&(!row.contact_allowed||contacted.has(row.borrower_id)))continue;
        if(row.route==='voluntary_offer'&&offerCount>=maxOffers)continue;
        const cashCap=info.role==='operator'?w.staff.operator.capacity*profile.operator_fraction:w.staff[info.role].capacity;
        if(w.staff[info.role].used+info.hours>cashCap+1e-9)continue;
        if(info.cash&&(e.amount<=0||e.pv_net<=pv(cost,w.end_day,p)*profile.min_benefit_cost))continue;
        const incrementalBudget=cost+e.amount*p.commission_rate;
        if(reserved+incrementalBudget>spendLimit+1e-7)continue;
        reserved+=incrementalBudget;w.staff[info.role].used+=info.hours;w.external_cost+=cost;
        row.scheduled_week=w.week;row.disposition='draft';
        if(info.cash)contacted.add(row.borrower_id);if(row.route==='voluntary_offer')offerCount++;
        const task={loan_id:row.loan_id,borrower_id:row.borrower_id,route:row.route,label:info.label,role:info.role,hours:info.hours,
          external_cost:cost,incremental_gross:e.amount,incremental_pv_after_commission:e.pv_net-pv(cost,w.end_day,p),activation_day:e.activation_day,
          status:'draft',reason:row.reason};
        task.incremental_flow=e.flow;w.tasks.push(task);for(let i=0;i<weeks.length;i++)weeks[i].incremental_gross+=e.flow[i]||0;
      }
    }
    let cum=0,cumStress=0;
    const totals={base_gross:base,incremental_gross:0,gross:0,fixed_cost:0,external_cost:0,commission:0,cost:0,net:0,npv:0,baseline_npv:0,incremental_npv:0,
      stress_gross:0,stress_cost:0,stress_net:0,stress_npv:0,stress_incremental_npv:0};
    for(const w of weeks){
      w.gross=w.base_gross+w.incremental_gross;w.commission=w.gross*p.commission_rate;w.cost=w.fixed_cost+w.external_cost+w.commission;w.net=w.gross-w.cost;
      w.stress_gross=w.base_gross*p.stress_baseline_factor+w.incremental_gross*p.stress_uplift_factor;
      w.stress_cost=w.fixed_cost+w.external_cost+w.stress_gross*p.commission_rate;w.stress_net=w.stress_gross-w.stress_cost;
      cum+=w.net;cumStress+=w.stress_net;w.cumulative_net=cum;w.stress_cumulative_net=cumStress;
      for(const k of ['incremental_gross','gross','fixed_cost','external_cost','commission','cost','net','stress_gross','stress_cost','stress_net'])totals[k]+=w[k];
      totals.npv+=pv(w.net,w.end_day,p);totals.stress_npv+=pv(w.stress_net,w.end_day,p);
      totals.baseline_npv+=pv(w.base_gross*(1-p.commission_rate)-w.fixed_cost,w.end_day,p);
      totals.incremental_npv+=pv(w.incremental_gross*(1-p.commission_rate)-w.external_cost,w.end_day,p);
      totals.stress_incremental_npv+=pv(w.incremental_gross*p.stress_uplift_factor*(1-p.commission_rate)-w.external_cost,w.end_day,p);
    }
    const routes={};for(const key of Object.keys(ROUTES)){const a=rows.filter(r=>r.route===key);routes[key]={count:a.length,scheduled:a.filter(r=>r.scheduled_week!==null).length,base_90d:a.reduce((s,r)=>s+(r.base_90d||0),0)};}
    const tasks=weeks.flatMap(w=>w.tasks),criticalPending=rows.filter(r=>!ROUTES[r.route].cash&&r.route!=='monitor'&&r.scheduled_week===null).length;
    const plan={profile:profile.key,label:profile.label,status:'draft',horizon_days:90,start_date:p.start_date,end_date:addDays(p.start_date,89),
      params:{...p},policy:{...profile},route_rules:JSON.parse(JSON.stringify(ROUTES)),weeks,rows,routes,totals,budget:{limit:p.budget,reserve:p.budget*p.reserve_share,spend_limit:spendLimit,
        baseline_cost:baseCost,planned_cost:totals.cost,free_before_reserve:Math.max(0,spendLimit-totals.cost),
        funding_shortfall:Math.max(0,totals.cost-spendLimit),feasible:initialFeasible&&totals.cost<=spendLimit+.001},
      coverage:{total,scored:known.length,unscored:total-known.length,model_scored:rows.filter(r=>r.forecast_status==='scored').length,
        legal_hold:rows.filter(r=>r.planning_status==='legal_hold').length},task_count:tasks.length,critical_pending:criticalPending,
      all_checkpoints:Array.from({length:13},(_,i)=>({week:i+1,collection_floor:p.review_collection_floor,cost_ceiling:p.review_cost_ceiling}))};
    plan.plan_id=VERSION+'-'+hash({profile,route_rules:ROUTES,params:p,rows:rows.map(r=>[r.loan_id,r.route,r.scheduled_week,r.expected_12m]),tasks});
    return plan;
  }
  function buildPlans(pack,operations,forecast,params={}){
    const p=normalizeParams(params),input=validateInputs(pack,operations,forecast,p),rows=buildRows(input,p);
    const plans=PROFILES.map(profile=>evaluateProfile(rows,p,profile));
    const feasible=plans.filter(s=>s.budget.feasible);
    const best=feasible.slice().sort((a,b)=>b.totals.stress_incremental_npv-a.totals.stress_incremental_npv||a.totals.cost-b.totals.cost||a.profile.localeCompare(b.profile))[0];
    return {schema_version:1,engine_version:VERSION,source_model:forecast.model_id||'unspecified',synthetic_training:forecast.synthetic_training===true,
      synthetic_data:pack.meta?.synthetic===true&&operations.meta?.synthetic===true,source_fingerprint:hash({case:pack,operations,forecast}),
      recommendation:best?.totals.stress_incremental_npv>0?best.profile:null,plans};
  }
  function reviewWeek(plan,weekNumber,actualGross,actualCost){
    if(!Number.isInteger(weekNumber)||weekNumber<1||weekNumber>13)fail('Невідомий тиждень.');
    for(const x of [actualGross,actualCost])if(typeof x!=='number'||!Number.isFinite(x)||x<0)fail('Факт має бути невід’ємним числом.');
    const w=plan.weeks[weekNumber-1],cashRatio=w.gross>0?actualGross/w.gross:null,costRatio=w.cost>0?actualCost/w.cost:null;
    const flags=[];if(cashRatio!==null&&cashRatio<plan.params.review_collection_floor)flags.push('collections_below_plan');
    if((costRatio!==null&&costRatio>plan.params.review_cost_ceiling)||(w.cost===0&&actualCost>0))flags.push('costs_above_plan');
    return {plan_id:plan.plan_id,week:weekNumber,actual_gross:actualGross,actual_cost:actualCost,collection_ratio:cashRatio,cost_ratio:costRatio,
      gross_deviation:actualGross-w.gross,cost_deviation:actualCost-w.cost,flags,review_required:flags.length>0};
  }
  return {VERSION,DEFAULTS,ROUTES,PROFILES,normalizeParams,buildPlans,reviewWeek,addDays};
});

if(typeof module==='object'&&require.main===module){
  const fs=require('node:fs'),[casePath,operationsPath,forecastPath,paramsPath]=process.argv.slice(2);
  try{const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));process.stdout.write(JSON.stringify(module.exports.buildPlans(read(casePath),read(operationsPath),read(forecastPath),paramsPath?read(paramsPath):{})));}
  catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}
}
