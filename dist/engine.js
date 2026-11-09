/* Unlevered pre-tax scenario model. Mirrored by python/valuation.py. */
(function(root) {
  'use strict';
  const SEGMENTS = {
    bank_early: {label:'Банк · 90–360 днів', recovery:.32, payer:.50, scale:5},
    bank_late: {label:'Банк · понад 360 днів', recovery:.18, payer:.30, scale:8},
    mfo_early: {label:'МФО · 90–360 днів', recovery:.21, payer:.40, scale:4},
    mfo_late: {label:'МФО · понад 360 днів', recovery:.10, payer:.25, scale:6}
  };
  const DEFAULTS = {price:3190000, annual_return:.60, cost_rate:.08, startup:100000, multiplier:1, payer_multiplier:1, delay:0,
    cost_mode:'detailed',monthly_fixed:12000,monthly_it:2500,monthly_overhead:2500,fixed_months:18,
    account_monthly:7,work_months:12,action_unit_cost:18,actions_per_account:4,action_month:1,
    legal_share:.10,legal_unit_cost:1600,legal_month:4,review_unit_cost:25,expense_multiplier:1,extra_costs:[]};

  function validateRows(rows) {
    if (!rows.length || rows.length>50000) throw Error('Потрібно від 1 до 50 000 договорів.');
    const ids=new Set();
    for (const r of rows) {
      if (!String(r.loan_id||'').trim() || !String(r.borrower_id||'').trim()) throw Error('Відсутній ID договору або позичальника.');
      if (ids.has(r.loan_id)) throw Error('Дубль ID договору: '+r.loan_id);
      ids.add(r.loan_id);
      if (!Object.hasOwn(SEGMENTS,r.segment) || !['ready','review'].includes(r.quality)) throw Error('Невідомий сегмент або статус якості.');
      for (const k of ['principal','interest','penalty','excluded_amount','dpd']) if(!Number.isFinite(r[k]) || r[k]<0) throw Error('Некоректне числове поле: '+k);
      if(r.excluded_amount>r.principal+r.interest+r.penalty+1e-8) throw Error('Виключена сума перевищує номінал.');
    }
    if(rows.reduce((s,r)=>s+r.principal+r.interest+r.penalty,0)<=0)throw Error('Номінал портфеля має бути додатним.');
  }
  function evaluate(rows, options={}) {
    validateRows(rows);
    const o={...DEFAULTS,...options};
    const collectionMonths=o.collection_months??36;
    if(![12,36].includes(collectionMonths))throw Error('Горизонт прогнозу має бути 12 або 36 місяців.');
    const forecast=o.loan_forecast;
    if(forecast){
      if(!Array.isArray(forecast)||forecast.length!==rows.length)throw Error('Прогноз має покривати весь реєстр.');
      const ids=new Set();
      forecast.forEach((f,i)=>{if(!f||f.loan_id!==rows[i].loan_id||ids.has(f.loan_id))throw Error('Прогноз не відповідає реєстру.');ids.add(f.loan_id);if(f.status==='scored'){const cap=rows[i].principal+rows[i].interest+rows[i].penalty-rows[i].excluded_amount;if(rows[i].quality!=='ready'||!Number.isFinite(f.probability)||f.probability<0||f.probability>1||!Number.isFinite(f.conditional)||f.conditional<0||f.conditional>cap+1e-7)throw Error('Некоректний індивідуальний прогноз.');}else if(f.probability!==null||f.conditional!==null)throw Error('Невідомий прогноз має бути null.');});
    }
    for(const k of Object.keys(DEFAULTS).filter(k=>!['cost_mode','extra_costs'].includes(k))) if(!Number.isFinite(o[k]))throw Error('Некоректний параметр: '+k);
    if(o.price<=0||o.startup<0||o.annual_return<0||o.cost_rate<0||o.cost_rate>=1||o.multiplier<0||o.multiplier>3||o.payer_multiplier<0||o.payer_multiplier>3||!Number.isInteger(o.delay)||o.delay<0||o.delay>24)throw Error('Параметри оцінки поза допустимими межами.');
    if(!['simple','detailed'].includes(o.cost_mode)||o.legal_share<0||o.legal_share>1||o.expense_multiplier<0)throw Error('Некоректні припущення витрат.');
    for(const k of ['monthly_fixed','monthly_it','monthly_overhead','account_monthly','action_unit_cost','actions_per_account','legal_unit_cost','review_unit_cost'])if(o[k]<0)throw Error('Витрата не може бути від’ємною.');
    for(const k of ['fixed_months','work_months'])if(!Number.isInteger(o[k])||o[k]<0||o[k]>60)throw Error('Тривалість має бути від 0 до 60 місяців.');
    for(const k of ['action_month','legal_month'])if(!Number.isInteger(o[k])||o[k]<1||o[k]>84)throw Error('Місяць події має бути від 1 до 84.');
    if(!Array.isArray(o.extra_costs)||o.extra_costs.length>100)throw Error('Некоректний календар додаткових витрат.');
    for(const c of o.extra_costs)if(!c||typeof c.label!=='string'||!c.label.trim()||c.label.length>120||!Number.isInteger(c.month)||c.month<1||c.month>84||!Number.isFinite(c.amount)||c.amount<0)throw Error('Перевірте назву, місяць і суму додаткової витрати.');
    const detailed=o.cost_mode==='detailed',delay=o.delay;
    const fixedN=o.fixed_months?o.fixed_months+delay:0,workN=o.work_months?o.work_months+delay:0;
    const horizon=Math.max(collectionMonths+delay,...(detailed?[fixedN,workN,o.action_month,o.legal_month,...o.extra_costs.map(c=>c.month)]:[0]));
    const gross=Array(horizon).fill(0),segments={},records=[],weights={};
    const sum=a=>a.reduce((x,y)=>x+y,0);
    for(const [key,spec] of Object.entries(SEGMENTS)){const w=Array.from({length:collectionMonths},(_,t)=>(t+1)*Math.exp(-t/spec.scale)),z=sum(w);weights[key]=w.map(v=>v/z);}
    const discounts=Array.from({length:horizon},(_,t)=>Math.pow(1+o.annual_return,-(t+1)/12));
    const pv=values=>sum(values.map((v,t)=>v*discounts[t]));
    let face=0,excluded=0,review=0,eligible=0,ready_count=0;
    for(const [index,r] of rows.entries()){
      const f=r.principal+r.interest+r.penalty,e=f-r.excluded_amount;
      face+=f;excluded+=r.excluded_amount;
      const seg=segments[r.segment]??={count:0,ready_count:0,face:0,eligible:0,gross:0,payers:0,contribution:0};
      seg.count++;seg.face+=f;
      const pred=forecast?.[index],accepted=r.quality==='ready'&&(!pred||pred.status==='scored'),spec=SEGMENTS[r.segment];
      const conditional=Math.min(e,(pred?pred.conditional??0:e*spec.recovery/spec.payer)*o.multiplier);
      const probability=accepted&&conditional>0?Math.min(1,(pred?pred.probability:spec.payer)*o.payer_multiplier):0,expected=probability*conditional;
      if(!accepted)review+=e;else{ready_count++;eligible+=e;seg.ready_count++;seg.eligible+=e;seg.gross+=expected;seg.payers+=probability;}
      const pv_gross=expected*sum(weights[r.segment].map((w,t)=>w*discounts[t+delay]));
      records.push({loan_id:r.loan_id,segment:r.segment,quality:r.quality,estimated:accepted,forecast_status:pred?.status||(accepted?'scored':'legal_review'),probability,conditional:accepted?conditional:0,gross:expected,pv_gross,weights:weights[r.segment]});
    }
    for(const [key,seg] of Object.entries(segments))weights[key].forEach((w,t)=>gross[t+delay]+=seg.gross*w);
    const categoryKeys=['commission','team','it','overhead','accounts','actions','legal','review','extra'];
    const categories=Object.fromEntries(categoryKeys.map(k=>[k,Array(horizon).fill(0)])),factor=o.expense_multiplier;
    categories.commission=gross.map(g=>g*o.cost_rate*factor);
    if(detailed){
      for(let t=0;t<fixedN;t++)for(const [cat,key] of [['team','monthly_fixed'],['it','monthly_it'],['overhead','monthly_overhead']])categories[cat][t]=o[key]*factor;
      for(let t=0;t<workN;t++)categories.accounts[t]=rows.length*o.account_monthly*factor;
      categories.actions[o.action_month-1]=rows.length*o.actions_per_account*o.action_unit_cost*factor;
      categories.legal[o.legal_month-1]=rows.filter(r=>r.quality==='ready').length*o.legal_share*o.legal_unit_cost*factor;
      categories.review[0]=rows.length*o.review_unit_cost*factor;
      for(const c of o.extra_costs)categories.extra[c.month-1]+=c.amount*factor;
    }
    if(o.strategy_overlay){
      if(!detailed)throw Error('Для застосування стратегії потрібен детальний бюджет.');
      const overlay=o.strategy_overlay;
      if(!Array.isArray(overlay.costs)||!Array.isArray(overlay.replace)||overlay.costs.length>collectionMonths||overlay.replace.length!==overlay.costs.length||overlay.costs.some(v=>!Number.isFinite(v)||v<0)||overlay.replace.some(v=>!Number.isFinite(v)||v<0||v>1)||!overlay.uplifts||typeof overlay.uplifts!=='object')throw Error('Некоректний календар стратегії.');
      records.forEach((r,i)=>{const flows=overlay.uplifts[r.loan_id];if(!flows)return;if(!Array.isArray(flows)||flows.length!==collectionMonths||flows.some(v=>!Number.isFinite(v)||v<0))throw Error('Некоректний ефект дій.');if(!r.estimated||r.probability<=0)return;const cap=rows[i].principal+rows[i].interest+rows[i].penalty-rows[i].excluded_amount,raw=sum(flows),reference=overlay.probabilities?.[r.loan_id]??r.probability,requested=reference>0?raw*r.probability/reference:0,extra=Math.min(requested,Math.max(0,r.probability*(cap-r.conditional))),scale=raw?extra/raw:0;
        const before=r.gross,oldWeights=r.weights;r.gross+=extra;r.conditional=r.gross/r.probability;r.custom_weights=extra>0;r.weights=oldWeights.map((w,t)=>r.gross?(before*w+flows[t]*scale)/r.gross:w);r.pv_gross=r.gross*sum(r.weights.map((w,t)=>w*discounts[t+delay]));segments[r.segment].gross+=extra;flows.forEach((v,t)=>gross[t+delay]+=v*scale);
      });
      for(const key of ['team','it','overhead','accounts'])for(let t=0;t<overlay.replace.length;t++)categories[key][t]*=1-overlay.replace[t];
      for(const key of ['actions','legal','review'])for(let t=0;t<overlay.replace.length;t++)categories[key][t]*=1-(overlay.replace_events?.[t]??overlay.replace[t]);
      overlay.costs.forEach((v,t)=>categories.extra[t]+=v*factor);
      categories.commission=gross.map(g=>g*o.cost_rate*factor);
    }
    const costs=Array.from({length:horizon},(_,t)=>sum(categoryKeys.map(k=>categories[k][t]))),net=gross.map((g,t)=>g-costs[t]);
    const initial=o.price+o.startup,pvNet=pv(net),signs=[-initial,...net].filter(v=>Math.abs(v)>1e-8).map(v=>v>0?1:-1);
    const changes=signs.slice(1).reduce((n,v,i)=>n+(v!==signs[i]?1:0),0);
    let irr=null,irr_status=changes>1?'nonconventional':'no_positive_cashflow';
    if(changes===1){
      const npvAt=r=>sum(net.map((v,t)=>v/Math.pow(1+r,(t+1)/12)))-initial;
      let lo=-.999999,hi=1;while(npvAt(hi)>0&&hi<1e6)hi=hi*2+1;
      if(npvAt(lo)>=0&&npvAt(hi)<=0){for(let i=0;i<160;i++){const mid=(lo+hi)/2;if(npvAt(mid)>0)lo=mid;else hi=mid;}irr=(lo+hi)/2;irr_status='unique';}
    }
    const operatingCumulative=[0];net.forEach(v=>operatingCumulative.push(operatingCumulative.at(-1)+v));
    const suffixMin=[...operatingCumulative];for(let t=horizon-1;t>=0;t--)suffixMin[t]=Math.min(suffixMin[t],suffixMin[t+1]);
    let payback=null;
    for(let t=0;t<horizon;t++)if(net[t]>0&&operatingCumulative[t]<initial&&initial<=operatingCumulative[t+1]&&suffixMin[t+1]>=initial-1e-8){payback=t+(initial-operatingCumulative[t])/net[t];break;}
    const payers=sum(records.map(r=>r.probability)),allocation={payers:0,nonpayers:0,review:0,shared:0};
    const ordinary=sum(['review','accounts','actions'].map(k=>sum(categories[k])))/rows.length;
    const ordinaryPV=sum(['review','accounts','actions'].map(k=>pv(categories[k])))/rows.length;
    const legalCount=rows.filter(r=>r.quality==='ready').length;
    const legal=legalCount?sum(categories.legal)/legalCount:0,legalPV=legalCount?pv(categories.legal)/legalCount:0;
    for(const r of records){
      const perAccount=ordinary+(r.quality==='ready'?legal:0);
      const directPV=ordinaryPV+(r.quality==='ready'?legalPV:0)+r.pv_gross*o.cost_rate*factor;
      if(!r.estimated)allocation.review+=perAccount;else{allocation.payers+=perAccount*r.probability+r.gross*o.cost_rate*factor;allocation.nonpayers+=perAccount*(1-r.probability);}
      r.direct_cost=perAccount+r.gross*o.cost_rate*factor;r.contribution=r.pv_gross-directPV;segments[r.segment].contribution+=r.contribution;
    }
    const sharedKeys=['team','it','overhead','extra'];allocation.shared=sum(sharedKeys.map(k=>sum(categories[k])))+o.startup;
    const category_totals=Object.fromEntries(categoryKeys.map(k=>[k,sum(categories[k])])),shared_pv=sum(sharedKeys.map(k=>pv(categories[k])))+o.startup;
    const cost_total=sum(costs)+o.startup,other=sum(costs)-category_totals.commission,denominator=payers*(1-o.cost_rate*factor);
    return{options:o,count:rows.length,ready_count,face,excluded,review,eligible,gross,costs,net,categories,category_totals,allocation,records,
      gross_total:sum(gross),cost_total,max_price:pvNet-o.startup,npv:pvNet-initial,irr,irr_status,payback,profit:sum(net)-initial,payers,
      nonpayers:ready_count-payers,collection_months:collectionMonths,unknown_count:rows.length-ready_count,shared_pv,funding_peak:initial-Math.min(...operatingCumulative),operating_cash_gap:-Math.min(...operatingCumulative),
      cash_balance:operatingCumulative.map(v=>v-initial),break_even_average:denominator>0?(initial+other)/denominator:null,
      average_payer:payers>0?sum(gross)/payers:null,coverage:sum(gross)/(o.price+cost_total),segments};
  }
  function parseCSV(text) {
    text=text.replace(/^\uFEFF/,'');
    const table=[];let row=[],field='',quoted=false;
    for(let i=0;i<text.length;i++) {const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else if(!quoted&&field.length)throw Error('Некоректні лапки CSV.');else quoted=!quoted;}
      else if(c===','&&!quoted){row.push(field);field='';}
      else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))table.push(row);row=[];field='';}
      else field+=c;}
    if(quoted)throw Error('Незакриті лапки CSV.');
    if(field.length||row.length){row.push(field);if(row.some(x=>x.trim()))table.push(row);}
    if(table.length<2)throw Error('CSV має містити заголовок і дані.');
    const header=table.shift().map(x=>x.trim()),required=['loan_id','borrower_id','segment','principal','interest','penalty','excluded_amount','dpd','quality'];
    if(new Set(header).size!==header.length||required.some(k=>!header.includes(k))) throw Error('CSV не відповідає шаблону. Завантажте приклад реєстру.');
    const rows=table.map(line=>{if(line.length!==header.length)throw Error('Нерівна кількість колонок у CSV.');const r={};header.forEach((k,i)=>{if(required.includes(k))r[k]=line[i].trim();});
      for(const k of ['principal','interest','penalty','excluded_amount','dpd']) {if(r[k]==='')throw Error('Порожнє числове поле: '+k);r[k]=Number(r[k]);}return r;});
    validateRows(rows);return rows;
  }
  const api={SEGMENTS,DEFAULTS,evaluate,parseCSV,validateRows};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.NPL=api;
})(typeof globalThis!=='undefined'?globalThis:this);
