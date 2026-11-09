'use strict';
importScripts('engine.js?v=0.9','monte-carlo.js?v=0.9');
self.onmessage=e=>{try{const {rows,options,params}=e.data;const result=MC.run(rows,options,params,value=>self.postMessage({type:'progress',value}));self.postMessage({type:'result',result});}catch(err){self.postMessage({type:'error',message:err.message});}};
