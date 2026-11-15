"use strict";Object.defineProperties(exports,{__esModule:{value:!0},[Symbol.toStringTag]:{value:"Module"}});const n=require("solid-js/web"),N=require("@opencode/plugin/gui"),M=require("node:fs/promises"),z=require("node:os"),C=require("node:path"),r=require("effect"),u=require("solid-js"),oe=r.Schema.Struct({version:r.Schema.Literal(1),enabled:r.Schema.Boolean,showProject:r.Schema.Boolean,showModel:r.Schema.Boolean,showTokens:r.Schema.Boolean,showCost:r.Schema.Boolean,showElapsed:r.Schema.Boolean,privateMode:r.Schema.Boolean}),se=r.Schema.Struct({version:r.Schema.Literal(1),pid:r.Schema.Number,daemonVersion:r.Schema.String,enabled:r.Schema.Boolean,discordConnected:r.Schema.Boolean,source:r.Schema.String,project:r.Schema.String,model:r.Schema.String,tokens:r.Schema.Number,costUSD:r.Schema.Number,startedAt:r.Schema.optional(r.Schema.String),busy:r.Schema.Boolean,updatedAt:r.Schema.String}),ie=r.Schema.Struct({config:oe,status:r.Schema.optional(se),configPath:r.Schema.String,configError:r.Schema.optional(r.Schema.String)}),R=N.Ipc.define({id:"opencode-discord-status-gui.settings",methods:{get:{output:ie},update:{input:oe,output:ie}}}),B={version:1,enabled:!0,showProject:!0,showModel:!0,showTokens:!0,showCost:!0,showElapsed:!0,privateMode:!1},Oe=["enabled","showProject","showModel","showTokens","showCost","showElapsed","privateMode"];function re(e){return e instanceof Error?e.message:String(e)}function Fe(e){const t={...B};if(e.trim()==="")return{config:t};let i;try{i=JSON.parse(e)}catch(l){return{config:t,error:`Invalid JSON: ${re(l)}`}}if(typeof i!="object"||i===null||Array.isArray(i))return{config:t,error:"Config must be a JSON object"};const o=i,d=[];"version"in o&&(o.version===1?t.version=1:d.push("version"));for(const l of Oe){if(!(l in o))continue;const p=o[l];typeof p=="boolean"?t[l]=p:d.push(l)}return d.length>0?{config:t,error:`Invalid config fields: ${d.join(", ")}`}:{config:t}}function ae(){if(process.platform==="win32"){const e=process.env.APPDATA||C.join(z.homedir(),"AppData","Roaming");return C.join(e,"opencode-discord-status")}return process.platform==="darwin"?C.join(z.homedir(),"Library","Application Support","opencode-discord-status"):C.join(process.env.XDG_CONFIG_HOME||C.join(z.homedir(),".config"),"opencode-discord-status")}function U(){return C.join(ae(),"config.json")}function Ae(){return C.join(ae(),"status.json")}async function Be(e){try{return Fe(await M.readFile(e,"utf8"))}catch(t){return t.code==="ENOENT"?{config:{...B}}:{config:{...B},error:re(t)}}}async function Le(e,t){const i=C.dirname(e);await M.mkdir(i,{recursive:!0,mode:448});const o=`${e}.${process.pid}.${Date.now()}.tmp`;try{await M.writeFile(o,`${JSON.stringify(t,null,2)}
`,{mode:384}),await M.rename(o,e)}catch(d){throw await M.rm(o,{force:!0}).catch(()=>{}),d}}async function Ie(e){try{const t=JSON.parse(await M.readFile(e,"utf8"));return r.Schema.decodeUnknownSync(se)(t)}catch{return}}const ze=e=>{let t;const i=async()=>{const o=U(),{config:d,error:l}=await Be(o);l?l!==t&&(e.log.write("warn","opencode-discord-status config problem",{error:l}),t=l):t=void 0;const p=await Ie(Ae());return{config:d,status:p,configPath:o,...l?{configError:l}:{}}};e.provide(R,{get:i,update:async o=>{try{await Le(U(),o)}catch(d){throw e.log.write("error","opencode-discord-status config write failed",{error:String(d)}),d}return i()}})},Re=1e4,Ue=45*6e4;function de(e){if(e>=1e6)return`${(e/1e6).toFixed(1)}M`;if(e>=1e3){const t=e/1e3;return t>=999.95?"1.0M":`${t.toFixed(1)}K`}return String(e)}function le(e){if(!Number.isFinite(e)||e<=0)return"$0.00";if(e>=1)return`$${e.toFixed(2)}`;let t=e.toFixed(4).replace(/0+$/,"");if(t.endsWith("."))t+="00";else{const i=t.length-t.indexOf(".")-1;i<2&&(t+="0".repeat(2-i))}return`$${t}`}function qe(e,t){const i=e?Date.parse(e):Number.NaN;if(!Number.isFinite(i))return"00:00:00";const o=Math.max(0,Math.floor((t-i)/1e3)),d=Math.floor(o/3600),l=Math.floor(o%3600/60),p=o%60;return[d,l,p].map(g=>String(g).padStart(2,"0")).join(":")}function Je(e,t){return e.busy?t.privateMode||!t.showProject?"Working on: a session":e.project!==""?`Working on: ${e.project}`:"Working on: OpenCode":"Idle"}function Ve(e,t){const i=[];return e.busy?t.showModel&&i.push(e.model!==""?e.model:"OpenCode"):t.showProject&&!t.privateMode&&e.project!==""&&i.push(e.project),t.showTokens&&i.push(`${de(e.tokens)} tokens`),t.showCost&&i.push(le(e.costUSD)),i.length>0?i.join(" | "):"OpenCode"}function ce(e,t){if(!e)return!0;const i=Date.parse(e.updatedAt);return Number.isFinite(i)?t-i>Re:!0}function We(e,t,i){const o=t!==void 0&&!ce(t,i),d=o?{project:t.project,model:t.model,tokens:t.tokens,costUSD:t.costUSD,startedAt:t.startedAt,busy:t.busy}:{project:"my-project",model:"DeepSeek V4.1 Flash",tokens:12300,costUSD:.0421,startedAt:new Date(i-Ue).toISOString(),busy:!0},l=e.showElapsed&&d.busy?qe(d.startedAt,i):void 0;return{details:Je(d,e),state:Ve(d,e),...l!==void 0?{elapsed:l}:{},sample:!o}}var Ge=n.template("<div class=ods-row><div class=ods-row-copy><span class=ods-row-title></span><span class=ods-row-desc>"),He=n.template("<span class=ods-muted>Saving…"),Ke=n.template('<div class=settings-tab-header><div class=settings-tab-header-row><div class="flex flex-col gap-1"><h2 class=settings-tab-title>Discord Presence</h2><span class="text-11-regular text-v2-text-text-muted">Choose what your OpenCode session shows on Discord.</span></div><div class=settings-tab-header-actions>'),Xe=n.template("<div class=ods-notice><span>"),Qe=n.template("<div class=ods-grid><div><div class=ods-meta-label>Project</div><div class=ods-meta-value></div></div><div><div class=ods-meta-label>Model</div><div class=ods-meta-value></div></div><div><div class=ods-meta-label>Tokens</div><div class=ods-meta-value></div></div><div><div class=ods-meta-label>Cost</div><div class=ods-meta-value></div></div><div><div class=ods-meta-label>Source</div><div class=ods-meta-value></div></div><div><div class=ods-meta-label>Last update</div><div class=ods-meta-value></div></div><div><div class=ods-meta-label>Daemon</div><div class=ods-meta-value></div></div><div><div class=ods-meta-label>Session</div><div class=ods-meta-value>"),Ye=n.template('<span class="ods-badge ods-badge--off">Presence is off'),Ze=n.template('<div class="settings-tab-body settings-tab-body--sectioned"><div class=ods-stack><div class=ods-card><div class=ods-status><span></span><div style=flex:1;min-width:0><div class=ods-card-title></div><div class=ods-muted></div></div></div></div><div class=ods-card></div><div class=ods-card><div class=ods-card-head><div><div class=ods-card-title>Presence details</div><div class=ods-muted>Choose which fields appear on Discord.</div></div></div></div><div class=ods-card><div class=ods-card-head><div><div class=ods-card-title>Live preview</div><div class=ods-muted></div></div></div><div><div class=ods-preview-line></div><div class="ods-preview-line ods-preview-line--state"></div><div></div></div></div><div class=ods-footer><span class=ods-path></span></div><div class=ods-muted>Changes apply live to a running daemon. No restart needed.'),et=n.template('<div class="ods-notice ods-notice--error"><span>'),tt=n.template("<div class=ods-notice><span>Config file needs attention: <!>. Toggle any setting to rewrite it with valid values.");function nt(e,t){if(!e)return"—";const i=Date.parse(e);if(!Number.isFinite(i))return"unknown";const o=Math.max(0,t-i);return o<1e3?"just now":o<6e4?`${Math.floor(o/1e3)}s ago`:o<36e5?`${Math.floor(o/6e4)}m ago`:`${Math.floor(o/36e5)}h ago`}function _(e){return(()=>{var t=Ge(),i=t.firstChild,o=i.firstChild,d=o.nextSibling;return n.insert(o,()=>e.title),n.insert(d,()=>e.description),n.insert(t,n.createComponent(e.ui.Switch,{get label(){return e.title},hideLabel:!0,get checked(){return e.checked},get disabled(){return e.disabled},get onChange(){return e.onChange}}),null),t})()}function it(e){const t=e.ctx.ui,[i,o]=u.createSignal(Date.now()),[d,l]=u.createSignal(!1);let p;u.onMount(()=>{const v=setInterval(()=>o(Date.now()),1e3);u.onCleanup(()=>clearInterval(v))}),u.onCleanup(()=>{p!==void 0&&clearTimeout(p)});const g=()=>e.state.snapshot(),c=()=>g()?.config??B,a=()=>g()?.status,O=()=>ce(a(),i()),b=()=>a()!==void 0&&!O(),k=u.createMemo(()=>We(c(),a(),i())),w=()=>g()===void 0||e.state.saving(),f=()=>g()?.configPath??U(),m=()=>b()&&c().enabled&&a()?.discordConnected===!0,P=()=>b()?m()?"ods-dot--on":"ods-dot--warn":"",F=()=>b()?c().enabled?a()?.discordConnected?"Discord connected":"Discord unavailable":"Presence disabled":a()?"Daemon not reporting":"Daemon not running",T=()=>b()?c().enabled?a()?.discordConnected?a()?.busy?"Showing the busy session.":"Showing the idle card.":"The daemon is retrying the Discord connection.":"The daemon is running and Discord activity has been cleared.":a()?"The status file is stale. Settings stay editable.":"Settings stay editable; changes apply when the daemon starts.",ue=()=>{const v=a();return v?c().privateMode||!c().showProject?"Hidden":v.project||"—":"—"},$=v=>{e.state.update(v)},pe=async()=>{try{await e.ctx.system.copy(f()),l(!0),p!==void 0&&clearTimeout(p),p=setTimeout(()=>l(!1),1500)}catch{}},he=()=>{e.ctx.desktop?.reveal(f()).catch(()=>{})};return[(()=>{var v=Ke(),D=v.firstChild,y=D.firstChild,A=y.nextSibling;return n.insert(A,n.createComponent(u.Show,{get when(){return e.state.saving()},get children(){return He()}}),null),n.insert(A,n.createComponent(t.Button,{variant:"neutral",icon:"refresh",get busy(){return e.state.loading()},onClick:()=>{e.state.refresh()},children:"Refresh"}),null),v})(),(()=>{var v=Ze(),D=v.firstChild,y=D.firstChild,A=y.firstChild,q=A.firstChild,J=q.nextSibling,V=J.firstChild,ve=V.nextSibling,W=y.nextSibling,x=W.nextSibling;x.firstChild;var G=x.nextSibling,L=G.firstChild,ge=L.firstChild,fe=ge.firstChild,me=fe.nextSibling,H=L.nextSibling,K=H.firstChild,X=K.nextSibling,Q=X.nextSibling,I=G.nextSibling,be=I.firstChild;return n.insert(D,n.createComponent(u.Show,{get when(){return e.state.error()},children:s=>(()=>{var h=et(),S=h.firstChild;return n.insert(S,s),n.insert(h,n.createComponent(u.Show,{get when(){return e.ctx.desktop},get children(){return n.createComponent(t.Button,{variant:"ghost",size:"small",onClick:()=>{e.state.refresh()},children:"Retry"})}}),null),h})()}),y),n.insert(D,n.createComponent(u.Show,{get when(){return g()?.configError},children:s=>(()=>{var h=tt(),S=h.firstChild,j=S.firstChild,E=j.nextSibling;return E.nextSibling,n.insert(S,s,E),h})()}),y),n.insert(D,n.createComponent(u.Show,{get when(){return g()===void 0},get children(){var s=Xe(),h=s.firstChild;return n.insert(h,()=>e.state.loading()?"Loading Discord presence settings…":"Settings are unavailable. This page needs OpenCode Desktop."),s}}),y),n.insert(V,F),n.insert(ve,T),n.insert(J,n.createComponent(u.Show,{get when(){return b()},get children(){var s=Qe(),h=s.firstChild,S=h.firstChild,j=S.nextSibling,E=h.nextSibling,we=E.firstChild,Se=we.nextSibling,Y=E.nextSibling,xe=Y.firstChild,Ce=xe.nextSibling,Z=Y.nextSibling,$e=Z.firstChild,ye=$e.nextSibling,ee=Z.nextSibling,_e=ee.firstChild,ke=_e.nextSibling,te=ee.nextSibling,De=te.firstChild,je=De.nextSibling,ne=te.nextSibling,Me=ne.firstChild,Pe=Me.nextSibling,Te=ne.nextSibling,Ee=Te.firstChild,Ne=Ee.nextSibling;return n.insert(j,ue),n.insert(Se,()=>a()?.model||"—"),n.insert(Ce,()=>de(a()?.tokens??0)),n.insert(ye,()=>le(a()?.costUSD??0)),n.insert(ke,()=>a()?.source||"—"),n.insert(je,()=>nt(a()?.updatedAt,i())),n.insert(Pe,()=>a()?.daemonVersion||"—"),n.insert(Ne,()=>a()?.busy?"Working":"Idle"),s}}),null),n.insert(W,n.createComponent(_,{ui:t,title:"Enable Discord presence",description:"Turning this off clears Discord immediately without stopping the daemon.",get checked(){return c().enabled},get disabled(){return w()},onChange:s=>$({enabled:s})})),n.insert(x,n.createComponent(_,{ui:t,title:"Project name",description:"Show the project on the details line.",get checked(){return c().showProject},get disabled(){return w()},onChange:s=>$({showProject:s})}),null),n.insert(x,n.createComponent(_,{ui:t,title:"Model",description:"Show the model on the state line while working.",get checked(){return c().showModel},get disabled(){return w()},onChange:s=>$({showModel:s})}),null),n.insert(x,n.createComponent(_,{ui:t,title:"Token count",description:"Show input plus output tokens.",get checked(){return c().showTokens},get disabled(){return w()},onChange:s=>$({showTokens:s})}),null),n.insert(x,n.createComponent(_,{ui:t,title:"Estimated cost",description:"Show the session's estimated cost.",get checked(){return c().showCost},get disabled(){return w()},onChange:s=>$({showCost:s})}),null),n.insert(x,n.createComponent(_,{ui:t,title:"Elapsed time",description:"Show the Discord elapsed timer while working.",get checked(){return c().showElapsed},get disabled(){return w()},onChange:s=>$({showElapsed:s})}),null),n.insert(x,n.createComponent(_,{ui:t,title:"Private mode",description:"Replace the project with “a session” and hide it from the idle state line.",get checked(){return c().privateMode},get disabled(){return w()},onChange:s=>$({privateMode:s})}),null),n.insert(me,()=>k().sample?"Sample session. Start the daemon to see live activity.":"Built from the daemon's latest status."),n.insert(L,n.createComponent(u.Show,{get when(){return!c().enabled},get children(){return Ye()}}),null),n.insert(K,()=>k().details),n.insert(X,()=>k().state),n.insert(Q,()=>k().elapsed??"00:00:00"),n.insert(be,f),n.insert(I,n.createComponent(t.Button,{variant:"ghost",size:"small",icon:"copy",onClick:()=>{pe()},get children(){return d()?"Copied":"Copy path"}}),null),n.insert(I,n.createComponent(u.Show,{get when(){return e.ctx.desktop},get children(){return n.createComponent(t.Button,{variant:"ghost",size:"small",icon:"folder",get disabled(){return g()===void 0},onClick:he,children:"Reveal"})}}),null),n.effect(s=>{var h=`ods-dot ${P()}`,S=`ods-preview ${c().enabled?"":"ods-preview--off"}`,j=`ods-preview-elapsed ${c().showElapsed?"":"ods-preview-elapsed--off"}`;return h!==s.e&&n.className(q,s.e=h),S!==s.t&&n.className(H,s.t=S),j!==s.a&&n.className(Q,s.a=j),s},{e:void 0,t:void 0,a:void 0}),v})()]}const ot=3e3;function st(e){return e instanceof Error?e.message:String(e)}function rt(e){const[t,i]=u.createSignal(),[o,d]=u.createSignal(!0),[l,p]=u.createSignal(!1),[g,c]=u.createSignal();let a=0;const O=f=>e.desktop===void 0?"This page needs OpenCode Desktop.":st(f),b=async()=>{if(l())return;const f=++a;try{const m=await e.main(R).get();if(f!==a)return;i(m),c(void 0)}catch(m){if(f!==a)return;c(O(m))}finally{f===a&&d(!1)}},k=async f=>{const m=t();if(!m)return;const P=++a,F={...m.config,...f};i({...m,config:F}),p(!0),c(void 0);try{const T=await e.main(R).update(F);if(P!==a)return;i(T)}catch(T){if(P!==a)return;i(m),c(O(T))}finally{P===a&&p(!1)}};b();const w=setInterval(()=>{b()},ot);return u.onCleanup(()=>clearInterval(w)),{snapshot:t,loading:o,saving:l,error:g,refresh:b,update:k}}const at=`
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
`,dt=N.Plugin.define({setup(e){const t=rt(e);e.add(N.Style,at),e.add(N.SettingsPage,{id:"opencode-discord-status",icon:"discord",title:"Discord Presence",entries:[{id:"presence",title:"Discord Presence",description:"Choose what your OpenCode session shows on Discord",keywords:"discord rich presence status private elapsed opencode"}],render:()=>n.createComponent(it,{state:t,ctx:e})}),e.add(N.Command,{id:"open-settings",title:"OpenCode Discord presence settings",description:"Control the Discord Rich Presence shown for OpenCode",group:"View",run:()=>e.layout.settings("opencode-discord-status")})},main:ze});exports.default=dt;
