/* Risk/return comparison of paired cash-flow snapshots. No probability model. */
(function(root){
  'use strict';
  const POLICY='relative-0.8-1.25-plus3-v1',SCHEMA='npl-risk-map-v1',LIMIT=40;
  const finite=(x,label)=>{if(typeof x!=='number'||!Number.isFinite(x))throw Error('Некоректне число: '+label);return x;};
  const text=(s,label,max=120)=>{if(typeof s!=='string'||!s.trim()||s.length>max)throw Error('Некоректне поле: '+label);return s;};
  function validateSnapshot(s){
    if(!s||typeof s!=='object')throw Error('Відсутній знімок оцінки.');
    text(s.id,'id',100);text(s.name,'назва');
    if(!['synthetic','csv','imported'].includes(s.source))throw Error('Невідоме джерело оцінки.');
    if(typeof s.created_at!=='string'||!Number.isFinite(Date.parse(s.created_at)))throw Error('Некоректна дата знімка.');
    if(s.policy!==POLICY)throw Error('Несумісний сценарій стресу.');
    if(finite(s.price,'ціна')<=0||finite(s.startup,'початкові')<0||s.price>1e15||s.startup>1e15)throw Error('Потрібна додатна ціна та невід’ємні початкові витрати.');
    if(!Number.isSafeInteger(s.count)||s.count<1||s.count>50000||!Number.isSafeInteger(s.review_count)||s.review_count<0||s.review_count>s.count)throw Error('Некоректна кількість договорів.');
    if(finite(s.face,'номінал')<=0)throw Error('Некоректний номінал.');
    for(const key of ['base','stress']){
      const f=s.flows?.[key];if(!f||!Array.isArray(f.gross)||!Array.isArray(f.costs)||!f.gross.length||f.gross.length>84||f.gross.length!==f.costs.length)throw Error('Перевірте місячні потоки '+key+'.');
      for(const values of [f.gross,f.costs])for(const x of values)if(finite(x,'потік')<0||x>1e15)throw Error('Потік поза допустимими межами.');
    }
    const a=s.assumptions;
    if(!a||!['simple','detailed'].includes(a.cost_mode))throw Error('Відсутні припущення.');
    for(const key of ['payer_multiplier','multiplier','expense_multiplier','delay'])finite(a[key],key);
    if(a.payer_multiplier<0||a.payer_multiplier>3||a.multiplier<0||a.multiplier>3||a.expense_multiplier<0||!Number.isInteger(a.delay)||a.delay<0||a.delay>21)throw Error('Припущення поза межами стрес-тесту.');
    // Retain only whitelisted fields, never imported scores, HTML or loan records.
    return {id:s.id,name:s.name.trim(),source:s.source,created_at:s.created_at,forecast:s.forecast&&['ml','scenario'].includes(s.forecast.source)&&[12,36].includes(s.forecast.horizon_months)?{source:s.forecast.source,horizon_months:s.forecast.horizon_months}:null,policy:POLICY,price:s.price,startup:s.startup,count:s.count,review_count:s.review_count,face:s.face,flows:{base:{gross:[...s.flows.base.gross],costs:[...s.flows.base.costs]},stress:{gross:[...s.flows.stress.gross],costs:[...s.flows.stress.costs]}},assumptions:{cost_mode:a.cost_mode,payer_multiplier:a.payer_multiplier,multiplier:a.multiplier,expense_multiplier:a.expense_multiplier,delay:a.delay}};
  }
  function stressOptions(o){
    if(!Number.isInteger(o.delay)||o.delay<0||o.delay>21)throw Error('Для карти затримка бази має бути від 0 до 21 міс.; стрес додає ще 3 міс.');
    return {...o,payer_multiplier:o.payer_multiplier*.8,expense_multiplier:o.expense_multiplier*1.25,delay:o.delay+3};
  }
  function snapshot(rows,o,meta,evaluator){
    if(typeof evaluator!=='function')throw Error('Потрібен фінансовий движок.');
    const base=evaluator(rows,o),stress=evaluator(rows,stressOptions(base.options)),a=base.options;
    return validateSnapshot({id:meta.id,name:meta.name,source:meta.source,created_at:meta.created_at,forecast:a.forecast_meta,policy:POLICY,price:a.price,startup:a.startup,count:base.count,review_count:base.count-base.ready_count,face:base.face,flows:{base:{gross:base.gross,costs:base.costs},stress:{gross:stress.gross,costs:stress.costs}},assumptions:{cost_mode:a.cost_mode,payer_multiplier:a.payer_multiplier,multiplier:a.multiplier,expense_multiplier:a.expense_multiplier,delay:a.delay}});
  }
  function cashSummary(flow,initial,rate){
    finite(initial,'початкові вкладення');if(initial<=0||initial>2e15)throw Error('Некоректні початкові вкладення.');
    finite(rate,'ставка');if(rate<0||rate>1.5)throw Error('Ставка порівняння має бути від 0% до 150%.');
    const net=flow.gross.map((v,i)=>v-flow.costs[i]);
    const npvAt=r=>net.reduce((s,v,i)=>s+v/Math.pow(1+r,(i+1)/12),0)-initial;
    const signs=[-initial,...net].filter(v=>Math.abs(v)>1e-8).map(v=>v>0?1:-1);
    const changes=signs.slice(1).reduce((n,v,i)=>n+(v!==signs[i]?1:0),0);
    let irr=null,irr_status=changes>1?'nonconventional':'no_positive_cashflow';
    if(changes===1){let lo=-.999999,hi=1;while(npvAt(hi)>0&&hi<1e6)hi=hi*2+1;if(npvAt(lo)>=0&&npvAt(hi)<=0){for(let i=0;i<160;i++){const mid=(lo+hi)/2;if(npvAt(mid)>0)lo=mid;else hi=mid;}irr=(lo+hi)/2;irr_status='unique';}}
    const cumulative=[0];net.forEach(v=>cumulative.push(cumulative.at(-1)+v));
    const suffix=[...cumulative];for(let t=net.length-1;t>=0;t--)suffix[t]=Math.min(suffix[t],suffix[t+1]);
    let payback=null;for(let t=0;t<net.length;t++)if(net[t]>0&&cumulative[t]<initial&&initial<=cumulative[t+1]&&suffix[t+1]>=initial-1e-8){payback=t+(initial-cumulative[t])/net[t];break;}
    return {npv:npvAt(rate),irr,irr_status,payback,funding_peak:initial-Math.min(...cumulative),gross:flow.gross.reduce((s,v)=>s+v,0),future_cost:flow.costs.reduce((s,v)=>s+v,0),profit:cumulative.at(-1)-initial,horizon:net.length};
  }
  function measure(input,rate){
    const s=validateSnapshot(input),initial=s.price+s.startup;
    const base=cashSummary(s.flows.base,initial,rate),stress=cashSummary(s.flows.stress,initial,rate);
    const decline=base.npv-stress.npv,risk_pct=decline/initial*100;
    const status=base.npv<0?'base_fails':stress.npv<0?'stress_fails':'both_pass';
    return {id:s.id,name:s.name,source:s.source,initial,base,stress,decline,risk_pct,status,plottable:base.irr!==null,review_count:s.review_count,count:s.count,rate};
  }
  function validateCollection(p,{imported=false}={}){
    if(!p||p.schema!==SCHEMA||p.policy!==POLICY||!Array.isArray(p.snapshots)||p.snapshots.length>LIMIT)throw Error('Несумісний пакет карти або понад '+LIMIT+' знімків.');
    finite(p.annual_return,'ставка');if(p.annual_return<0||p.annual_return>1.5)throw Error('Некоректна ставка порівняння.');
    const ids=new Set();const snapshots=p.snapshots.map(item=>{const s=validateSnapshot(item);if(s.id==='live'||ids.has(s.id))throw Error('Дубль або зарезервований ID оцінки.');ids.add(s.id);if(imported)s.source='imported';return s;});
    return {schema:SCHEMA,policy:POLICY,annual_return:p.annual_return,snapshots};
  }
  function csv(items,rate){
    const headers=['portfolio','source','initial_uah','base_npv_uah','stress_npv_uah','npv_decline_uah','npv_decline_pct_initial','base_irr_annual','base_payback_months','base_funding_peak_uah','status','discount_rate_annual'];
    const cell=v=>{let s=v===null?'':String(v);if(/^[=+@\-\t\r]/.test(s)&&typeof v==='string')s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
    return '\uFEFF'+[headers.map(cell).join(','),...items.map(s=>{const m=measure(s,rate);return [s.name,s.source,m.initial,m.base.npv,m.stress.npv,m.decline,m.risk_pct,m.base.irr,m.base.payback,m.base.funding_peak,m.status,rate].map(cell).join(',');})].join('\r\n');
  }
  const api={POLICY,SCHEMA,LIMIT,snapshot,stressOptions,validateSnapshot,validateCollection,cashSummary,measure,csv};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;root.RISK=api;
})(typeof globalThis!=='undefined'?globalThis:this);
