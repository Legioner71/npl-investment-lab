/* Seeded recovery simulation. Shared by browser Worker and local Node/Python CLI. */
(function(root){
  'use strict';
  const VERSION='npl-mc-v1',DEFAULTS={draws:5000,seed:20261030,common_rho:.08,borrower_share:.65,amount_spread:.35,cost_spread:.20,delay_jitter:3};
  const sum=a=>a.reduce((s,v)=>s+v,0);
  function validate(input={},count=0){
    const p={...DEFAULTS,...input};
    for(const k of Object.keys(DEFAULTS))if(typeof p[k]!=='number'||!Number.isFinite(p[k]))throw Error('Некоректний параметр Монте-Карло: '+k);
    if(!Number.isInteger(p.draws)||p.draws<1||p.draws>20000||!Number.isInteger(p.seed)||p.seed<0||p.seed>4294967295)throw Error('Від 1 до 20 000 симуляцій; seed — ціле 0…4294967295.');
    if(p.common_rho<0||p.common_rho>.6||p.borrower_share<0||p.borrower_share>1||p.amount_spread<0||p.amount_spread>1||p.cost_spread<0||p.cost_spread>.8||!Number.isInteger(p.delay_jitter)||p.delay_jitter<0||p.delay_jitter>6)throw Error('Параметри невизначеності поза межами.');
    if(count*p.draws>100000000)throw Error('Понад 100 млн пар «договір × симуляція». Зменшіть кількість симуляцій.');
    return Object.fromEntries(Object.keys(DEFAULTS).map(k=>[k,p[k]]));
  }
  function random(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=Math.imul(a^(a>>>15),1|a);t^=t+Math.imul(t^(t>>>7),61|t);return((t^(t>>>14))>>>0)/4294967296;};}
  function normalGenerator(rng){let spare=null;return()=>{if(spare!==null){const z=spare;spare=null;return z;}const r=Math.sqrt(-2*Math.log(Math.max(1e-15,rng()))),t=2*Math.PI*rng();spare=r*Math.sin(t);return r*Math.cos(t);};}
  function cdf(x){const t=1/(1+.2316419*Math.abs(x)),d=.3989422804014327*Math.exp(-x*x/2),tail=d*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return x>=0?1-tail:tail;}
  // Acklam inverse normal approximation. Only probabilities strictly inside (0,1).
  function inverseNormal(p){
    const a=[-39.69683028665376,220.9460984245205,-275.9285104469687,138.357751867269,-30.66479806614716,2.506628277459239],b=[-54.47609879822406,161.5858368580409,-155.6989798598866,66.80131188771972,-13.28068155288572],c=[-.007784894002430293,-.3223964580411365,-2.400758277161838,-2.549732539343734,4.374664141464968,2.938163982698783],d=[.007784695709041462,.3224671290700398,2.445134137142996,3.754408661907416];
    if(p<=0)return-Infinity;if(p>=1)return Infinity;
    if(p<.02425||p>1-.02425){const q=Math.sqrt(-2*Math.log(p<.02425?p:1-p)),v=(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);return p<.02425?v:-v;}
    const q=p-.5,r=q*q;return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  function quantile(sorted,p){const x=(sorted.length-1)*p,i=Math.floor(x);return sorted[i]+(sorted[Math.min(i+1,sorted.length-1)]-sorted[i])*(x-i);}
  function stats(values){if(!values.length)return null;const s=Array.from(values).sort((a,b)=>a-b);return {mean:sum(s)/s.length,p05:quantile(s,.05),p10:quantile(s,.10),p50:quantile(s,.5),p90:quantile(s,.9),p95:quantile(s,.95),min:s[0],max:s.at(-1)};}
  function probability(hits,n){const p=hits/n,z=1.959963984540054,den=1+z*z/n,center=(p+z*z/(2*n))/den,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;return {value:p,hits,n,ci95:[Math.max(0,center-half),Math.min(1,center+half)]};}
  function histogram(values,bins=28,integer=false){let lo=Math.min(...values),hi=Math.max(...values);if(lo===hi){lo-=integer?.5:Math.max(1,Math.abs(lo)*.01);hi+=integer?.5:Math.max(1,Math.abs(hi)*.01);}let step=(hi-lo)/bins;if(integer){step=Math.max(1,Math.ceil(step));lo=Math.floor(lo)-.5;bins=Math.ceil((hi-lo)/step);}const counts=Array(bins).fill(0);values.forEach(v=>counts[Math.min(bins-1,Math.max(0,Math.floor((v-lo)/step)))]++);const negative=Array(bins).fill(0);values.forEach(v=>{if(v<0)negative[Math.min(bins-1,Math.max(0,Math.floor((v-lo)/step)))]++;});return counts.map((count,i)=>({from:lo+i*step,to:lo+(i+1)*step,count,negative_count:negative[i]}));}
  function run(rows,options={},input={},progress=()=>{}){
    const NPL=root.NPL||(typeof require!=='undefined'?require('./engine.js'):null);if(!NPL)throw Error('Фінансовий движок не завантажено.');
    const base=NPL.evaluate(rows,options);if([base.face,base.gross_total,base.cost_total,base.npv,base.funding_peak].some(v=>!Number.isFinite(v)))throw Error('Числове переповнення оцінки. Перевірте масштаб сум у реєстрі та витрати.');const o=base.options,p=validate(input,rows.length),keys=Object.keys(NPL.SEGMENTS),active=[];let groups=0;const groupMap=new Map();
    rows.forEach((row,i)=>{const r=base.records[i];if(row.quality!=='ready'||r.probability===0||r.conditional<=0)return;const bid=String(row.borrower_id);if(!groupMap.has(bid))groupMap.set(bid,groups++);const cap=row.principal+row.interest+row.penalty-row.excluded_amount;active.push({group:groupMap.get(bid),seg:keys.indexOf(row.segment),p:r.probability,threshold:inverseNormal(r.probability),amount:r.conditional,weights:r.custom_weights?r.weights:null,width:p.amount_spread*Math.max(0,Math.min(r.conditional,cap-r.conditional))});});
    const delays=[...new Set(Array.from({length:2*p.delay_jitter+1},(_,i)=>Math.max(0,Math.min(24,o.delay+i-p.delay_jitter))))],variants=new Map();let horizon=base.gross.length;
    for(const delay of delays){const r=delay===o.delay?base:NPL.evaluate(rows,{...o,delay});horizon=Math.max(horizon,r.gross.length);variants.set(delay,r);}
    const months=base.collection_months||36,weights=keys.map(k=>{const w=Array.from({length:months},(_,i)=>(i+1)*Math.exp(-i/NPL.SEGMENTS[k].scale)),total=sum(w);return w.map(v=>v/total);});
    const schedules=new Map([...variants].map(([delay,r])=>[delay,Array.from({length:horizon},(_,i)=>Math.max(0,(r.costs[i]||0)-(r.categories.commission[i]||0)))]));
    const discount=Array.from({length:horizon},(_,i)=>Math.pow(1+o.annual_return,-(i+1)/12)),initial=o.price+o.startup,rng=random(p.seed),normal=normalGenerator(rng);
    const common=Math.sqrt(p.common_rho),borrower=Math.sqrt((1-p.common_rho)*p.borrower_share),residual=Math.sqrt((1-p.common_rho)*(1-p.borrower_share));
    const samples=[],curves=Array.from({length:horizon+1},()=>[]),paybacks=[];let lossN=0,negativeN=0;
    const identities=Float64Array.from({length:groups},()=>0);
    for(let draw=0;draw<p.draws;draw++){
      const z=normal(),bad=cdf(z),costFactor=1+p.cost_spread*(2*bad-1),offset=Math.min(2*p.delay_jitter,Math.floor(bad*(2*p.delay_jitter+1)))-p.delay_jitter,delay=Math.max(0,Math.min(24,o.delay+offset));
      if(borrower>0)for(let g=0;g<groups;g++)identities[g]=normal();
      const amounts=[0,0,0,0],gross=Array(horizon).fill(0);let payers=0;
      for(const r of active){const paid=r.p===1||common*z+borrower*identities[r.group]+(residual>0?residual*normal():0)<=r.threshold;if(paid){payers++;const amount=r.amount+(r.width? r.width*(2*rng()-1):0);if(r.weights)r.weights.forEach((w,t)=>gross[t+delay]+=amount*w);else amounts[r.seg]+=amount;}}
      for(let k=0;k<keys.length;k++)if(amounts[k])for(let t=0;t<months;t++)gross[t+delay]+=amounts[k]*weights[k][t];
      const fixed=schedules.get(delay),net=Array(horizon),balance=[-initial];let npv=-initial,grossTotal=0,costTotal=o.startup,minBalance=-initial;
      for(let t=0;t<horizon;t++){const cost=(fixed[t]+gross[t]*o.cost_rate*o.expense_multiplier)*costFactor;net[t]=gross[t]-cost;grossTotal+=gross[t];costTotal+=cost;npv+=net[t]*discount[t];balance.push(balance.at(-1)+net[t]);minBalance=Math.min(minBalance,balance.at(-1));}
      const suffix=[...balance];for(let t=horizon-1;t>=0;t--)suffix[t]=Math.min(suffix[t],suffix[t+1]);let payback=null;
      for(let t=0;t<horizon;t++)if(net[t]>0&&balance[t]<0&&balance[t+1]>=-1e-8&&suffix[t+1]>=-1e-8){payback=t+(-balance[t])/net[t];break;}
      const profit=balance.at(-1);if(profit < -1e-7)lossN++;if(npv < -1e-7)negativeN++;if(payback!==null)paybacks.push(payback);
      samples.push({draw:draw+1,npv,profit,gross:grossTotal,cost_total:costTotal,payers,funding_peak:-minBalance,payback,delay,cost_factor:costFactor});balance.forEach((v,t)=>curves[t].push(v));
      if((draw+1)%100===0||draw===p.draws-1)progress((draw+1)/p.draws);
    }
    const metrics=Object.fromEntries(['npv','profit','gross','cost_total','payers','funding_peak'].map(k=>[k,stats(samples.map(s=>s[k]))])),sortedNPV=samples.map(s=>s.npv).sort((a,b)=>a-b);
    return {engine:VERSION,params:p,options:structuredClone(o),count:rows.length,ready_count:base.ready_count,review_count:rows.length-base.ready_count,borrowers:new Set(rows.map(r=>String(r.borrower_id))).size,modeled_contracts:active.length,horizon,initial,base:{npv:base.npv,gross:base.gross_total,payers:base.payers,cost_total:base.cost_total,funding_peak:base.funding_peak,payback:base.payback},metrics,probabilities:{negative_npv:probability(negativeN,p.draws),capital_loss:probability(lossN,p.draws),payback:probability(paybacks.length,p.draws)},payback_conditional:stats(paybacks),npv_tail05:sum(sortedNPV.slice(0,Math.max(1,Math.ceil(.05*p.draws))))/Math.max(1,Math.ceil(.05*p.draws)),curves:curves.map((values,month)=>({month,...stats(values)})),histograms:{npv:histogram(samples.map(s=>s.npv)),payers:histogram(samples.map(s=>s.payers),28,true)},samples};
  }
  function csv(r){const keys=['draw','npv','profit','gross','cost_total','payers','funding_peak','payback','delay','cost_factor'],meta=['engine','seed','draws','discount_annual','price','startup','common_rho','borrower_share','amount_spread','cost_spread','delay_jitter'],values=[r.engine,r.params.seed,r.params.draws,r.options.annual_return,r.options.price,r.options.startup,r.params.common_rho,r.params.borrower_share,r.params.amount_spread,r.params.cost_spread,r.params.delay_jitter];return '\uFEFF'+[[...keys,...meta].join(','),...r.samples.map(s=>[...keys.map(k=>s[k]===null?'':String(s[k])),...values].join(','))].join('\r\n');}
  const api={VERSION,DEFAULTS,validate,run,csv,stats,cdf,inverseNormal};root.MC=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof require!=='undefined'&&require.main===module){try{const fs=require('node:fs'),[file,paramsFile]=process.argv.slice(2);if(!file)throw Error('node dist/monte-carlo.js input.json [params.json]');const data=JSON.parse(fs.readFileSync(file,'utf8')),params=paramsFile?JSON.parse(fs.readFileSync(paramsFile,'utf8')):data.params||{};process.stdout.write(JSON.stringify(run(data.rows||data.loans,data.options||data.meta?.defaults||{},params)));}catch(err){process.stderr.write(err.message+'\n');process.exitCode=1;}}
})(typeof globalThis!=='undefined'?globalThis:this);
