"use strict";Object.defineProperties(exports,{__esModule:{value:!0},[Symbol.toStringTag]:{value:"Module"}});const t=require("solid-js/web"),O=require("@opencode/plugin/gui"),M=require("node:fs/promises"),R=require("node:os"),y=require("node:path"),s=require("effect"),u=require("solid-js"),ie=s.Schema.Struct({version:s.Schema.Literal(1),enabled:s.Schema.Boolean,autostart:s.Schema.Boolean,showProject:s.Schema.Boolean,showModel:s.Schema.Boolean,showTokens:s.Schema.Boolean,showCost:s.Schema.Boolean,showElapsed:s.Schema.Boolean,privateMode:s.Schema.Boolean}),re=s.Schema.Struct({version:s.Schema.Literal(1),pid:s.Schema.Number,daemonVersion:s.Schema.String,enabled:s.Schema.Boolean,discordConnected:s.Schema.Boolean,source:s.Schema.String,project:s.Schema.String,model:s.Schema.String,tokens:s.Schema.Number,costUSD:s.Schema.Number,startedAt:s.Schema.optional(s.Schema.String),busy:s.Schema.Boolean,updatedAt:s.Schema.String}),oe=s.Schema.Struct({config:ie,status:s.Schema.optional(re),configPath:s.Schema.String,configError:s.Schema.optional(s.Schema.String)}),U=O.Ipc.define({id:"opencode-discord-status-gui.settings",methods:{get:{output:oe},update:{input:ie,output:oe}}}),B={version:1,enabled:!0,autostart:!0,showProject:!0,showModel:!0,showTokens:!0,showCost:!0,showElapsed:!0,privateMode:!1},Ne=["enabled","autostart","showProject","showModel","showTokens","showCost","showElapsed","privateMode"];function se(e){return e instanceof Error?e.message:String(e)}function Fe(e){const n={...B};if(e.trim()==="")return{config:n};let o;try{o=JSON.parse(e)}catch(l){return{config:n,error:`Invalid JSON: ${se(l)}`}}if(typeof o!="object"||o===null||Array.isArray(o))return{config:n,error:"Config must be a JSON object"};const i=o,d=[];"version"in i&&(i.version===1?n.version=1:d.push("version"));for(const l of Ne){if(!(l in i))continue;const p=i[l];typeof p=="boolean"?n[l]=p:d.push(l)}return d.length>0?{config:n,error:`Invalid config fields: ${d.join(", ")}`}:{config:n}}function ae(){if(process.platform==="win32"){const e=process.env.APPDATA||y.join(R.homedir(),"AppData","Roaming");return y.join(e,"opencode-discord-status")}return process.platform==="darwin"?y.join(R.homedir(),"Library","Application Support","opencode-discord-status"):y.join(process.env.XDG_CONFIG_HOME||y.join(R.homedir(),".config"),"opencode-discord-status")}function q(){return y.join(ae(),"config.json")}function Ae(){return y.join(ae(),"status.json")}async function Be(e){try{return Fe(await M.readFile(e,"utf8"))}catch(n){return n.code==="ENOENT"?{config:{...B}}:{config:{...B},error:se(n)}}}async function Le(e,n){const o=y.dirname(e);await M.mkdir(o,{recursive:!0,mode:448});const i=`${e}.${process.pid}.${Date.now()}.tmp`;try{await M.writeFile(i,`${JSON.stringify(n,null,2)}
`,{mode:384}),await M.rename(i,e)}catch(d){throw await M.rm(i,{force:!0}).catch(()=>{}),d}}async function Ie(e){try{const n=JSON.parse(await M.readFile(e,"utf8"));return s.Schema.decodeUnknownSync(re)(n)}catch{return}}const ze=e=>{let n;const o=async()=>{const i=q(),{config:d,error:l}=await Be(i);l?l!==n&&(e.log.write("warn","opencode-discord-status config problem",{error:l}),n=l):n=void 0;const p=await Ie(Ae());return{config:d,status:p,configPath:i,...l?{configError:l}:{}}};e.provide(U,{get:o,update:async i=>{try{await Le(q(),i)}catch(d){throw e.log.write("error","opencode-discord-status config write failed",{error:String(d)}),d}return o()}})},Re=1e4,Ue=45*6e4;function de(e){if(e>=1e6)return`${(e/1e6).toFixed(1)}M`;if(e>=1e3){const n=e/1e3;return n>=999.95?"1.0M":`${n.toFixed(1)}K`}return String(e)}function le(e){if(!Number.isFinite(e)||e<=0)return"$0.00";if(e>=1)return`$${e.toFixed(2)}`;let n=e.toFixed(4).replace(/0+$/,"");if(n.endsWith("."))n+="00";else{const o=n.length-n.indexOf(".")-1;o<2&&(n+="0".repeat(2-o))}return`$${n}`}function qe(e,n){const o=e?Date.parse(e):Number.NaN;if(!Number.isFinite(o))return"00:00:00";const i=Math.max(0,Math.floor((n-o)/1e3)),d=Math.floor(i/3600),l=Math.floor(i%3600/60),p=i%60;return[d,l,p].map(g=>String(g).padStart(2,"0")).join(":")}function Je(e,n){return e.busy?n.privateMode||!n.showProject?"Working on: a session":e.project!==""?`Working on: ${e.project}`:"Working on: OpenCode":"Idle"}function Ve(e,n){const o=[];return e.busy?n.showModel&&o.push(e.model!==""?e.model:"OpenCode"):n.showProject&&!n.privateMode&&e.project!==""&&o.push(e.project),n.showTokens&&o.push(`${de(e.tokens)} tokens`),n.showCost&&o.push(le(e.costUSD)),o.length>0?o.join(" | "):"OpenCode"}function ce(e,n){if(!e)return!0;const o=Date.parse(e.updatedAt);return Number.isFinite(o)?n-o>Re:!0}function We(e,n,o){const i=n!==void 0&&!ce(n,o),d=i?{project:n.project,model:n.model,tokens:n.tokens,costUSD:n.costUSD,startedAt:n.startedAt,busy:n.busy}:{project:"my-project",model:"DeepSeek V4.1 Flash",tokens:12300,costUSD:.0421,startedAt:new Date(o-Ue).toISOString(),busy:!0},l=e.showElapsed&&d.busy?qe(d.startedAt,o):void 0;return{details:Je(d,e),state:Ve(d,e),...l!==void 0?{elapsed:l}:{},sample:!i}}var Ge=t.template("<div class=ods-row><div class=ods-row-copy><span class=ods-row-title></span><span class=ods-row-desc>"),He=t.template("<span class=ods-muted>Saving…"),Ke=t.template('<div class=settings-tab-header><div class=settings-tab-header-row><div class="flex flex-col gap-1"><h2 class=settings-tab-title>Discord Presence</h2><span class="text-11-regular text-v2-text-text-muted">Choose what your OpenCode session shows on Discord.</span></div><div class=settings-tab-header-actions>'),Xe=t.template("<div class=ods-notice><span>"),Qe=t.template("<div class=ods-grid><div><div class=ods-meta-label>Project</div><div class=ods-meta-value></div></div><div><div class=ods-meta-label>Model</div><div class=ods-meta-value></div></div><div><div class=ods-meta-label>Tokens</div><div class=ods-meta-value></div></div><div><div class=ods-meta-label>Cost</div><div class=ods-meta-value></div></div><div><div class=ods-meta-label>Source</div><div class=ods-meta-value></div></div><div><div class=ods-meta-label>Last update</div><div class=ods-meta-value></div></div><div><div class=ods-meta-label>Daemon</div><div class=ods-meta-value></div></div><div><div class=ods-meta-label>Session</div><div class=ods-meta-value>"),Ye=t.template("<div class=ods-notice><span>Autostart is off. The daemon will not start with OpenCode; turn this on here to start it now."),Ze=t.template('<span class="ods-badge ods-badge--off">Presence is off'),et=t.template('<div class="settings-tab-body settings-tab-body--sectioned"><div class=ods-stack><div class=ods-card><div class=ods-status><span></span><div style=flex:1;min-width:0><div class=ods-card-title></div><div class=ods-muted></div></div></div></div><div class=ods-card></div><div class=ods-card><div class=ods-card-head><div><div class=ods-card-title>Presence details</div><div class=ods-muted>Choose which fields appear on Discord.</div></div></div></div><div class=ods-card><div class=ods-card-head><div><div class=ods-card-title>Live preview</div><div class=ods-muted></div></div></div><div><div class=ods-preview-line></div><div class="ods-preview-line ods-preview-line--state"></div><div></div></div></div><div class=ods-footer><span class=ods-path></span></div><div class=ods-muted>Changes apply live to a running daemon. No restart needed.'),tt=t.template('<div class="ods-notice ods-notice--error"><span>'),nt=t.template("<div class=ods-notice><span>Config file needs attention: <!>. Toggle any setting to rewrite it with valid values.");function ot(e,n){if(!e)return"—";const o=Date.parse(e);if(!Number.isFinite(o))return"unknown";const i=Math.max(0,n-o);return i<1e3?"just now":i<6e4?`${Math.floor(i/1e3)}s ago`:i<36e5?`${Math.floor(i/6e4)}m ago`:`${Math.floor(i/36e5)}h ago`}function $(e){return(()=>{var n=Ge(),o=n.firstChild,i=o.firstChild,d=i.nextSibling;return t.insert(i,()=>e.title),t.insert(d,()=>e.description),t.insert(n,t.createComponent(e.ui.Switch,{get label(){return e.title},hideLabel:!0,get checked(){return e.checked},get disabled(){return e.disabled},get onChange(){return e.onChange}}),null),n})()}function it(e){const n=e.ctx.ui,[o,i]=u.createSignal(Date.now()),[d,l]=u.createSignal(!1);let p;u.onMount(()=>{const v=setInterval(()=>i(Date.now()),1e3);u.onCleanup(()=>clearInterval(v))}),u.onCleanup(()=>{p!==void 0&&clearTimeout(p)});const g=()=>e.state.snapshot(),c=()=>g()?.config??B,a=()=>g()?.status,N=()=>ce(a(),o()),b=()=>a()!==void 0&&!N(),D=u.createMemo(()=>We(c(),a(),o())),m=()=>g()===void 0||e.state.saving(),f=()=>g()?.configPath??q(),w=()=>b()&&c().enabled&&a()?.discordConnected===!0,P=()=>b()?w()?"ods-dot--on":"ods-dot--warn":"",F=()=>b()?c().enabled?a()?.discordConnected?"Discord connected":"Discord unavailable":"Presence disabled":a()?"Daemon not reporting":"Daemon not running",T=()=>b()?c().enabled?a()?.discordConnected?a()?.busy?"Showing the busy session.":"Showing the idle card.":"The daemon is retrying the Discord connection.":"The daemon is running and Discord activity has been cleared.":a()?"The status file is stale. Settings stay editable.":"Settings stay editable; changes apply when the daemon starts.",ue=()=>{const v=a();return v?c().privateMode||!c().showProject?"Hidden":v.project||"—":"—"},C=v=>{e.state.update(v)},pe=async()=>{try{await e.ctx.system.copy(f()),l(!0),p!==void 0&&clearTimeout(p),p=setTimeout(()=>l(!1),1500)}catch{}},he=()=>{e.ctx.desktop?.reveal(f()).catch(()=>{})};return[(()=>{var v=Ke(),_=v.firstChild,k=_.firstChild,A=k.nextSibling;return t.insert(A,t.createComponent(u.Show,{get when(){return e.state.saving()},get children(){return He()}}),null),t.insert(A,t.createComponent(n.Button,{variant:"neutral",icon:"refresh",get busy(){return e.state.loading()},onClick:()=>{e.state.refresh()},children:"Refresh"}),null),v})(),(()=>{var v=et(),_=v.firstChild,k=_.firstChild,A=k.firstChild,J=A.firstChild,V=J.nextSibling,W=V.firstChild,ve=W.nextSibling,L=k.nextSibling,S=L.nextSibling;S.firstChild;var G=S.nextSibling,I=G.firstChild,ge=I.firstChild,fe=ge.firstChild,me=fe.nextSibling,H=I.nextSibling,K=H.firstChild,X=K.nextSibling,Q=X.nextSibling,z=G.nextSibling,we=z.firstChild;return t.insert(_,t.createComponent(u.Show,{get when(){return e.state.error()},children:r=>(()=>{var h=tt(),x=h.firstChild;return t.insert(x,r),t.insert(h,t.createComponent(u.Show,{get when(){return e.ctx.desktop},get children(){return t.createComponent(n.Button,{variant:"ghost",size:"small",onClick:()=>{e.state.refresh()},children:"Retry"})}}),null),h})()}),k),t.insert(_,t.createComponent(u.Show,{get when(){return g()?.configError},children:r=>(()=>{var h=nt(),x=h.firstChild,j=x.firstChild,E=j.nextSibling;return E.nextSibling,t.insert(x,r,E),h})()}),k),t.insert(_,t.createComponent(u.Show,{get when(){return g()===void 0},get children(){var r=Xe(),h=r.firstChild;return t.insert(h,()=>e.state.loading()?"Loading Discord presence settings…":"Settings are unavailable. This page needs OpenCode Desktop."),r}}),k),t.insert(W,F),t.insert(ve,T),t.insert(V,t.createComponent(u.Show,{get when(){return b()},get children(){var r=Qe(),h=r.firstChild,x=h.firstChild,j=x.nextSibling,E=h.nextSibling,be=E.firstChild,Se=be.nextSibling,Y=E.nextSibling,xe=Y.firstChild,Ce=xe.nextSibling,Z=Y.nextSibling,$e=Z.firstChild,ye=$e.nextSibling,ee=Z.nextSibling,_e=ee.firstChild,ke=_e.nextSibling,te=ee.nextSibling,De=te.firstChild,je=De.nextSibling,ne=te.nextSibling,Me=ne.firstChild,Pe=Me.nextSibling,Te=ne.nextSibling,Ee=Te.firstChild,Oe=Ee.nextSibling;return t.insert(j,ue),t.insert(Se,()=>a()?.model||"—"),t.insert(Ce,()=>de(a()?.tokens??0)),t.insert(ye,()=>le(a()?.costUSD??0)),t.insert(ke,()=>a()?.source||"—"),t.insert(je,()=>ot(a()?.updatedAt,o())),t.insert(Pe,()=>a()?.daemonVersion||"—"),t.insert(Oe,()=>a()?.busy?"Working":"Idle"),r}}),null),t.insert(L,t.createComponent($,{ui:n,title:"Enable Discord presence",description:"Turning this off clears Discord immediately without stopping the daemon.",get checked(){return c().enabled},get disabled(){return m()},onChange:r=>C({enabled:r})}),null),t.insert(L,t.createComponent($,{ui:n,title:"Start with OpenCode",description:"Launch the daemon automatically. Turning this off stops the supervised daemon.",get checked(){return c().autostart},get disabled(){return m()},onChange:r=>C({autostart:r})}),null),t.insert(_,t.createComponent(u.Show,{get when(){return!c().autostart},get children(){return Ye()}}),S),t.insert(S,t.createComponent($,{ui:n,title:"Project name",description:"Show the project on the details line.",get checked(){return c().showProject},get disabled(){return m()},onChange:r=>C({showProject:r})}),null),t.insert(S,t.createComponent($,{ui:n,title:"Model",description:"Show the model on the state line while working.",get checked(){return c().showModel},get disabled(){return m()},onChange:r=>C({showModel:r})}),null),t.insert(S,t.createComponent($,{ui:n,title:"Token count",description:"Show input plus output tokens.",get checked(){return c().showTokens},get disabled(){return m()},onChange:r=>C({showTokens:r})}),null),t.insert(S,t.createComponent($,{ui:n,title:"Estimated cost",description:"Show the session's estimated cost.",get checked(){return c().showCost},get disabled(){return m()},onChange:r=>C({showCost:r})}),null),t.insert(S,t.createComponent($,{ui:n,title:"Elapsed time",description:"Show the Discord elapsed timer while working.",get checked(){return c().showElapsed},get disabled(){return m()},onChange:r=>C({showElapsed:r})}),null),t.insert(S,t.createComponent($,{ui:n,title:"Private mode",description:"Replace the project with “a session” and hide it from the idle state line.",get checked(){return c().privateMode},get disabled(){return m()},onChange:r=>C({privateMode:r})}),null),t.insert(me,()=>D().sample?"Sample session. Start the daemon to see live activity.":"Built from the daemon's latest status."),t.insert(I,t.createComponent(u.Show,{get when(){return!c().enabled},get children(){return Ze()}}),null),t.insert(K,()=>D().details),t.insert(X,()=>D().state),t.insert(Q,()=>D().elapsed??"00:00:00"),t.insert(we,f),t.insert(z,t.createComponent(n.Button,{variant:"ghost",size:"small",icon:"copy",onClick:()=>{pe()},get children(){return d()?"Copied":"Copy path"}}),null),t.insert(z,t.createComponent(u.Show,{get when(){return e.ctx.desktop},get children(){return t.createComponent(n.Button,{variant:"ghost",size:"small",icon:"folder",get disabled(){return g()===void 0},onClick:he,children:"Reveal"})}}),null),t.effect(r=>{var h=`ods-dot ${P()}`,x=`ods-preview ${c().enabled?"":"ods-preview--off"}`,j=`ods-preview-elapsed ${c().showElapsed?"":"ods-preview-elapsed--off"}`;return h!==r.e&&t.className(J,r.e=h),x!==r.t&&t.className(H,r.t=x),j!==r.a&&t.className(Q,r.a=j),r},{e:void 0,t:void 0,a:void 0}),v})()]}const rt=3e3;function st(e){return e instanceof Error?e.message:String(e)}function at(e){const[n,o]=u.createSignal(),[i,d]=u.createSignal(!0),[l,p]=u.createSignal(!1),[g,c]=u.createSignal();let a=0;const N=f=>e.desktop===void 0?"This page needs OpenCode Desktop.":st(f),b=async()=>{if(l())return;const f=++a;try{const w=await e.main(U).get();if(f!==a)return;o(w),c(void 0)}catch(w){if(f!==a)return;c(N(w))}finally{f===a&&d(!1)}},D=async f=>{const w=n();if(!w)return;const P=++a,F={...w.config,...f};o({...w,config:F}),p(!0),c(void 0);try{const T=await e.main(U).update(F);if(P!==a)return;o(T)}catch(T){if(P!==a)return;o(w),c(N(T))}finally{P===a&&p(!1)}};b();const m=setInterval(()=>{b()},rt);return u.onCleanup(()=>clearInterval(m)),{snapshot:n,loading:i,saving:l,error:g,refresh:b,update:D}}const dt=`
.ods-stack {
  display: grid;
  gap: 12px;
}

.ods-card {
  background: var(--v2-background-bg-layer-01);
  box-shadow: inset 0 0 0 0.5px var(--v2-border-border-muted);
  border-radius: 8px;
  overflow: hidden;
}

.ods-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px 12px;
}

.ods-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--v2-text-text-base);
}

.ods-muted {
  font-size: 11px;
  color: var(--v2-text-text-muted);
}

.ods-status {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 20px;
}

.ods-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  margin-top: 5px;
  background: var(--v2-text-text-muted);
}

.ods-dot--on {
  background: var(--v2-state-fg-success, #3fb950);
}

.ods-dot--warn {
  background: var(--v2-state-fg-warning, #d29922);
}

.ods-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 20px;
  margin-top: 12px;
}

.ods-meta-label {
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--v2-text-text-muted);
}

.ods-meta-value {
  font-size: 12px;
  color: var(--v2-text-text-base);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ods-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 20px;
  border-top: 0.5px solid var(--v2-border-border-muted);
}

.ods-row:first-child {
  border-top: 0;
}

.ods-row-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ods-row-title {
  font-size: 12px;
  color: var(--v2-text-text-base);
}

.ods-row-desc {
  font-size: 11px;
  color: var(--v2-text-text-muted);
}

.ods-preview {
  margin: 0 20px 20px;
  padding: 12px 14px;
  border-radius: 6px;
  background: var(--v2-background-bg-layer-02);
  border: 0.5px solid var(--v2-border-border-muted);
  display: grid;
  gap: 4px;
}

.ods-preview--off {
  opacity: 0.6;
}

.ods-preview-line {
  font-size: 12px;
  color: var(--v2-text-text-base);
}

.ods-preview-line--state {
  color: var(--v2-text-text-muted);
}

.ods-preview-elapsed {
  font-size: 11px;
  color: var(--v2-text-text-muted);
  font-variant-numeric: tabular-nums;
}

.ods-preview-elapsed--off {
  opacity: 0.5;
}

.ods-badge {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--v2-background-bg-layer-02);
  color: var(--v2-text-text-muted);
  white-space: nowrap;
}

.ods-badge--off {
  color: var(--v2-state-fg-warning, #d29922);
}

.ods-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--v2-background-bg-layer-01);
  box-shadow: inset 0 0 0 0.5px var(--v2-border-border-muted);
  font-size: 11px;
  color: var(--v2-text-text-muted);
}

.ods-notice--error {
  color: var(--v2-state-fg-danger, #f85149);
}

.ods-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 0 4px;
}

.ods-path {
  flex: 1;
  min-width: 0;
  font-family: var(--v2-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  color: var(--v2-text-text-muted);
  word-break: break-all;
}
`,lt=O.Plugin.define({setup(e){const n=at(e);e.add(O.Style,dt),e.add(O.SettingsPage,{id:"opencode-discord-status",icon:"discord",title:"Discord Presence",entries:[{id:"presence",title:"Discord Presence",description:"Choose what your OpenCode session shows on Discord",keywords:"discord rich presence status private elapsed opencode"}],render:()=>t.createComponent(it,{state:n,ctx:e})}),e.add(O.Command,{id:"open-settings",title:"OpenCode Discord presence settings",description:"Control the Discord Rich Presence shown for OpenCode",group:"View",run:()=>e.layout.settings("opencode-discord-status")})},main:ze});exports.default=lt;
