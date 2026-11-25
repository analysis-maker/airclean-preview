const n=["low","normal","urgent"],r=e=>(e==null?void 0:e.tier)==="premium";function i(e,t){return t!=="premium"?e:n[Math.min(n.length-1,n.indexOf(e)+1)]}export{i as e,r as i};
