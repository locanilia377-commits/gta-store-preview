(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GTAModel=api;})(typeof window!=='undefined'?window:globalThis,function(){'use strict';
// Local simulation only. Commercial scenarios are alternatives, never stacked.
const RULES=Object.freeze({seed:1200,spendRate:.20,earnPer100:5,referral:300,referralThreshold:3000,volumeThreshold:50000,volumeRate:.10,referralRate:.20,stacking:false});
const SCENARIOS=Object.freeze(['loyalty','volume','referral','none']);
const PRODUCTION_STAGES=Object.freeze(['approved','production','quality_check','ready','completed']);
const STATUSES=Object.freeze(['created','proof_review','changes_requested',...PRODUCTION_STAGES,'refunded']);
const initial=()=>({version:6,pricingScenario:'volume',cart:[],orders:[],favorites:[],member:false,points:RULES.seed,bonusDebt:0,pending:0,referralDone:false,ledger:[],creator:{customer:false,orders:[],policy:'first'}});
const integer=(n,lo,hi)=>Math.min(hi,Math.max(lo,Math.floor(Number(n)||0)));
const cents=n=>Math.round((Number(n)||0)*100);
const money=n=>n/100;
const scenarioName=s=>SCENARIOS.includes(s)?s:'none';
const clone=x=>JSON.parse(JSON.stringify(x));
function modelError(code,message){const e=new Error(message);e.code=code;throw e;}
function nonnegativeCents(n){const v=cents(n);if(!Number.isSafeInteger(v)||v<0)modelError('INVALID_MONEY','Amount must be nonnegative and representable in kopecks.');return v;}
function sanitize(raw,products){const s=initial();if(!raw||![5,6].includes(raw.version))return s;const map=new Map(products.map(p=>[p.id,p]));s.pricingScenario=SCENARIOS.includes(raw.pricingScenario)?raw.pricingScenario:'volume';s.member=raw.member===true;s.points=integer(raw.points,0,1000000);s.bonusDebt=integer(raw.bonusDebt,0,1000000);s.pending=integer(raw.pending,0,1000000);s.referralDone=raw.referralDone===true;
if(raw.creator&&Array.isArray(raw.creator.orders)){s.creator={customer:raw.creator.customer===true,policy:raw.creator.policy==='always'?'always':'first',orders:raw.creator.orders.filter(o=>o&&['first','repeat'].includes(o.type)&&Number.isFinite(o.paid)&&o.paid>=0&&Number.isFinite(o.reward)&&o.reward>=0&&typeof o.id==='string').slice(0,100).map(o=>({...o,refunded:o.refunded===true}))};}
s.favorites=Array.isArray(raw.favorites)?[...new Set(raw.favorites.filter(x=>map.has(x)))]:[];
s.cart=Array.isArray(raw.cart)?raw.cart.filter(x=>x&&map.has(x.id)).map(x=>{const p=map.get(x.id);return {id:x.id,v:integer(x.v,0,p.variants.length-1),color:p.colors.includes(x.color)?x.color:p.colors[0],qty:integer(x.qty,1,99)}}):[];
s.orders=Array.isArray(raw.orders)?raw.orders.filter(o=>o&&/^DEMO-\d+-\d+$/.test(o.id)&&Array.isArray(o.items)&&o.items.length&&o.items.every(x=>x&&typeof x.name==='string'&&typeof x.variant==='string'&&typeof x.color==='string'&&Number.isFinite(x.unit)&&x.unit>=0&&Number.isFinite(x.qty)&&x.qty>=1&&x.qty<=99)&&Number.isFinite(o.total)&&o.total>=0&&Number.isFinite(o.subtotal)&&o.subtotal>=0&&Number.isFinite(o.date)&&o.date>0&&Number.isFinite(o.spent)&&o.spent>=0&&Number.isFinite(o.earned)&&o.earned>=0).slice(0,100).map(o=>normalizeOrder({...o,spent:integer(o.spent,0,1000000),earned:integer(o.earned,0,1000000),done:o.done===true,delivery:o.delivery==='delivery'?'delivery':'pickup',items:o.items.map(x=>({...x,qty:integer(x.qty,1,99)}))})):[];
s.pending=s.orders.filter(o=>!o.done&&!o.refunded).reduce((sum,o)=>sum+o.earned,0);s.ledger=Array.isArray(raw.ledger)?raw.ledger.filter(x=>x&&typeof x.label==='string'&&Number.isFinite(x.amount)).slice(0,200):[];return s;}
const key=x=>`${x.id}|${x.v}|${x.color}`;
function add(state,line){const same=state.cart.find(x=>key(x)===key(line));if(same)same.qty=integer(same.qty+line.qty,1,99);else state.cart.push({...line,qty:integer(line.qty,1,99)});}
function totals(state,products,usePoints=false,scenario='loyalty'){
scenario=scenarioName(scenario);const map=new Map(products.map(p=>[p.id,p]));let count=0;
const subtotalCents=state.cart.reduce((sum,x)=>{const p=map.get(x.id);if(!p||!p.variants[x.v])return sum;const qty=integer(x.qty,1,99);count+=qty;return sum+(nonnegativeCents(p.price)+cents(p.variants[x.v][1]))*qty},0);
const thresholdCents=cents(RULES.volumeThreshold),eligible=subtotalCents>=thresholdCents;
const discountRate=scenario==='referral'?RULES.referralRate:scenario==='volume'&&eligible?RULES.volumeRate:0;
const commercialDiscountCents=Number((BigInt(subtotalCents)*BigInt(Math.round(discountRate*100))+50n)/100n);
const loyalty=scenario==='loyalty',maxSpend=loyalty?Math.min(integer(state.points,0,1000000),Math.floor(subtotalCents/500)):0;
const spent=usePoints&&state.member&&loyalty?maxSpend:0,totalCents=subtotalCents-commercialDiscountCents-spent*100;
return {subtotal:money(subtotalCents),maxSpend,spent,total:money(totalCents),earned:state.member&&loyalty?Math.floor(totalCents/10000)*RULES.earnPer100:0,count,thresholdNeeded:money(Math.max(0,thresholdCents-subtotalCents)),eligible,commercialDiscount:money(commercialDiscountCents),discountRate,scenario,stacking:false,pointsAllowed:loyalty,pointsSuppressed:!!usePoints&&!loyalty,subtotalCents,commercialDiscountCents,totalCents};}
// Allocate integer units using largest remainders. Stable ties follow line order.
function allocate(amount,weights){if(!Number.isSafeInteger(amount)||amount<0)modelError('INVALID_ALLOCATION','Allocation must use nonnegative integer units.');const sum=weights.reduce((a,b)=>a+b,0);if(!Number.isSafeInteger(sum)||weights.some(w=>!Number.isSafeInteger(w)||w<0))modelError('INVALID_ALLOCATION','Allocation weights must be nonnegative integer units.');if(!sum){if(amount)modelError('INVALID_ALLOCATION','A positive amount cannot be allocated to an empty base.');return weights.map(()=>0);}const denominator=BigInt(sum),rows=weights.map((weight,index)=>{const numerator=BigInt(amount)*BigInt(weight);return {index,value:Number(numerator/denominator),remainder:numerator%denominator}});let left=amount-rows.reduce((a,r)=>a+r.value,0);const ranking=rows.slice().sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1);for(let i=0;i<left;i++)ranking[i].value++;return rows.map(r=>r.value);}
function capturePricing(items,t){
if(!Array.isArray(items)||!items.length)modelError('INVALID_ITEMS','A pricing snapshot needs order lines.');
const lines=items.map(x=>{const qty=Number(x.qty);if(!Number.isInteger(qty)||qty<1||qty>99)modelError('INVALID_QUANTITY','Order quantity must be an integer from 1 to 99.');const unitCents=nonnegativeCents(x.unit);return {qty,unitCents,subtotalCents:unitCents*qty}});
const weights=lines.map(x=>x.subtotalCents),subtotalCents=weights.reduce((a,b)=>a+b,0),totalCents=nonnegativeCents(t.total),spentCents=nonnegativeCents(t.spent||0),earned=integer(t.earned,0,1000000);
const commercialDiscountCents=t.commercialDiscount===undefined?Math.max(0,subtotalCents-totalCents-spentCents):nonnegativeCents(t.commercialDiscount);
if(subtotalCents!==nonnegativeCents(t.subtotal)||subtotalCents-commercialDiscountCents-spentCents!==totalCents||commercialDiscountCents>subtotalCents||spentCents>subtotalCents-commercialDiscountCents)modelError('INCONSISTENT_PRICING','Original amounts must balance exactly before capture.');
const discounts=allocate(commercialDiscountCents,weights),afterDiscount=weights.map((w,i)=>w-discounts[i]),spent=allocate(spentCents,afterDiscount),paid=afterDiscount.map((w,i)=>w-spent[i]),earnings=allocate(earned,paid);
const scenario=scenarioName(t.scenario===undefined?'loyalty':t.scenario);
return {version:1,currency:'RUB',scenario,discountRate:Number(t.discountRate)||0,stacking:false,subtotal:money(subtotalCents),commercialDiscount:money(commercialDiscountCents),spent:money(spentCents),total:money(totalCents),earned,subtotalCents,commercialDiscountCents,spentCents,totalCents,lines:lines.map((l,i)=>({...l,commercialDiscountCents:discounts[i],spentCents:spent[i],paidCents:paid[i],earned:earnings[i]}))};}
function pricingFor(order){
const p=order.pricing;
if(p&&p.version===1&&Array.isArray(p.lines)&&p.lines.length===order.items.length){
const fields=['subtotalCents','commercialDiscountCents','spentCents','paidCents','earned'];
const valid=p.lines.every((l,i)=>l&&Number.isInteger(l.qty)&&l.qty===order.items[i].qty&&Number.isSafeInteger(l.unitCents)&&l.unitCents>=0&&fields.every(k=>Number.isSafeInteger(l[k])&&l[k]>=0)&&l.subtotalCents===l.unitCents*l.qty&&l.subtotalCents-l.commercialDiscountCents-l.spentCents===l.paidCents);
const sum=k=>p.lines.reduce((n,l)=>n+l[k],0);
if(valid&&sum('subtotalCents')===nonnegativeCents(order.subtotal)&&sum('paidCents')===nonnegativeCents(order.total)&&sum('spentCents')===nonnegativeCents(order.spent||0)&&sum('earned')===integer(order.earned,0,1000000))return clone(p);
}
return capturePricing(order.items,order);
}
// alreadyReturned makes repeated partial refunds consume exact rounding remainders.
// Never query current catalog prices, current basket thresholds, or current points.
function refundableLine(order,index,qty,alreadyReturned=0){
if(!Number.isInteger(index)||index<0||index>=order.items.length)modelError('INVALID_LINE','Unknown original order line.');
const p=pricingFor(order),line=p.lines[index],count=qty===undefined?line.qty:Number(qty),offset=Number(alreadyReturned);
if(!Number.isInteger(count)||count<1||!Number.isInteger(offset)||offset<0||offset+count>line.qty)modelError('INVALID_REFUND_QUANTITY','Refund quantity exceeds the unreturned original line.');
const units=Array(line.qty).fill(line.unitCents),discounts=allocate(line.commercialDiscountCents,units),afterDiscount=units.map((n,i)=>n-discounts[i]),spentUnits=allocate(line.spentCents,afterDiscount),paidUnits=afterDiscount.map((n,i)=>n-spentUnits[i]),earnedUnits=allocate(line.earned,paidUnits);
const portion=values=>values.slice(offset,offset+count).reduce((a,b)=>a+b,0);
const subtotalCents=line.unitCents*count,commercialDiscountCents=portion(discounts),spentCents=portion(spentUnits),paidCents=portion(paidUnits),earned=portion(earnedUnits);
return {line:index,qty:count,alreadyReturned:offset,scenario:p.scenario,currency:'RUB',subtotal:money(subtotalCents),commercialDiscount:money(commercialDiscountCents),spent:money(spentCents),bonus:money(spentCents),paid:money(paidCents),total:money(paidCents),earned,subtotalCents,commercialDiscountCents,spentCents,paidCents,originalDiscountRate:p.discountRate};}
function normalizeOrder(order){
const o=clone(order),old=o.lifecycle&&typeof o.lifecycle==='object'?o.lifecycle:null;
const proofVersion=old?integer(old.proofVersion,0,1000000):0;
const proofs=old&&Array.isArray(old.proofs)?old.proofs.filter(p=>p&&Number.isInteger(p.version)&&p.version>0&&p.version<=proofVersion).slice(-100).map(p=>({version:p.version,status:['draft','review','approved','superseded'].includes(p.status)?p.status:'draft',note:typeof p.note==='string'?p.note.slice(0,2000):'',at:Number.isFinite(p.at)?p.at:Number.isFinite(p.submittedAt)?p.submittedAt:null,submittedAt:Number.isFinite(p.submittedAt)?p.submittedAt:Number.isFinite(p.at)?p.at:null,approvedAt:Number.isFinite(p.approvedAt)?p.approvedAt:null})):[];
let approvedVersion=old&&old.approvedVersion===proofVersion&&proofVersion>0&&proofs.some(p=>p.version===proofVersion&&p.status==='approved')?proofVersion:null;
const refunded=o.refunded===true||old&&old.status==='refunded';
let status=refunded?'refunded':old&&STATUSES.includes(old.status)?old.status:o.done===true?'completed':'created';
if(PRODUCTION_STAGES.includes(status)&&status!=='completed'&&approvedVersion===null)status=proofVersion?'proof_review':'created';
if(['created','proof_review','changes_requested','refunded'].includes(status))approvedVersion=null;
if(status==='created'&&proofVersion>0)status='proof_review';
if(['proof_review','changes_requested'].includes(status)&&!proofVersion)status='created';
const comments=old&&Array.isArray(old.comments)?old.comments.filter(c=>c&&typeof c.text==='string'&&Number.isInteger(c.version)&&c.version>=1&&c.version<=proofVersion).slice(-100).map(c=>({...c,text:c.text.slice(0,2000)})):[];
const history=old&&Array.isArray(old.history)?old.history.filter(h=>h&&typeof h.type==='string'&&Number.isFinite(h.at)).slice(-200).map(h=>({...h,simulation:true})):[];
o.lifecycle={simulation:true,status,proofVersion,approvedVersion,proofs,comments,history};o.refunded=!!refunded;o.done=status==='completed'||status==='refunded'&&o.done===true;
if(Array.isArray(o.items)&&o.items.length){try{o.pricing=pricingFor(o);}catch(e){delete o.pricing;o.pricingUnavailable=true;}}
return o;
}
const atTime=(o,options)=>Number.isFinite(options&&options.at)?options.at:Number.isFinite(o.date)?o.date:0;
function editable(order){const o=normalizeOrder(order);if(o.refunded)modelError('ORDER_REFUNDED','Refunded demo orders cannot progress.');if(['production','quality_check','ready','completed'].includes(o.lifecycle.status))modelError('PROOF_LOCKED','A proof cannot change after simulated production begins.');return o;}
function event(o,type,at,extra={}){o.lifecycle.history.push({type,at,version:o.lifecycle.proofVersion,status:o.lifecycle.status,simulation:true,...extra});o.lifecycle.history=o.lifecycle.history.slice(-200);return o;}
function submitProof(order,options={}){const o=editable(order),l=o.lifecycle,at=atTime(o,options),continuing=l.status==='changes_requested'&&l.proofVersion>0;
if(!continuing)l.proofVersion++;
l.approvedVersion=null;l.status='proof_review';l.proofs=l.proofs.filter(p=>p.version!==l.proofVersion).map(p=>({...p,status:'superseded'}));l.proofs.push({version:l.proofVersion,status:'review',note:typeof options.note==='string'?options.note.slice(0,2000):'',at,submittedAt:at,approvedAt:null});return event(o,'proof_submitted',at);}
function requireVersion(o,version){if(!Number.isInteger(version)||version!==o.lifecycle.proofVersion||version<1)modelError('STALE_PROOF','Approval and changes must name the exact current proof version.');}
function approveProof(order,version,options={}){const o=editable(order),l=o.lifecycle;requireVersion(o,version);if(l.status!=='proof_review')modelError('PROOF_NOT_REVIEWABLE','The current proof must be submitted for review before approval.');const proof=l.proofs.find(p=>p.version===version&&p.status==='review');if(!proof)modelError('PROOF_NOT_REVIEWABLE','The exact current proof has not been submitted.');const at=atTime(o,options);proof.status='approved';proof.approvedAt=at;l.approvedVersion=version;l.status='approved';return event(o,'proof_approved',at);}
function requestChanges(order,version,comment,options={}){const o=editable(order),l=o.lifecycle;requireVersion(o,version);if(!['proof_review','approved','changes_requested'].includes(l.status))modelError('PROOF_NOT_REVIEWABLE','There is no current proof to comment on.');if(typeof comment!=='string'||!comment.trim())modelError('COMMENT_REQUIRED','Describe the requested proof change.');const at=atTime(o,options);l.proofs=l.proofs.map(p=>({...p,status:'superseded'}));l.proofVersion++;l.approvedVersion=null;l.status='changes_requested';l.proofs.push({version:l.proofVersion,status:'draft',note:'',at,submittedAt:null,approvedAt:null});l.comments.push({version:l.proofVersion,forVersion:version,text:comment.trim().slice(0,2000),at});return event(o,'changes_requested',at,{previousVersion:version});}
const commentProof=(order,version,comment,options={})=>requestChanges(order,version,comment,options);
function canAdvanceProduction(order){const o=normalizeOrder(order),l=o.lifecycle;return !o.refunded&&l.approvedVersion===l.proofVersion&&l.proofVersion>0&&PRODUCTION_STAGES.indexOf(l.status)>=0&&PRODUCTION_STAGES.indexOf(l.status)<PRODUCTION_STAGES.length-1;}
function advanceProduction(order,options={}){const o=normalizeOrder(order),l=o.lifecycle;if(o.refunded)modelError('ORDER_REFUNDED','Refunded demo orders cannot progress.');if(l.status==='completed')modelError('ORDER_COMPLETED','The simulated order is already completed.');if(!canAdvanceProduction(o))modelError('APPROVAL_REQUIRED','The exact current proof version must be approved before simulated production.');l.status=PRODUCTION_STAGES[PRODUCTION_STAGES.indexOf(l.status)+1];o.done=l.status==='completed';return event(o,'production_advanced',atTime(o,options));}
function refundOrder(order,options={}){const o=normalizeOrder(order);if(o.refunded)modelError('ORDER_REFUNDED','This demo order was already refunded.');const at=atTime(o,options);o.refunded=true;o.lifecycle.status='refunded';o.lifecycle.approvedVersion=null;o.refund={simulation:true,status:'refunded',at,total:o.total,spent:o.spent,earned:o.earned};return event(o,'order_refunded',at);}
function ambassador(input){const bounded=(v,max)=>Math.min(max,Math.max(0,Number(String(v).replace(',','.'))||0));const followers=Math.floor(bounded(input.followers,1000000)),average=bounded(input.average,100000),conversion=bounded(input.conversion,100),reach=bounded(input.reach,100),click=bounded(input.click,100),purchase=bounded(input.purchase,100);const reached=input.mode==='funnel'?Math.floor(followers*reach/100):followers;const clicked=input.mode==='funnel'?Math.floor(reached*click/100):followers;const buyers=Math.floor(input.mode==='funnel'?clicked*purchase/100:followers*conversion/100);const enteredCents=Math.round(average*100),paidCents=input.base==='paid'?enteredCents:Math.round(enteredCents*.8),listCents=input.base==='paid'?Math.round(enteredCents/.8):enteredCents,commissionCents=Math.round(paidCents*.2);const repeats=integer(input.repeats,0,100),period=integer(input.period||12,1,120),repeatOrders=buyers*repeats,repeatPaidCents=input.discount==='always'?paidCents:listCents,repeatCommissionCents=Math.round(repeatPaidCents*.1),firstRevenue=paidCents*buyers/100,repeatRevenue=repeatPaidCents*repeatOrders/100,rewardFirst=commissionCents*buyers/100,rewardRepeat=repeatCommissionCents*repeatOrders/100;return {followers,reached,clicked,buyers,list:listCents/100,paid:paidCents/100,commission:commissionCents/100,residual:(paidCents-commissionCents)/100,repeats,period,repeatOrders,repeatPaid:repeatPaidCents/100,repeatCommission:repeatCommissionCents/100,firstRevenue,repeatRevenue,rewardFirst,rewardRepeat,revenue:firstRevenue+repeatRevenue,reward:rewardFirst+rewardRepeat,store:firstRevenue+repeatRevenue-rewardFirst-rewardRepeat,discount:(listCents-paidCents)*buyers/100+(listCents-repeatPaidCents)*repeatOrders/100};}
return {RULES,SCENARIOS,PRODUCTION_STAGES,initial,sanitize,integer,key,add,totals,capturePricing,refundableLine,normalizeOrder,submitProof,approveProof,requestChanges,commentProof,canAdvanceProduction,advanceProduction,refundOrder,ambassador};});
