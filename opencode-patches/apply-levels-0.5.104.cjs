const fs=require("fs");
const C="/mnt/d/npm-global/node_modules/9router/app/.next-cli-build/server/chunks";
const F=C+"/8499.js";
const FROM='function p(a,b){return"max"!==a&&"ultra"!==a||b?.includes(a)?a:"ultra"===a&&b?.includes("max")?"max":"xhigh"}';
const TO='function p(a,b){if("max"===a||"ultra"===a)return b?.includes(a)?a:"ultra"===a&&b?.includes("max")?"max":"xhigh";return["none","minimal","low","medium","high","xhigh"].includes(a)?a:"high"}';
let s=fs.readFileSync(F,"utf8");
if(s.includes(TO)){console.log("SKIP already applied");process.exit(0)}
const n=s.split(FROM).length-1;
if(n!==1){console.error("FATAL: anchor found "+n+"x");process.exit(1)}
s=s.replace(FROM,TO);
new Function(s);
const stamp=new Date().toISOString().replace(/[-:T]/g,"").slice(0,14);
fs.copyFileSync(F,F+".bak."+stamp);
fs.writeFileSync(F,s);
console.log("OK   patched normalizeOpenAILevel; backup .bak."+stamp);
