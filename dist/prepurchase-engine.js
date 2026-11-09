/* Exported model inference only. Training and target construction live in Python. */
(function(root){
  'use strict';
  const SEGMENTS=['bank_early','bank_late','mfo_early','mfo_late'];
  const FEATURES=['log_basis','log_dpd','log_count_30','log_count_90','log_count_180','paid_fraction_90','paid_fraction_previous90','days_since_payment_180','no_payment_180',...SEGMENTS.map(s=>'segment_'+s)];
  const DAY=86400000;
  function day(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('Дата має бути YYYY-MM-DD.');const d=new Date(s+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)throw Error('Некоректна дата.');return d.getTime();}
  function horizonEnd(s){const d=new Date(day(s));const year=d.getUTCFullYear()+1,month=d.getUTCMonth(),n=d.getUTCDate();return new Date(Date.UTC(year,month,Math.min(n,new Date(Date.UTC(year,month+1,0)).getUTCDate()))).toISOString().slice(0,10);}
  const sigmoid=x=>1/(1+Math.exp(-Math.max(-40,Math.min(40,x))));
  function validatePackage(pack){
    if(!Array.isArray(pack.snapshots)||!pack.snapshots.length||pack.snapshots.length>50000)throw Error('Потрібно 1–50 000 зрізів договорів.');
    if(!Array.isArray(pack.payments)||pack.payments.length>500000)throw Error('Некоректна історія платежів.');
    const ids=new Set(),portfolios=new Map();
    for(const s of pack.snapshots){
      for(const key of ['loan_id','borrower_id','portfolio_id','seller_id'])if(typeof s[key]!=='string'||!s[key].trim())throw Error('Відсутнє поле '+key);
      if(ids.has(s.loan_id))throw Error('Дубль зрізу договору.');ids.add(s.loan_id);
      const cutoff=day(s.as_of_date);if(day(s.issued_at)>cutoff)throw Error('Видача після дати оцінки.');
      if(!SEGMENTS.includes(s.segment)||!['ready','review'].includes(s.quality))throw Error('Невідомий сегмент або статус.');
      for(const key of ['principal','interest','penalty','excluded_amount','dpd'])if(!Number.isFinite(s[key])||s[key]<0)throw Error('Некоректне поле '+key);
      if(s.excluded_amount>s.principal+s.interest+s.penalty)throw Error('Виключення перевищують номінал.');
      if(portfolios.has(s.portfolio_id)&&portfolios.get(s.portfolio_id)!==cutoff)throw Error('Портфель повинен мати єдину дату зрізу.');portfolios.set(s.portfolio_id,cutoff);
    }
    for(const p of pack.payments){if(!ids.has(p.loan_id))throw Error('Платіж за невідомим договором.');if(day(p.available_at)<day(p.payment_date))throw Error('Дата доступності платежу раніше його дати.');if(!Number.isFinite(p.amount)||p.amount<0)throw Error('Суми платежів мають бути невід’ємними; коригування потрібно попередньо звірити.');}
  }
  function featureRow(s,payments){
    const cutoff=day(s.as_of_date),basis=s.principal+s.interest+s.penalty-s.excluded_amount;
    if(s.quality!=='ready')return{features:null,reason:'legal_review'};
    if(basis<=0)return{features:null,reason:'zero_basis'};
    if(s.history_complete!==true)return{features:null,reason:'history_unknown'};
    const start=Math.max(day(s.issued_at),cutoff-180*DAY);
    if(!s.history_start_date||day(s.history_start_date)>start)return{features:null,reason:'history_too_short'};
    const known=payments.filter(p=>day(p.payment_date)>start&&day(p.payment_date)<=cutoff&&day(p.available_at)<=cutoff&&p.amount>0);
    const ago=p=>(cutoff-day(p.payment_date))/DAY;
    const count=n=>known.filter(p=>ago(p)<n).length;
    const paid=(lo,hi)=>known.filter(p=>ago(p)>=lo&&ago(p)<hi).reduce((a,p)=>a+p.amount,0);
    const last=Math.min(180,...known.map(ago));
    return{features:[Math.log1p(basis),Math.log1p(s.dpd),Math.log1p(count(30)),Math.log1p(count(90)),Math.log1p(count(180)),paid(0,90)/basis,paid(90,180)/basis,last/180,known.length?0:1,...SEGMENTS.map(k=>s.segment===k?1:0)],reason:null};
  }
  function predict(model,x){
    const z=x.map((v,i)=>(v-model.mean[i])/model.scale[i]);
    const logit=model.classifier.intercept+z.reduce((s,v,i)=>s+v*model.classifier.coefficients[i],0);
    const probability=sigmoid(model.calibration.intercept+model.calibration.coefficient*logit);
    const fraction=Math.max(0,Math.min(1,model.amount.intercept+z.reduce((s,v,i)=>s+v*model.amount.coefficients[i],0)));
    return{probability,fraction,z};
  }
  function scorePackage(model,pack){
    validatePackage(pack);
    if(JSON.stringify(model.features)!==JSON.stringify(FEATURES)||model.horizon_months!==12||model.schema_version!==1)throw Error('Несумісна схема моделі.');
    for(const a of [model.mean,model.scale,model.classifier.coefficients,model.amount.coefficients])if(!Array.isArray(a)||a.length!==FEATURES.length||a.some(v=>!Number.isFinite(v)))throw Error('Некоректний вектор моделі.');
    if(model.scale.some(v=>v<=0)||[model.classifier.intercept,model.calibration.coefficient,model.calibration.intercept,model.amount.intercept].some(v=>!Number.isFinite(v)))throw Error('Некоректні коефіцієнти моделі.');
    const index=new Map();for(const p of pack.payments){if(!index.has(p.loan_id))index.set(p.loan_id,[]);index.get(p.loan_id).push(p);}
    const scores=pack.snapshots.map(s=>{
      const f=featureRow(s,index.get(s.loan_id)||[]);
      const out={loan_id:s.loan_id,borrower_id:s.borrower_id,segment:s.segment,as_of_date:s.as_of_date,horizon_end:horizonEnd(s.as_of_date),status:f.reason||'scored',probability:null,conditional:null,expected:null,unseen_seller:!model.training_sellers.includes(s.seller_id)};
      if(f.features){const r=predict(model,f.features),basis=s.principal+s.interest+s.penalty-s.excluded_amount;Object.assign(out,{probability:r.probability,conditional:basis*r.fraction,expected:r.probability*basis*r.fraction,features:f.features,effects:r.z.map((v,i)=>model.calibration.coefficient*v*model.classifier.coefficients[i])});}
      return out;
    });
    const known=scores.filter(s=>s.status==='scored');
    return{model_id:model.model_id,synthetic_training:model.synthetic_training,horizon_months:12,scores,scored:known.length,total:scores.length,expected_payers:known.reduce((s,r)=>s+r.probability,0),expected_gross:known.reduce((s,r)=>s+r.expected,0)};
  }
  const api={FEATURES,day,horizonEnd,featureRow,predict,scorePackage,validatePackage};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;root.PRE=api;
})(typeof globalThis!=='undefined'?globalThis:this);
