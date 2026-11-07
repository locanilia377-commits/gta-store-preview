/* Deterministic geometry: only scroll position determines the state. */
(function(root){
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=v=>{v=clamp(v);return v*v*(3-2*v)};
const phase=(p,a,b)=>smooth((p-a)/(b-a));
function state(p){p=clamp(p);const rack=phase(p,.08,.29),art=phase(p,.34,.53),light=phase(p,.59,.78);return {p,crewOpacity:1-phase(p,.03,.16),crewX:phase(p,.03,.19)*22,rackX:-115+115*rack,rackOpacity:phase(p,.08,.15),rackScale:1-.09*art,rackY:8*art,artY:-125+125*art,artOpacity:phase(p,.34,.39),artScale:1-.07*light,artX:-4*light,lightX:125-125*light,lightOpacity:phase(p,.59,.64),backdropScale:1+p*.06,chapter:p<.18?0:p<.43?1:p<.68?2:3};}
root.GTAScroll={state,clamp};if(typeof module!=='undefined')module.exports=root.GTAScroll;
})(typeof window!=='undefined'?window:globalThis);
