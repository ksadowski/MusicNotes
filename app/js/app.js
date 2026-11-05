import {loadState,scheduleSave,requestPersist,flush} from './storage.js';
import {exportFile,readBackup,mergeSongs} from './backup.js';
import {createTracker,mergeData,payloadOf,samePayload} from './sync.js';
import * as gd from './gdrive.js';

const $=s=>document.querySelector(s);
const uid=()=>Math.random().toString(36).slice(2,10);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const SMOOTH=reduced?'auto':'smooth';

/* ---------- akordy: zapis wewnętrzny # / b, wyświetlanie ♯ / ♭ ---------- */
const ROOT=/([A-G])(#|b)?(?!\.)/g;
const disp=s=>s?s.replace(ROOT,(x,r,a)=>r+(a==='#'?'♯':a==='b'?'♭':'')):'';
const plTakt=n=>n===1?'takt':(n%10>=2&&n%10<=4&&(n%100<12||n%100>14))?'takty':'taktów';

/* ---------- dane ---------- */
const PRESETS=[
  {name:'Intro',short:'I',color:0,bars:4},{name:'Zwrotka',short:'Z',color:1,bars:8},
  {name:'Przedrefren',short:'PR',color:6,bars:4},{name:'Refren',short:'R',color:2,bars:8},
  {name:'Bridge',short:'B',color:3,bars:4},{name:'Solo',short:'S',color:4,bars:8},
  {name:'Przejście',short:'P',color:7,bars:2},{name:'Outro',short:'O',color:5,bars:4}
];
const mkSec=(name,short,color,chords,lyrics='',texts={})=>({id:uid(),name,short,color,bars:chords.length,chords,lyrics,texts});

function newSong(){
  const z=mkSec('Zwrotka','Z',1,Array(8).fill('')), r=mkSec('Refren','R',2,Array(8).fill(''));
  return {id:uid(),title:'Nowa piosenka',bpm:100,notes:'',sections:[z,r],arrangement:[{sid:z.id,rep:1},{sid:r.id,rep:1}]};
}

let state=await loadState();
if(!state||!Array.isArray(state.songs)) state={songs:[],currentId:null};
state.songs.forEach(so=>so.sections.forEach(s=>{if(!s.texts||typeof s.texts!=='object')s.texts={}}));
if(!state.deleted) state.deleted={};
const tracker=createTracker(state);
function save(){
  if(tracker.mark()&&syncOn()) scheduleAutoSync();
  scheduleSave(state);
}

const ui={sel:null,pane:'list',search:'',confirm:null,keypad:null,stage:null,text:null,
  persisted:null,importing:null,install:null,update:null,
  sync:{busy:false,error:null,needAuth:false}};

/* powrót z logowania Google (token w adresie) – przed jakąkolwiek zmianą historii */
const authReturn=gd.enabled()?gd.handleRedirect():null;
if(authReturn&&!authReturn.ok){
  ui.sync.error=authReturn.error;
  if(state.sync&&!state.sync.last&&!state.sync.fileId) state.sync.on=false;
  else ui.sync.needAuth=true;
}
const cur=()=>state.songs.find(s=>s.id===state.currentId);
const secOf=(song,sid)=>song.sections.find(s=>s.id===sid);

function songBars(song){
  let bars=0;
  song.arrangement.forEach(a=>{const s=secOf(song,a.sid);if(s)bars+=s.bars*a.rep});
  return bars;
}

/* ---------- widoki ---------- */
function timelineHTML(song,cls){
  return `<div class="timeline ${cls}" aria-hidden="true">${song.arrangement.map(a=>{
    const s=secOf(song,a.sid); if(!s) return '';
    return `<span class="seg sc-${s.color}" style="flex-grow:${s.bars*a.rep}" title="${esc(s.name)}${a.rep>1?' ×'+a.rep:''}">${cls==='big'?esc(s.short)+(a.rep>1?'×'+a.rep:''):''}</span>`;
  }).join('')}</div>`;
}

function renderList(){
  const q=ui.search.trim().toLowerCase();
  const items=state.songs.filter(s=>!q||s.title.toLowerCase().includes(q));
  $('#songList').innerHTML=items.length?items.map(s=>`<li><button class="song-item ${s.id===state.currentId?'active':''}" data-act="open-song" data-id="${s.id}">
    <span class="si-title">${esc(s.title||'Bez tytułu')}</span>
    <span class="si-meta">${s.bpm} BPM · ${songBars(s)} ${plTakt(songBars(s))}</span>
    ${timelineHTML(s,'mini')}</button></li>`).join('')
    :`<li class="list-empty">${state.songs.length?`Brak piosenek pasujących do „${esc(ui.search)}”.`:'Nie masz jeszcze żadnej piosenki.'}</li>`;
}

/* ---------- synchronizacja z Dyskiem Google ---------- */
const syncOn=()=>gd.enabled()&&!!(state.sync&&state.sync.on);
function syncWhen(t){
  const d=new Date(t), now=new Date(), hm=d.toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'});
  return d.toDateString()===now.toDateString()?'dziś '+hm:d.toLocaleDateString('pl-PL')+' '+hm;
}
function syncHTML(){
  if(!gd.enabled()) return '';
  if(!syncOn()) return `<div class="sync-box ${ui.sync.error?'warn':''}"><span class="label">Dysk Google</span>
    ${ui.sync.error?`<p class="sb-note sync-status" role="alert">Nie udało się połączyć: ${esc(ui.sync.error)}</p>`
      :'<p class="sb-note">Połącz, żeby piosenki były takie same na tablecie i telefonie.</p>'}
    <button class="btn small" data-act="sync-connect">Połącz z Dyskiem Google</button></div>`;
  const s=ui.sync, last=state.sync.last;
  const status=s.busy?'Synchronizuję…'
    :!navigator.onLine?'Brak internetu. Zsynchronizuję po połączeniu.'
    :s.needAuth?'Zaloguj się ponownie, żeby zsynchronizować.'
    :s.error?esc(s.error)
    :last?'Zsynchronizowano: '+syncWhen(last):'Jeszcze nie zsynchronizowano.';
  return `<div class="sync-box ${s.error||s.needAuth?'warn':''}"><span class="label">Dysk Google</span>
    <p class="sb-note sync-status" role="status">${status}</p>
    <div class="foot-btns">
      <button class="btn small ${s.needAuth?'primary':''}" data-act="sync-now" ${s.busy?'disabled':''}>${s.needAuth?'Zaloguj i synchronizuj':'Synchronizuj teraz'}</button>
      <button class="btn small danger-text" data-act="sync-off" ${s.busy?'disabled':''}>Odłącz</button>
    </div></div>`;
}

let syncing=false, syncAgain=false, autoT=null;
function scheduleAutoSync(){clearTimeout(autoT);autoT=setTimeout(()=>runSync(false),4000)}
/** interactive=true tylko bezpośrednio po stuknięciu – wtedy wolno otworzyć okno logowania Google. */
async function runSync(interactive){
  if(!syncOn()) return;
  if(syncing){syncAgain=true;return}
  if(!navigator.onLine){renderFoot();return}
  if(!gd.hasToken()){
    if(!interactive){ui.sync.needAuth=true;renderFoot();return}
    // logowanie = przejście do Google i powrót; najpierw zapisz wszystko
    ui.sync.busy=true; renderFoot();
    scheduleSave(state); await flush(); gd.signIn(); return;
  }
  syncing=true; clearTimeout(autoT);
  try{
    ui.sync.busy=true; ui.sync.needAuth=false; renderFoot();
    let id=state.sync.fileId||await gd.findFile();
    let remote=id?await gd.readFile(id):null;
    if(id&&!remote){id=await gd.findFile();remote=id?await gd.readFile(id):null}
    if(remote&&!Array.isArray(remote.songs)) remote=null;
    // od tego miejsca do przypisania wszystko synchronicznie – edycje nie mogą się wcisnąć w środek
    tracker.mark();
    const local=payloadOf(state);
    const merged=remote?mergeData(local,remote):{songs:local.songs,deleted:local.deleted};
    if(!samePayload(merged,local)){
      state.songs=merged.songs; state.deleted=merged.deleted; tracker.reset();
      if(!cur()){state.currentId=state.songs[0]?state.songs[0].id:null;ui.sel=null;ui.keypad=null;ui.confirm=null}
      renderAll();
    }
    const out=payloadOf(state);
    if(!id) id=await gd.createFile(out);
    else if(!samePayload(out,remote)) await gd.updateFile(id,out);
    state.sync.fileId=id; state.sync.last=Date.now(); ui.sync.error=null;
  }catch(e){
    if(e instanceof gd.AuthError) ui.sync.needAuth=true;
    else ui.sync.error=e.message;
    if(interactive&&!state.sync.last&&!state.sync.fileId){state.sync.on=false;ui.sync.error=e.message}
    console.warn('Synchronizacja:',e);
  }finally{
    syncing=false; ui.sync.busy=false; scheduleSave(state); renderFoot();
    if(syncAgain){syncAgain=false;runSync(false)}
  }
}

function renderFoot(){
  const im=ui.importing, n=im&&im.songs.length;
  const last=state.lastExport?new Date(state.lastExport).toLocaleDateString('pl-PL'):null;
  $('#sbFoot').innerHTML=`
    ${ui.update?`<div class="foot-strip"><span>Jest nowa wersja aplikacji.</span><button class="btn small primary" data-act="sw-update">Odśwież</button></div>`:''}
    ${im?`<div class="confirm-strip foot-confirm" role="alert"><span>Plik „${esc(im.name)}”: ${n} ${n===1?'piosenka':n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?'piosenki':'piosenek'}.</span>
      ${state.songs.length?`<button class="btn small primary" data-act="import-merge">Dodaj do obecnych</button><button class="btn small danger" data-act="import-replace">Zastąp wszystkie</button>`
        :`<button class="btn small primary" data-act="import-merge">Wczytaj</button>`}
      <button class="btn small ghost" data-act="import-cancel">Anuluj</button></div>`:''}
    ${syncHTML()}
    <div class="foot-btns">
      <button class="btn small" data-act="export" ${state.songs.length?'':'disabled'}>Eksportuj kopię</button>
      <button class="btn small" data-act="import">Importuj kopię</button>
      ${ui.install?`<button class="btn small primary foot-wide" data-act="install">Zainstaluj aplikację</button>`:''}
    </div>
    <p class="sb-note">${ui.persisted?'Dane są zapisane na stałe na tym urządzeniu.':'Dane są na tym urządzeniu, ale przeglądarka może je usunąć. Rób kopie.'}
      ${last?`Ostatnia kopia: ${last}.`:state.songs.length?'Nie zrobiono jeszcze kopii.':''}</p>`;
}

function chipHTML(song,a,i,selected){
  const s=secOf(song,a.sid); if(!s) return '';
  return `<div class="chip sc-${s.color} ${selected?'sel':''}" data-idx="${i}" role="button" tabindex="0" aria-pressed="${selected}" aria-label="${esc(s.name)}${a.rep>1?', '+a.rep+' razy':''}, pozycja ${i+1}">
    <span class="chip-short">${esc(s.short)}</span><span class="chip-name">${esc(s.name)}</span>
    <span class="chip-bars">${s.bars*a.rep}</span>${a.rep>1?`<span class="chip-rep">×${a.rep}</span>`:''}</div>`;
}

const TRASH='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';

const COPY='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';

/* kopia sekcji ląduje zaraz za oryginałem; nazwa i skrót dostają kolejny numer */
function cloneSec(song,s){
  let n=2; while(song.sections.some(x=>x.name===`${s.name} ${n}`||x.short===s.short.slice(0,2)+n)) n++;
  const c={...s,id:uid(),name:`${s.name} ${n}`,short:s.short.slice(0,2)+n,chords:s.chords.slice(),texts:JSON.parse(JSON.stringify(s.texts))};
  song.sections.splice(song.sections.indexOf(s)+1,0,c);
  return c;
}
function focusSecName(id){
  const n=document.getElementById('sn-'+id);
  if(n){n.scrollIntoView({block:'center',behavior:SMOOTH});n.focus({preventScroll:true});n.select()}
}

/* takt = akord albo części rozdzielone spacją („-” to pusta część); tekst może objąć kilka taktów */
const getSlots=v=>v?v.split(' '):[''];
const joinSlots=a=>a.length===1?(a[0]==='-'?'':a[0]):a.map(x=>x||'-').join(' ');
function barInner(v){
  const sl=getSlots(v);
  if(sl.length>1) return `<span class="slots" style="grid-template-columns:repeat(${sl.length},minmax(0,1fr))">${sl.map(x=>`<span>${x&&x!=='-'?esc(disp(x)):'<span class="bar-empty">·</span>'}</span>`).join('')}</span>`;
  return `<span class="bar-c">${v?esc(disp(v)):'<span class="bar-empty">—</span>'}</span>`;
}
function barCells(s){
  const out=[]; let i=0;
  while(i<s.bars){
    const tx=s.texts[i];
    if(!tx){out.push({type:'bar',i});i++;continue}
    const end=Math.min(s.bars,i+tx.span); let j=i;
    while(j<end){const e=Math.min(end,(Math.floor(j/4)+1)*4); out.push({type:'text',start:i,from:j,to:e,first:j===i,t:tx.t}); j=e}
    i=end;
  }
  return out;
}
function textAt(s,i){for(const k in s.texts){const j=+k;if(i>=j&&i<j+s.texts[k].span)return j}return null}
function setText(s,i,t,span){
  span=Math.max(1,Math.min(s.bars-i,span));
  if(!t){delete s.texts[i];return}
  s.texts[i]={t,span};
  for(const k in s.texts){const j=+k;if(j>i&&j<i+span)delete s.texts[k]}
}
function openAt(sid,i){
  const s=secOf(cur(),sid), j=textAt(s,i);
  return j!=null?{sid,i:j,mode:'text',span:s.texts[j].span,slot:0,fresh:false}:{sid,i,mode:'chord',slot:0,fresh:true,span:1};
}

function secCard(s,linked,used){
  const kp=ui.keypad;
  return `<article class="sec-card sc-${s.color} ${linked?'linked':''}" id="sec-${s.id}">
    <div class="sec-head">
      <button class="swatch" data-act="color" data-sid="${s.id}" aria-label="Zmień kolor sekcji" title="Zmień kolor"></button>
      <input class="sec-short" id="ss-${s.id}" data-field="sshort" data-sid="${s.id}" maxlength="3" value="${esc(s.short)}" aria-label="Skrót sekcji">
      <input class="sec-name" id="sn-${s.id}" data-field="sname" data-sid="${s.id}" value="${esc(s.name)}" aria-label="Nazwa sekcji">
      <span class="sec-used">${used?`w formie ${used}×`:'poza formą'}</span>
      <button class="icon-btn" data-act="copy-sec" data-sid="${s.id}" aria-label="Kopiuj sekcję ${esc(s.name)}" title="Kopiuj sekcję">${COPY}</button>
      <button class="icon-btn" data-act="del-sec" data-sid="${s.id}" aria-label="Usuń sekcję ${esc(s.name)}" title="Usuń sekcję">${TRASH}</button>
    </div>
    <div class="sec-body">
      ${ui.confirm==='sec:'+s.id?`<div class="confirm-strip" role="alert"><span>Usunąć sekcję „${esc(s.name)}”${used?` i jej ${used}× w formie`:''}?</span><button class="btn small danger" data-act="del-sec-yes" data-sid="${s.id}">Usuń sekcję</button><button class="btn small ghost" data-act="cancel-confirm">Anuluj</button></div>`:''}
      <div class="sec-tools">
        <div class="stepper">
          <button data-act="bars" data-sid="${s.id}" data-dir="-1" ${s.bars<=1?'disabled':''} aria-label="Usuń takt">−</button>
          <span>${s.bars} ${plTakt(s.bars)}</span>
          <button data-act="bars" data-sid="${s.id}" data-dir="1" ${s.bars>=64?'disabled':''} aria-label="Dodaj takt">+</button>
        </div>
      </div>
      <div class="bars">${barCells(s).map(c=>{
        if(c.type==='bar'){const v=s.chords[c.i]||'';
          return `<button class="bar ${v.includes(' ')?'has-slots':''} ${kp&&kp.sid===s.id&&kp.i===c.i?'editing':''}" data-act="cell" data-sid="${s.id}" data-i="${c.i}" aria-label="Takt ${c.i+1}: ${v?esc(disp(v)):'pusty'}"><span class="bar-n">${c.i+1}</span>${barInner(v)}</button>`}
        const n=c.to-c.from;
        return `<button class="bar text-bar ${kp&&kp.sid===s.id&&kp.i===c.start?'editing':''}" style="grid-column:span ${n}" data-act="cell" data-sid="${s.id}" data-i="${c.start}" aria-label="Takty ${c.from+1}–${c.to}: ${esc(c.t)}"><span class="bar-n">${n>1?(c.from+1)+'–'+c.to:c.from+1}</span><span class="bar-t">${c.first?'':'… '}${esc(c.t)}</span></button>`;
      }).join('')}</div>
      <textarea id="sl-${s.id}" data-field="slyrics" data-sid="${s.id}" rows="2" placeholder="Tekst, uwagi do wykonania…" aria-label="Tekst i uwagi: ${esc(s.name)}">${esc(s.lyrics)}</textarea>
    </div>
  </article>`;
}

function renderEditor(){
  const host=$('#editor'), song=cur();
  const ae=document.activeElement, fid=ae&&ae.id&&host.contains(ae)?ae.id:null;
  let ss=null,se=null; try{ss=ae.selectionStart;se=ae.selectionEnd}catch(e){}
  if(!song){
    host.innerHTML=`<div class="ed-inner"><button class="btn ghost back" data-act="back">‹ Piosenki</button><div class="empty"><p class="empty-title">Nie wybrano piosenki</p><p>Wybierz piosenkę z listy albo zacznij nową.</p><button class="btn primary" data-act="new-song">+ Nowa piosenka</button></div></div>`;
    return;
  }
  if(ui.sel!=null&&!song.arrangement[ui.sel]) ui.sel=null;
  const sel=ui.sel, selA=sel!=null?song.arrangement[sel]:null, selS=selA?secOf(song,selA.sid):null;
  const bars=songBars(song);
  const used={}; song.arrangement.forEach(a=>{used[a.sid]=(used[a.sid]||0)+1});
  const presets=PRESETS.filter(p=>!song.sections.some(s=>s.name===p.name));
  host.innerHTML=`<div class="ed-inner">
    <button class="btn ghost back" data-act="back">‹ Piosenki</button>
    <header class="ed-head">
      <div class="title-row">
        <input id="f-title" class="title-input" data-field="title" value="${esc(song.title)}" placeholder="Tytuł piosenki" aria-label="Tytuł piosenki">
        <button class="icon-btn" data-act="del-song" aria-label="Usuń piosenkę" title="Usuń piosenkę">${TRASH}</button>
      </div>
      ${ui.confirm==='song'?`<div class="confirm-strip" role="alert"><span>Usunąć piosenkę „${esc(song.title)}” razem z całą formą?</span><button class="btn small danger" data-act="del-song-yes">Usuń piosenkę</button><button class="btn small ghost" data-act="cancel-confirm">Anuluj</button></div>`:''}
      <div class="meta-row">
        <label class="meta"><span class="label">Tempo</span><input id="f-bpm" data-field="bpm" type="number" inputmode="numeric" min="20" max="320" value="${song.bpm}"><em>BPM</em></label>
        <div class="meta"><span class="label">Długość</span><strong>${bars} ${plTakt(bars)}</strong></div>
      </div>
      <div class="actions">
        <button class="btn" data-act="copy">Kopiuj jako tekst</button>
        <button class="btn primary" data-act="stage" ${song.arrangement.length?'':'disabled'}>Tryb sceniczny</button>
      </div>
    </header>

    <div class="tl-wrap">${timelineHTML(song,'big')}<div class="tl-scale"><span>takt 1</span><span>${bars}</span></div></div>

    <section class="panel">
      <div class="panel-head"><h2>Forma</h2><p class="hint">Stuknij blok, żeby go zaznaczyć. Przytrzymaj i przeciągnij, żeby zmienić kolejność.</p></div>
      <div class="chips" id="chips">${song.arrangement.map((a,i)=>chipHTML(song,a,i,i===sel)).join('')||'<p class="chips-empty">Forma jest pusta. Dodaj pierwszą sekcję poniżej.</p>'}<span class="drop-marker" id="dropMarker" hidden></span></div>
      ${selS?`<div class="toolbar" role="toolbar" aria-label="Zaznaczony blok">
        <span class="tb-label">${esc(selS.name)}${selA.rep>1?' ×'+selA.rep:''}</span>
        <button class="btn small" data-act="move" data-dir="-1" ${sel===0?'disabled':''}>‹ Wcześniej</button>
        <button class="btn small" data-act="move" data-dir="1" ${sel===song.arrangement.length-1?'disabled':''}>Później ›</button>
        <span class="rep-pick"><span class="label">Powtórz</span><span class="seg-group" role="group" aria-label="Ile razy zagrać">${[1,2,3,4,6,8].map(n=>`<button class="btn small mono ${selA.rep===n?'on':''}" data-act="rep" data-v="${n}" aria-pressed="${selA.rep===n}">×${n}</button>`).join('')}</span></span>
        <button class="btn small" data-act="dup">Duplikuj</button>
        <button class="btn small" data-act="goto-sec">Akordy ↓</button>
        <button class="btn small" data-act="fork" title="Tylko to wystąpienie dostaje własną kopię sekcji do zmian">Zmień tylko tutaj</button>
        <button class="btn small danger-text" data-act="remove">Usuń z formy</button>
      </div>`:''}
      <div class="palette"><span class="label">Dodaj do formy</span>
        ${song.sections.map(s=>`<button class="pal-btn sc-${s.color}" data-act="add-sec" data-sid="${s.id}"><b>${esc(s.short)}</b>${esc(s.name)}</button>`).join('')}
      </div>
      <div class="palette"><span class="label">Nowa sekcja</span>
        ${presets.map(p=>`<button class="pal-btn new" data-act="preset" data-name="${p.name}">+ ${p.name}</button>`).join('')}
        <button class="pal-btn new" data-act="custom-sec">+ Własna</button>
      </div>
    </section>

    <section class="ed-head">
      <div class="panel-head"><h2>Sekcje</h2><p class="hint">Stuknij takt, żeby wpisać akordy (cały takt albo 2–4 części) lub tekst na kilka taktów. Zmiana działa wszędzie, gdzie sekcja występuje w formie.</p></div>
      <div class="sec-grid">${song.sections.map(s=>secCard(s,selA&&selA.sid===s.id,used[s.id]||0)).join('')}</div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Notatki</h2></div>
      <textarea id="f-notes" data-field="notes" rows="3" placeholder="Strój, capo, kto zaczyna, uwagi do aranżu…" aria-label="Notatki do piosenki">${esc(song.notes)}</textarea>
    </section>
  </div>`;
  if(fid){const n=document.getElementById(fid);if(n){n.focus({preventScroll:true});try{if(ss!=null)n.setSelectionRange(ss,se)}catch(e){}}}
}

const MODS=[['#','♯'],['b','♭'],['m','m'],['7','7'],['maj7','maj7'],['m7','m7'],['sus2','sus2'],['sus4','sus4'],['dim','dim'],['aug','aug'],['6','6'],['9','9'],['add9','add9'],['5','5']];
function renderKeypad(){
  const host=$('#keypad'), kp=ui.keypad;
  $('#main').classList.toggle('kp-pad',!!kp);
  if(!kp){host.hidden=true;host.innerHTML='';return}
  const s=secOf(cur(),kp.sid); if(!s||kp.i>=s.bars){ui.keypad=null;return renderKeypad()}
  const tx=s.texts[kp.i], step=kp.mode==='text'&&tx?tx.span:1;
  const sl=getSlots(s.chords[kp.i]||'');
  host.hidden=false;
  const head=`<div class="sheet-head">
      <button class="btn" data-act="k-prev" ${kp.i===0?'disabled':''} aria-label="Poprzedni takt">‹ Takt</button>
      <div class="sheet-where"><span>${esc(s.name)} ·</span> ${step>1?`takty ${kp.i+1}–${kp.i+step}`:`takt ${kp.i+1}`} z ${s.bars}</div>
      <button class="btn" data-act="k-next" ${kp.i+step>=s.bars?'disabled':''} aria-label="Następny takt">Takt ›</button>
    </div>
    <div class="k-row">
      <div class="seg-group" role="group" aria-label="Rodzaj wpisu">
        <button class="btn small ${kp.mode==='chord'?'on':''}" data-act="k-mode" data-v="chord" aria-pressed="${kp.mode==='chord'}">Akordy</button>
        <button class="btn small ${kp.mode==='text'?'on':''}" data-act="k-mode" data-v="text" aria-pressed="${kp.mode==='text'}">Tekst</button>
      </div>
      ${kp.mode==='chord'?`<div class="k-row"><span class="label">Podział taktu</span><div class="seg-group" role="group" aria-label="Podział taktu">${[1,2,3,4].map(n=>`<button class="btn small mono ${sl.length===n?'on':''}" data-act="k-div" data-v="${n}" aria-pressed="${sl.length===n}">${n===1?'cały':n}</button>`).join('')}</div></div>`:''}
    </div>`;
  let body;
  if(kp.mode==='chord'){
    body=`<div class="k-slots" style="grid-template-columns:repeat(${sl.length},minmax(0,1fr))" aria-live="polite">${sl.map((x,j)=>{const has=x&&x!=='-';
        return `<button class="k-slot ${j===kp.slot?'on':''} ${kp.fresh&&j===kp.slot&&has?'fresh':''}" data-act="k-slot" data-v="${j}" aria-label="Część ${j+1}">${sl.length>1?`<small>${j+1}</small>`:''}${has?esc(disp(x)):`<span class="bar-empty">${sl.length>1?'·':'pusty takt'}</span>`}</button>`}).join('')}</div>
    <div class="k-grid roots">${['C','D','E','F','G','A','B'].map(r=>`<button class="k root" data-act="k" data-v="${r}">${disp(r)}</button>`).join('')}</div>
    <div class="k-grid mods">${MODS.map(([v,l])=>`<button class="k" data-act="k" data-v="${v}">${l}</button>`).join('')}</div>
    <div class="k-grid acts">
      <button class="k wide" data-act="k" data-v="/">/ bas</button>
      <button class="k wide" data-act="k" data-v="%">% jak wyżej</button>
      <button class="k wide" data-act="k-back">⌫ Cofnij</button>
      <button class="k wide" data-act="k-clear">Wyczyść takt</button>
      <button class="k wide" data-act="k-adv">Dalej ›</button>
      <button class="k primary" data-act="k-done">Gotowe</button>
    </div>`;
  } else {
    const span=tx?tx.span:kp.span, max=s.bars-kp.i;
    body=`<input id="kpText" class="k-text" data-field="kptext" value="${esc(tx?tx.t:'')}" maxlength="80" placeholder="np. sam klawisz, stop, fill perkusji" aria-label="Tekst w taktach" autocomplete="off">
    <div class="k-sugg">${TEXT_SUGG.map(t=>`<button class="pal-btn new" data-act="k-sugg" data-v="${t}">${t}</button>`).join('')}</div>
    <div class="k-row"><span class="label">Obejmuje</span>
      <div class="stepper">
        <button data-act="k-span" data-v="-1" ${span<=1?'disabled':''} aria-label="Mniej taktów">−</button>
        <span>${span} ${plTakt(span)}</span>
        <button data-act="k-span" data-v="1" ${span>=max?'disabled':''} aria-label="Więcej taktów">+</button>
      </div>
    </div>
    <div class="k-grid acts">
      <button class="k wide" data-act="k-deltext" ${tx?'':'disabled'}>Usuń tekst</button>
      <span></span>
      <button class="k primary" data-act="k-done">Gotowe</button>
    </div>`;
  }
  host.innerHTML=`<div class="backdrop" data-act="k-done"></div><div class="sheet" role="dialog" aria-label="Wpis w takcie">${head}${body}</div>`;
}
const TEXT_SUGG=['sam klawisz','sama perkusja','tacet','stop','fill','ad lib.'];
const TOK=/maj7|add9|sus2|sus4|dim|aug|m7|N\.C\.|[A-G]|#|b|m|7|6|9|5|\/|%| /g;
function kpEdit(fn){
  const kp=ui.keypad, s=secOf(cur(),kp.sid);
  s.chords[kp.i]=fn(s.chords[kp.i]||'');
  save(); renderEditor(); renderKeypad(); renderList();
}
function slotEdit(fn){
  kpEdit(v=>{
    const sl=getSlots(v), k=Math.min(ui.keypad.slot,sl.length-1);
    const x=fn(sl[k]==='-'?'':sl[k]);
    if(x===null) return v;
    sl[k]=x; return joinSlots(sl);
  });
}
function kpPress(v){
  const kp=ui.keypad; kp.fresh=false;
  if(v==='%'){kp.slot=0;kpEdit(()=>'%');return}
  slotEdit(x=>{
    if(x==='%') x='';
    if(/^[A-G]$/.test(v)) return /\/$/.test(x)?x+v:v;
    if(!x) return null;
    if(v==='/') return /\/$/.test(x)?x:x+'/';
    return x+v;
  });
}
function kpSync(){save();renderEditor();renderKeypad()}
function kpClose(){
  if(!ui.keypad) return;
  const s=secOf(cur(),ui.keypad.sid), tx=s&&s.texts[ui.keypad.i]; if(tx) tx.t=tx.t.trim();
  ui.keypad=null; kpSync();
}
function kpGo(d){
  const kp=ui.keypad, s=secOf(cur(),kp.sid), tx=s.texts[kp.i];
  if(tx) tx.t=tx.t.trim();
  let i=d>0?kp.i+(kp.mode==='text'&&tx?tx.span:1):kp.i-1;
  i=Math.max(0,Math.min(s.bars-1,i));
  ui.keypad=openAt(kp.sid,i); kpSync(); scrollCell();
}
function scrollCell(){
  const c=document.querySelector('.bar.editing'), m=$('#main'); if(!c) return;
  const r=c.getBoundingClientRect(), mr=m.getBoundingClientRect();
  m.scrollBy({top:r.top-mr.top-mr.height*0.16,behavior:SMOOTH});
}

let wake=null;
async function requestWake(){try{wake=await navigator.wakeLock.request('screen')}catch(e){}}
function releaseWake(){try{if(wake)wake.release()}catch(e){} wake=null}
function renderStage(scroll){
  const host=$('#stage'), song=cur();
  if(ui.stage==null||!song){host.hidden=true;host.innerHTML='';return}
  host.hidden=false;
  host.innerHTML=`<header class="st-head"><div><h2>${esc(song.title)}</h2><p>${song.bpm} BPM</p></div><button class="btn" data-act="stage-close">Zamknij</button></header>
  <ol class="st-list">${song.arrangement.map((a,i)=>{const s=secOf(song,a.sid);if(!s)return '';return `<li class="st-item sc-${s.color} ${i===ui.stage?'cur':''}" data-act="stage-go" data-i="${i}">
    <div class="st-label"><b>${esc(s.short)}</b><span>${esc(s.name)}</span>${a.rep>1?`<em>×${a.rep}</em>`:''}</div>
    <div class="st-bars">${barCells(s).map(c=>c.type==='bar'
      ?`<span class="st-cell">${barInner(s.chords[c.i]||'')}</span>`
      :`<span class="st-cell st-text" style="grid-column:span ${c.to-c.from}">${c.first?'':'… '}${esc(c.t)}</span>`).join('')}</div>
    ${s.lyrics?`<p class="st-lyr">${esc(s.lyrics)}</p>`:''}</li>`}).join('')}</ol>
  <footer class="st-foot"><button class="btn" data-act="stage-prev" ${ui.stage===0?'disabled':''}>‹ Poprzednia</button><span>${ui.stage+1} / ${song.arrangement.length}</span><button class="btn primary" data-act="stage-next" ${ui.stage>=song.arrangement.length-1?'disabled':''}>Następna ›</button></footer>`;
  if(scroll!==false){const c=host.querySelector('.st-item.cur');if(c)c.scrollIntoView({block:'center',behavior:scroll==='jump'?'auto':SMOOTH})}
}

function renderText(){
  const host=$('#textSheet');
  if(ui.text==null){host.hidden=true;host.innerHTML='';return}
  host.hidden=false;
  host.innerHTML=`<div class="backdrop" data-act="text-close"></div><div class="sheet" role="dialog" aria-label="Forma jako tekst">
    <div class="sheet-head"><strong>Forma jako tekst</strong><button class="btn" data-act="text-close">Zamknij</button></div>
    <p class="hint">Nie udało się skopiować automatycznie. Zaznacz tekst i skopiuj go ręcznie.</p>
    <textarea id="textOut" class="text-out" readonly>${esc(ui.text)}</textarea></div>`;
  const t=$('#textOut'); t.focus(); t.select();
}

function songText(song){
  const bars=songBars(song);
  const L=[`${song.title} | ${song.bpm} BPM`,
    `Forma: ${song.arrangement.map(a=>{const s=secOf(song,a.sid);return s?s.short+(a.rep>1?' ×'+a.rep:''):''}).join(' · ')}`,
    `${bars} ${plTakt(bars)}`,''];
  song.sections.forEach(s=>{
    L.push(`[${s.short}] ${s.name} (${s.bars} ${plTakt(s.bars)})`);
    let row=[],r=0;
    const flush=()=>{if(row.length)L.push('| '+row.join(' | ')+' |');row=[]};
    barCells(s).forEach(c=>{
      const rr=Math.floor((c.type==='bar'?c.i:c.from)/4); if(rr!==r){flush();r=rr}
      if(c.type==='bar'){const v=s.chords[c.i]; row.push(v?getSlots(v).map(x=>x==='-'?'·':disp(x)).join(' '):'-')}
      else row.push(`${c.first?'':'… '}„${c.t}” (${c.to-c.from} t.)`);
    });
    flush();
    if(s.lyrics) L.push(s.lyrics);
    L.push('');
  });
  if(song.notes) L.push('Notatki: '+song.notes);
  return L.join('\n').trim();
}
let toastT;
function toast(msg){const t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>{t.hidden=true},2200)}
function copyText(t){
  const fallback=()=>{ui.text=t;renderText()};
  try{navigator.clipboard.writeText(t).then(()=>toast('Skopiowano formę do schowka'),fallback)}catch(e){fallback()}
}

function renderAll(){
  document.body.classList.toggle('pane-editor',ui.pane==='editor');
  renderList(); renderFoot(); renderEditor(); renderKeypad(); renderStage(false); renderText();
}
function commit(){save();renderAll()}

/* ---------- zdarzenia ---------- */
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-act]'); if(!t||t.disabled) return;
  const d=t.dataset, song=cur(), arr=song?song.arrangement:[], i=ui.sel;
  switch(d.act){
    case 'open-song': state.currentId=d.id; ui.sel=null; ui.confirm=null; ui.keypad=null; ui.pane='editor'; commit(); $('#main').scrollTop=0; break;
    case 'new-song': {const s=newSong(); state.songs.unshift(s); state.currentId=s.id; ui.sel=null; ui.confirm=null; ui.search=''; $('#f-search').value=''; ui.pane='editor'; commit(); $('#main').scrollTop=0; const ti=$('#f-title'); ti.focus(); ti.select(); break;}
    case 'back': ui.pane='list'; ui.keypad=null; renderAll(); break;
    case 'copy': copyText(songText(song)); break;
    case 'stage': ui.stage=ui.sel??0; renderStage('jump'); requestWake(); break;
    case 'stage-close': ui.stage=null; renderStage(); releaseWake(); break;
    case 'stage-next': ui.stage=Math.min(arr.length-1,ui.stage+1); renderStage(); break;
    case 'stage-prev': ui.stage=Math.max(0,ui.stage-1); renderStage(); break;
    case 'stage-go': ui.stage=+d.i; renderStage(); break;
    case 'del-song': ui.confirm='song'; renderAll(); break;
    case 'del-sec': ui.confirm='sec:'+d.sid; renderEditor(); break;
    case 'cancel-confirm': ui.confirm=null; renderAll(); break;
    case 'del-song-yes': {const title=song.title; state.songs=state.songs.filter(s=>s!==song); state.currentId=state.songs[0]?state.songs[0].id:null; ui.confirm=null; ui.sel=null; ui.pane='list'; commit(); toast('Usunięto „'+title+'”'); break;}
    case 'move': {const j=i+(+d.dir); [arr[i],arr[j]]=[arr[j],arr[i]]; ui.sel=j; commit(); break;}
    case 'rep': arr[i].rep=+d.v; commit(); break;
    case 'dup': arr.splice(i+1,0,{...arr[i]}); ui.sel=i+1; commit(); break;
    case 'remove': arr.splice(i,1); ui.sel=null; commit(); break;
    case 'goto-sec': {const c=document.getElementById('sec-'+arr[i].sid); if(c) c.scrollIntoView({block:'start',behavior:SMOOTH}); break;}
    case 'add-sec': arr.push({sid:d.sid,rep:1}); ui.sel=arr.length-1; commit(); break;
    case 'preset': {const p=PRESETS.find(p=>p.name===d.name); const s=mkSec(p.name,p.short,p.color,Array(p.bars).fill('')); song.sections.push(s); arr.push({sid:s.id,rep:1}); ui.sel=arr.length-1; commit(); break;}
    case 'custom-sec': {
      const usedC=song.sections.map(s=>s.color); let c=[...Array(8).keys()].find(k=>!usedC.includes(k)); if(c==null) c=song.sections.length%8;
      const s=mkSec('Sekcja '+(song.sections.length+1),'X',c,Array(4).fill('')); song.sections.push(s); arr.push({sid:s.id,rep:1}); ui.sel=arr.length-1; commit();
      const n=document.getElementById('sn-'+s.id); if(n){n.scrollIntoView({block:'center',behavior:SMOOTH}); n.focus({preventScroll:true}); n.select();} break;}
    case 'bars': {const s=secOf(song,d.sid); const n=Math.max(1,Math.min(64,s.bars+(+d.dir))); while(s.chords.length<n) s.chords.push(''); s.chords.length=n; s.bars=n;
      for(const k in s.texts){const j=+k; if(j>=n) delete s.texts[k]; else s.texts[k].span=Math.min(s.texts[k].span,n-j)}
      if(ui.keypad&&ui.keypad.sid===s.id&&ui.keypad.i>=n) ui.keypad=null; commit(); break;}
    case 'copy-sec': {const c=cloneSec(song,secOf(song,d.sid)); ui.confirm=null; commit(); focusSecName(c.id); toast(`Utworzono kopię: ${c.name}`); break;}
    case 'fork': {const s=secOf(song,arr[i].sid), c=cloneSec(song,s); arr[i].sid=c.id; commit(); focusSecName(c.id); toast(`To wystąpienie używa teraz kopii: ${c.name}`); break;}
    case 'color': {const s=secOf(song,d.sid); s.color=(s.color+1)%8; commit(); break;}
    case 'del-sec-yes': song.sections=song.sections.filter(s=>s.id!==d.sid); song.arrangement=arr.filter(a=>a.sid!==d.sid); ui.sel=null; ui.confirm=null; if(ui.keypad&&ui.keypad.sid===d.sid) ui.keypad=null; commit(); break;
    case 'cell': ui.keypad=openAt(d.sid,+d.i); renderEditor(); renderKeypad(); scrollCell(); break;
    case 'k': kpPress(d.v); break;
    case 'k-back': ui.keypad.fresh=false; slotEdit(x=>{const t=x.match(TOK)||[]; if(t.join('')===x){t.pop(); return t.join('')} return x.slice(0,-1)}); break;
    case 'k-clear': ui.keypad.fresh=false; ui.keypad.slot=0; kpEdit(()=>''); break;
    case 'k-div': {const n=+d.v; ui.keypad.fresh=false;
      kpEdit(v=>{let sl=getSlots(v); if(sl[0]==='%') sl=['']; while(sl.length<n) sl.push('-'); return joinSlots(sl.slice(0,n))});
      ui.keypad.slot=Math.min(ui.keypad.slot,n-1); renderKeypad(); break;}
    case 'k-slot': ui.keypad.slot=+d.v; ui.keypad.fresh=true; renderKeypad(); break;
    case 'k-adv': {const kp=ui.keypad, n=getSlots(secOf(song,kp.sid).chords[kp.i]||'').length;
      if(kp.slot<n-1){kp.slot++;kp.fresh=true;renderKeypad()} else kpGo(1); break;}
    case 'k-mode': {const kp=ui.keypad, s=secOf(song,kp.sid); if(kp.mode===d.v) break;
      if(d.v==='text'){kp.mode='text';kp.span=1;renderKeypad();const ti=$('#kpText');if(ti)ti.focus()}
      else {if(s.texts[kp.i]){delete s.texts[kp.i];toast('Usunięto tekst. Takty wracają do akordów.')} kp.mode='chord';kp.slot=0;kp.fresh=true;kpSync()}
      break;}
    case 'k-span': {const kp=ui.keypad, s=secOf(song,kp.sid), tx=s.texts[kp.i];
      kp.span=Math.max(1,Math.min(s.bars-kp.i,(tx?tx.span:kp.span)+(+d.v)));
      if(tx) setText(s,kp.i,tx.t,kp.span); kpSync(); break;}
    case 'k-sugg': {const kp=ui.keypad, s=secOf(song,kp.sid), tx=s.texts[kp.i]; setText(s,kp.i,d.v,tx?tx.span:kp.span); kpSync(); break;}
    case 'k-deltext': {const kp=ui.keypad; delete secOf(song,kp.sid).texts[kp.i]; kp.span=1; kpSync(); break;}
    case 'k-prev': kpGo(-1); break;
    case 'k-next': kpGo(1); break;
    case 'k-done': kpClose(); break;
    case 'text-close': ui.text=null; renderText(); break;
    case 'export': {const name=exportFile(state.songs); state.lastExport=new Date().toISOString(); commit(); toast('Zapisano kopię: '+name); break;}
    case 'import': {const f=$('#importFile'); f.value=''; f.click(); break;}
    case 'import-cancel': ui.importing=null; renderFoot(); break;
    case 'import-merge': case 'import-replace': {
      const inc=ui.importing.songs, n=inc.length;
      state.songs=d.act==='import-replace'?inc:mergeSongs(state.songs,inc);
      if(!cur()) state.currentId=inc[0].id;
      ui.importing=null; ui.sel=null; ui.keypad=null; ui.confirm=null; commit();
      toast(d.act==='import-replace'?`Zastąpiono piosenki (${n})`:`Wczytano piosenki (${n})`); break;}
    case 'install': {const p=ui.install; ui.install=null; renderFoot(); p.prompt(); break;}
    case 'sync-connect': state.sync={on:true,fileId:null,last:null}; ui.sync={busy:false,error:null,needAuth:false}; runSync(true); break;
    case 'sync-now': runSync(true); break;
    case 'sync-off': state.sync={on:false,fileId:null,last:null}; ui.sync={busy:false,error:null,needAuth:false}; gd.signOut(); scheduleSave(state); renderFoot(); toast('Odłączono Dysk Google. Piosenki zostają na tym urządzeniu.'); break;
    case 'sw-update': if(ui.update) ui.update.postMessage('skip-waiting'); break;
  }
});

$('#importFile').addEventListener('change',async e=>{
  const file=e.target.files[0]; if(!file) return;
  try{ui.importing={name:file.name,songs:await readBackup(file)}}
  catch(err){ui.importing=null;toast(err.message)}
  renderFoot();
});

document.addEventListener('input',e=>{
  const el=e.target, f=el.dataset.field; if(!f) return;
  if(f==='search'){ui.search=el.value;renderList();return}
  const song=cur(); if(!song) return;
  if(f==='kptext'){
    const kp=ui.keypad, s=secOf(song,kp.sid), tx=s.texts[kp.i];
    setText(s,kp.i,el.value.trim()?el.value:'',tx?tx.span:kp.span);
    const del=document.querySelector('[data-act="k-deltext"]'); if(del) del.disabled=!s.texts[kp.i];
    save(); renderEditor(); return;
  }
  const s=el.dataset.sid?secOf(song,el.dataset.sid):null;
  switch(f){
    case 'title': song.title=el.value; break;
    case 'bpm': {const v=parseInt(el.value,10); if(v>0&&v<=400) song.bpm=v; break;}
    case 'notes': song.notes=el.value; break;
    case 'sname': s.name=el.value; break;
    case 'sshort': s.short=el.value; break;
    case 'slyrics': s.lyrics=el.value; break;
    default: return;
  }
  save(); renderList();
});
document.addEventListener('change',e=>{
  const el=e.target, f=el.dataset.field, song=cur(); if(!f||!song) return;
  if(f==='sname'||f==='sshort'){const s=secOf(song,el.dataset.sid); if(f==='sshort'&&!s.short.trim()) s.short=s.name.slice(0,1).toUpperCase()||'?'; save(); requestAnimationFrame(renderAll)}
});

document.addEventListener('keydown',e=>{
  if(ui.keypad){
    if(e.target.id==='kpText'){if(e.key==='Escape'||e.key==='Enter'){e.preventDefault();kpClose()} return}
    const back=document.querySelector('[data-act="k-back"]');
    if(e.key==='Escape'||e.key==='Enter'){e.preventDefault();kpClose()}
    else if(e.key==='ArrowRight'){e.preventDefault();kpGo(1)}
    else if(e.key==='ArrowLeft'){e.preventDefault();kpGo(-1)}
    else if(e.key==='Backspace'&&back){e.preventDefault();back.click()}
    return;
  }
  if(ui.text!=null&&e.key==='Escape'){ui.text=null;renderText();return}
  if(ui.stage!=null){
    const n=cur().arrangement.length;
    if(e.key==='Escape'){ui.stage=null;renderStage();releaseWake()}
    else if(e.key==='ArrowRight'||e.key==='ArrowDown'||e.key===' '||e.key==='PageDown'){e.preventDefault();ui.stage=Math.min(n-1,ui.stage+1);renderStage()}
    else if(e.key==='ArrowLeft'||e.key==='ArrowUp'||e.key==='PageUp'){e.preventDefault();ui.stage=Math.max(0,ui.stage-1);renderStage()}
    return;
  }
  const chip=e.target.closest&&e.target.closest('.chip');
  if(chip&&(e.key==='Enter'||e.key===' ')){e.preventDefault();toggleSel(+chip.dataset.idx);const c=document.querySelector(`.chip[data-idx="${chip.dataset.idx}"]`);if(c)c.focus()}
});

/* przeciąganie bloków formy: mysz od razu, dotyk po przytrzymaniu */
let drag=null, ghost=null;
function toggleSel(idx){ui.sel=ui.sel===idx?null:idx;ui.confirm=null;renderEditor()}
function arm(){
  drag.armed=true; drag.el.classList.add('lifted');
  const r=drag.el.getBoundingClientRect();
  ghost=drag.el.cloneNode(true); ghost.classList.add('ghost'); ghost.classList.remove('sel','lifted');
  ghost.style.width=r.width+'px'; ghost.style.height=r.height+'px';
  document.body.appendChild(ghost); posGhost(drag.x,drag.y);
  try{navigator.vibrate&&navigator.vibrate(12)}catch(e){}
}
function posGhost(x,y){ghost.style.left=x+'px';ghost.style.top=y+'px'}
function updateMarker(x,y){
  const host=$('#chips'), mk=$('#dropMarker'), chips=[...host.querySelectorAll('.chip')];
  let best=null,bd=1e9;
  chips.forEach((c,k)=>{const r=c.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,dd=Math.hypot((x-cx)*0.8,(y-cy)*1.6);if(dd<bd){bd=dd;best={k,r,before:x<cx}}});
  if(!best) return;
  const hr=host.getBoundingClientRect();
  drag.target=best.before?best.k:best.k+1;
  mk.hidden=false;
  mk.style.left=((best.before?best.r.left-7:best.r.right+3)-hr.left)+'px';
  mk.style.top=(best.r.top-hr.top)+'px'; mk.style.height=best.r.height+'px';
}
function endDrag(){
  if(!drag) return; clearTimeout(drag.timer);
  if(ghost){ghost.remove();ghost=null}
  if(drag.el){drag.el.classList.remove('lifted','dragging')}
  const mk=$('#dropMarker'); if(mk) mk.hidden=true;
  drag=null;
}
document.addEventListener('pointerdown',e=>{
  const chip=e.target.closest('.chip'); if(!chip||e.button>0) return;
  drag={idx:+chip.dataset.idx,x:e.clientX,y:e.clientY,el:chip,armed:false,moved:false,type:e.pointerType,pid:e.pointerId,target:null,timer:null};
  if(e.pointerType!=='mouse') drag.timer=setTimeout(()=>{if(drag&&!drag.armed)arm()},240);
});
window.addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.pid) return;
  const dist=Math.hypot(e.clientX-drag.x,e.clientY-drag.y);
  if(!drag.armed){
    if(dist<7) return;
    if(drag.type==='mouse') arm(); else {endDrag();return}
  }
  if(!drag.moved){drag.moved=true;drag.el.classList.add('dragging')}
  posGhost(e.clientX,e.clientY); updateMarker(e.clientX,e.clientY);
});
window.addEventListener('pointerup',e=>{
  if(!drag||e.pointerId!==drag.pid) return;
  const {idx,moved,target}=drag; endDrag();
  if(moved&&target!=null){
    const arr=cur().arrangement; let to=target>idx?target-1:target;
    if(to!==idx){const [it]=arr.splice(idx,1);arr.splice(to,0,it)}
    ui.sel=to; commit();
  } else toggleSel(idx);
});
window.addEventListener('pointercancel',endDrag);
document.addEventListener('touchmove',e=>{if(drag&&drag.armed)e.preventDefault()},{passive:false});
document.addEventListener('contextmenu',e=>{if(e.target.closest('.chip'))e.preventDefault()});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&ui.stage!=null)requestWake()});

/* ---------- przycisk „wstecz” (Android): każda otwarta warstwa to wpis w historii ---------- */
const narrow=matchMedia('(max-width: 760px)');
function navDepthWanted(){
  return (ui.pane==='editor'&&narrow.matches?1:0)+(ui.stage!=null?1:0)+(ui.keypad?1:0)+(ui.text!=null?1:0);
}
let navDepth=0, ignorePops=0;
history.replaceState({d:0},'');
function syncNav(){
  const want=navDepthWanted();
  while(navDepth<want){navDepth++;history.pushState({d:navDepth},'')}
  if(want<navDepth){ignorePops++;history.go(want-navDepth);navDepth=want}
}
window.addEventListener('popstate',e=>{
  if(ignorePops>0){ignorePops--;return}
  const target=(e.state&&e.state.d)||0;
  navDepth=target;
  while(navDepthWanted()>target){
    if(ui.text!=null) ui.text=null;
    else if(ui.keypad){const s=secOf(cur(),ui.keypad.sid),tx=s&&s.texts[ui.keypad.i];if(tx)tx.t=tx.t.trim();ui.keypad=null;save()}
    else if(ui.stage!=null){ui.stage=null;releaseWake()}
    else if(ui.pane==='editor') ui.pane='list';
    else break;
  }
  renderAll();
});
// po każdej akcji użytkownika liczba wpisów w historii ma odpowiadać otwartym warstwom
narrow.addEventListener('change',syncNav);
document.addEventListener('click',()=>queueMicrotask(syncNav));
document.addEventListener('keydown',()=>queueMicrotask(syncNav));
window.addEventListener('pointerup',()=>queueMicrotask(syncNav));

/* ---------- instalacja, trwałość danych, service worker ---------- */
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();ui.install=e;renderFoot()});
window.addEventListener('appinstalled',()=>{ui.install=null;renderFoot();requestPersist().then(p=>{ui.persisted=p;renderFoot()})});
requestPersist().then(p=>{ui.persisted=p;renderFoot()});

if('serviceWorker' in navigator){
  // przeładowanie tylko przy zmianie wersji, nie przy pierwszej instalacji
  let reloading=!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(reloading)return;reloading=true;location.reload()});
  navigator.serviceWorker.register('sw.js').then(reg=>{
    const offer=w=>{ui.update=w;renderFoot()};
    if(reg.waiting&&navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound',()=>{
      const w=reg.installing; if(!w) return;
      w.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller) offer(w)});
    });
    // sprawdza aktualizację przy powrocie do aplikacji
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')reg.update().catch(()=>{})});
  }).catch(()=>{});
}

/* synchronizacja: przy starcie, po powrocie do aplikacji i po odzyskaniu internetu */
window.addEventListener('online',()=>runSync(false));
window.addEventListener('offline',renderFoot);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')runSync(false)});

if(!cur()&&state.songs[0]) state.currentId=state.songs[0].id;
if(!narrow.matches) ui.pane='editor';
renderAll();
syncNav();
if(syncOn()) runSync(false);
