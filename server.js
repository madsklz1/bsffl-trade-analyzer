
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;


const FP_KEY_FILE = path.join(__dirname, "fantasypros-key.txt");
function fantasyProsKey(){
  const envKey=String(process.env.FANTASYPROS_API_KEY||"").trim();
  if(envKey) return envKey;
  try { return fs.readFileSync(FP_KEY_FILE,"utf8").trim(); }
  catch { return ""; }
}
function publicError(source){
  return `${source} is temporarily unavailable. Cached data will be used when available.`;
}


const CACHE_DIR = path.join(__dirname, "cache");
try { fs.mkdirSync(CACHE_DIR, {recursive:true}); } catch {}

function cacheFile(key){ return path.join(CACHE_DIR, `${String(key).replace(/[^a-z0-9_.-]/gi,"_")}.json`); }
function readDiskCache(key){
  try{
    const x=JSON.parse(fs.readFileSync(cacheFile(key),"utf8"));
    if(x && x.data!==undefined) return x;
  }catch{}
  return null;
}
function writeDiskCache(key,data){
  try{
    fs.writeFileSync(cacheFile(key),JSON.stringify({savedAt:new Date().toISOString(),data},null,2),"utf8");
  }catch{}
}
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function fetchWithRetry(url, options={}, attempts=3, timeoutMs=12000){
  let lastErr;
  for(let i=0;i<attempts;i++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const r=await fetch(url,{...options,signal:controller.signal});
      clearTimeout(timer);
      if(r.ok)return r;
      lastErr=new Error(`HTTP ${r.status}`);
      if(r.status>=400 && r.status<500 && r.status!==408 && r.status!==429)break;
    }catch(e){
      clearTimeout(timer);
      lastErr=e;
    }
    if(i<attempts-1) await sleep(500*Math.pow(2,i));
  }
  throw lastErr||new Error("request failed");
}

async function cachedJsonWithTtl(key, ttlMs, liveFn){
  const f=path.join(CACHE_DIR,`${key}.json`);
  try{
    if(fs.existsSync(f)){
      const cached=JSON.parse(fs.readFileSync(f,"utf8"));
      const saved=Date.parse(cached?.savedAt||"");
      if(Number.isFinite(saved) && (Date.now()-saved)<ttlMs){
        return {data:cached.data,_source:"cache-fresh",_savedAt:cached.savedAt,_liveError:null};
      }
    }
  }catch{}
  try{
    const data=await liveFn();
    const savedAt=new Date().toISOString();
    fs.mkdirSync(CACHE_DIR,{recursive:true});
    fs.writeFileSync(f,JSON.stringify({savedAt,data},null,2));
    return {data,_source:"live",_savedAt:savedAt,_liveError:null};
  }catch(e){
    try{
      if(fs.existsSync(f)){
        const cached=JSON.parse(fs.readFileSync(f,"utf8"));
        return {data:cached.data,_source:"cache-stale",_savedAt:cached.savedAt,_liveError:e.message};
      }
    }catch{}
    throw e;
  }
}

async function resilientJson(key, liveFn, maxStaleDays=30){
  try{
    const data=await liveFn();
    writeDiskCache(key,data);
    return {data,_source:"live",_savedAt:new Date().toISOString()};
  }catch(e){
    const cached=readDiskCache(key);
    if(cached){
      const ageMs=Date.now()-new Date(cached.savedAt).getTime();
      if(ageMs <= maxStaleDays*86400000){
        return {data:cached.data,_source:"cache",_savedAt:cached.savedAt,_liveError:String(e.message||e)};
      }
    }
    throw e;
  }
}

const YEAR = process.env.MFL_YEAR || "2026";
const LEAGUE = process.env.MFL_LEAGUE || "42684";
const PUBLIC_DIR = path.join(__dirname, "public");
const VALUATION_FILE = path.join(__dirname, "valuation.json");


function readValuationConfig(){
  try { return JSON.parse(fs.readFileSync(VALUATION_FILE, "utf8")); }
  catch { return {settings:{}, players:{}, picks:{}}; }
}

async function mfl(type) {
  const url = `https://api.myfantasyleague.com/${YEAR}/export?TYPE=${encodeURIComponent(type)}&L=${encodeURIComponent(LEAGUE)}&JSON=1`;
  const r = await fetchWithRetry(url, {headers: { "User-Agent": "BSFFL-Trade-Analyzer-Prototype/1.0" }}, 3, 12000);
  if (!r.ok) throw new Error(`MFL ${type} request failed: ${r.status}`);
  return await r.json();
}


async function mflYear(year, type, params={}) {
  const qs = new URLSearchParams({TYPE:type, L:LEAGUE, JSON:"1", ...params});
  const url = `https://api.myfantasyleague.com/${year}/export?${qs.toString()}`;
  const r = await fetchWithRetry(url, {headers:{"User-Agent":"BSFFL-Trade-Analyzer/1.8"}}, 3, 12000);
  if(!r.ok) throw new Error(`MFL ${year} ${type} request failed: ${r.status}`);
  return await r.json();
}


const FP_BASE = "https://api.fantasypros.com/public/v2/json";
const fpCache = new Map();

async function fantasyPros(pathname, ttlMs=6*60*60_000) {
  const key = process.env.FANTASYPROS_API_KEY;
  if (!key) throw new Error("FANTASYPROS_API_KEY is not set in this Command Prompt.");
  const now=Date.now(), hit=fpCache.get(pathname);
  if(hit && now-hit.time<ttlMs) return hit.data;
  const r=await fetch(`${FP_BASE}${pathname}`, {headers:{"x-api-key":key,"User-Agent":"BSFFL-Trade-Analyzer/0.5"}});
  if(!r.ok) throw new Error(`FantasyPros request failed (${r.status}): ${await r.text()}`);
  const data=await r.json(); fpCache.set(pathname,{time:now,data}); return data;
}
function fpRankToValue(rank){
  rank=Number(rank||9999);
  if(rank<=0||rank>=9999)return 0;
  // Smooth 0-100 scale; top players remain meaningfully separated.
  return Math.max(0, 100*Math.exp(-(rank-1)/72));
}
async function buildFantasyProsValues(){
  const [fpPlayers, redraft, dynasty, mflPlayers] = await Promise.all([
    fantasyPros("/nfl/players?ecr=included&external_ids=mfl", 24*60*60_000),
    fantasyPros(`/nfl/${YEAR}/consensus-rankings?position=ALL&scoring=PPR&type=DRAFT`, 6*60*60_000),
    fantasyPros(`/nfl/${YEAR}/consensus-rankings?position=ALL&scoring=PPR&type=DYNASTY`, 12*60*60_000),
    cached("players", 6*60*60_000)
  ]);

  function normName(x){
    let raw=String(x||"").trim();
    if(raw.includes(",")){
      const parts=raw.split(",");
      if(parts.length>=2) raw=`${parts.slice(1).join(" ").trim()} ${parts[0].trim()}`;
    }
    return raw.toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g,"")
      .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g,"")
      .replace(/[^a-z0-9]/g,"");
  }
  function normPos(x){
    x=String(x||"").toUpperCase();
    if(x==="PK")return "K";
    if(x==="DST"||x==="D/ST")return "DEF";
    return x;
  }

  const mflList=mflPlayers?.players?.player||[];
  const byNamePos=new Map(), byName=new Map();
  for(const p of mflList){
    const n=normName(p.name), pos=normPos(p.position);
    if(!n)continue;
    byNamePos.set(`${n}|${pos}`,String(p.id));
    if(!byName.has(n))byName.set(n,[]);
    byName.get(n).push(String(p.id));
  }

  const fpIdToMfl=new Map();
  let directIdCount=0, fallbackMetadataCount=0;
  for(const p of (fpPlayers.players||[])){
    let mfl=p.mfl_id;
    if(mfl){
      fpIdToMfl.set(String(p.player_id),String(mfl));
      directIdCount++;
      continue;
    }
    const n=normName(p.player_name||p.name);
    const pos=normPos(p.position_id||p.player_position_id||p.position);
    mfl=byNamePos.get(`${n}|${pos}`);
    if(!mfl && (byName.get(n)||[]).length===1)mfl=byName.get(n)[0];
    if(mfl){fpIdToMfl.set(String(p.player_id),String(mfl));fallbackMetadataCount++}
  }

  const out={};
  let rankingFallbackCount=0;
  function apply(dataset,field){
    for(const p of (dataset.players||[])){
      let mfl=fpIdToMfl.get(String(p.player_id));
      if(!mfl){
        const n=normName(p.player_name||p.name);
        const pos=normPos(p.player_position_id||p.position_id||p.position);
        mfl=byNamePos.get(`${n}|${pos}`);
        if(!mfl && (byName.get(n)||[]).length===1)mfl=byName.get(n)[0];
        if(mfl)rankingFallbackCount++;
      }
      if(!mfl)continue;
      const rank=Number(p.rank_ecr ?? p.rank_ave ?? p.rank)||null;
      if(!rank)continue;
      out[String(mfl)] ||= {};
      out[String(mfl)][field]=fpRankToValue(rank);
      out[String(mfl)][`${field}Rank`]=rank;
      out[String(mfl)].name=p.player_name||p.name||"";
      out[String(mfl)].fpPlayerId=p.player_id;
    }
  }
  apply(redraft,"redraft");
  apply(dynasty,"dynasty");

  return {players:out, meta:{
    mappedPlayers:Object.keys(out).length,
    metadataWithDirectMflId:directIdCount,
    metadataFallbackMapped:fallbackMetadataCount,
    rankingFallbackMapped:rankingFallbackCount,
    fantasyProsMetadataCount:(fpPlayers.players||[]).length,
    redraftCount:(redraft.players||[]).length,
    dynastyCount:(dynasty.players||[]).length,
    redraftUpdated:redraft.last_updated||null,
    dynastyUpdated:dynasty.last_updated||null,
    redraftExperts:redraft.total_experts||null,
    dynastyExperts:dynasty.total_experts||null
  }};
}


const fcCache = new Map();
async function fantasyCalc(isDynasty, ttlMs=24*60*60_000){
  const key=isDynasty?"dynasty":"redraft", now=Date.now(), hit=fcCache.get(key);
  if(hit && now-hit.time<ttlMs)return hit.data;
  const url=`https://api.fantasycalc.com/values/current?isDynasty=${isDynasty?"true":"false"}&numQbs=1&numTeams=10&ppr=1`;
  const r=await fetch(url,{headers:{"User-Agent":"BSFFL-Trade-Analyzer/1.0"}});
  if(!r.ok)throw new Error(`FantasyCalc ${key} request failed: ${r.status}`);
  const data=await r.json(); fcCache.set(key,{time:now,data}); return data;
}
async function buildFantasyCalcValues(){
  const [red,dyn]=await Promise.all([fantasyCalc(false),fantasyCalc(true)]);
  const out={}, picks={};

  function normalizePickName(name){
    const m=String(name||"").match(/(\d{4})\s+Pick\s+(\d+)\.(\d+)/i);
    if(!m)return null;
    return `${m[1]}-${Number(m[2])}.${String(Number(m[3])).padStart(2,"0")}`;
  }
  function apply(rows,field){
    for(const x of (rows||[])){
      const p=x.player||{};
      const pickKey=normalizePickName(p.name);
      if(pickKey){
        picks[pickKey] ||= {name:p.name||pickKey};
        picks[pickKey][field]=Number(x.value||0);
        picks[pickKey][`${field}Rank`]=Number(x.overallRank||0)||null;
        continue;
      }

      const mfl=p.mflId;
      if(!mfl)continue;
      out[String(mfl)] ||= {name:p.name||"",position:p.position||""};
      out[String(mfl)][field]=Number(x.value||0);
      out[String(mfl)][`${field}Rank`]=Number(x.overallRank||0)||null;
      out[String(mfl)].trend30Day=Number(x.trend30Day||0);
    }
  }

  apply(red,"redraft");
  apply(dyn,"dynasty");

  const maxDynastyPlayer=Math.max(1,...Object.values(out).map(x=>Number(x.dynasty||0)));
  return {
    players:out,
    picks,
    meta:{
      mappedPlayers:Object.keys(out).length,
      exactPicks:Object.keys(picks).length,
      redraftCount:red?.length||0,
      dynastyCount:dyn?.length||0,
      maxDynastyPlayer
    }
  };
}

function normalizeCurrentDraftPicks(raw){
  const out=[], seen=new Set();
  function first(o,keys){for(const k of keys)if(o&&o[k]!==undefined&&o[k]!==null&&String(o[k])!=="")return o[k];return null}
  function walk(x,ctx={}){
    if(!x)return;
    if(Array.isArray(x)){for(const v of x)walk(v,ctx);return}
    if(typeof x!=="object")return;
    const nctx={...ctx};
    const did=first(x,["draft_id","draftId","id"]);
    if(did!==null && (x.draftPick||x.draftUnit||x.rounds))nctx.draftId=String(did);
    const round=Number(first(x,["round","roundNumber","round_number"])||0);
    const pick=Number(first(x,["pick","pickNumber","pick_number","pickNo","pick_no"])||0);
    const overall=Number(first(x,["overallPick","overall_pick","pickNumberOverall","pick_number_overall"])||0);
    const owner=first(x,["franchise","franchise_id","franchiseId","owner","owner_id","ownerId"]);
    const original=first(x,["originalPickFor","original_pick_for","originalFranchise","original_franchise","original_owner"]);
    const player=first(x,["player","player_id","playerId"]);
    if(round>0 && owner!==null){
      const ownerId=String(owner), origId=String(original??owner);
      const key=`${nctx.draftId||""}:${round}:${pick||overall||0}:${origId}:${ownerId}`;
      if(!seen.has(key)){
        seen.add(key);
        out.push({year:Number(YEAR),round:String(round),pick:pick||null,overall:overall||null,owner:ownerId,
          originalPickFor:origId,player:player?String(player):null,draftId:nctx.draftId||null});
      }
    }
    for(const v of Object.values(x))if(v&&typeof v==="object")walk(v,nctx);
  }
  walk(raw);
  return out.filter(p=>!p.player||p.player==="0");
}
async function buildCurrentDraftPicks(){
  const raw=await mflYear(YEAR,"draftResults").catch(()=>({}));
  const picks=normalizeCurrentDraftPicks(raw),byFranchise={};
  for(const p of picks){byFranchise[p.owner]||=[];byFranchise[p.owner].push(p)}
  return {picks,byFranchise,meta:{year:Number(YEAR),count:picks.length,source:"MFL draftResults"}};
}


let mflAdpCache={time:0,data:null};
async function buildMflAdp(){
  const now=Date.now();
  if(mflAdpCache.data && now-mflAdpCache.time<6*60*60_000)return mflAdpCache.data;
  const url=`https://api.myfantasyleague.com/${YEAR}/export?TYPE=adp&PERIOD=RECENT&FCOUNT=10&IS_PPR=1&IS_KEEPER=0&IS_MOCK=0&CUTOFF=5&DETAILS=&JSON=1`;
  const r=await fetchWithRetry(url,{headers:{"User-Agent":"BSFFL-Trade-Analyzer/1.8.1"}},3,12000);
  const raw=await r.json(), rows=raw?.adp?.player||[], players={};
  for(const x of rows)if(x.id)players[String(x.id)]={adp:Number(x.averagePick||0)||null,minPick:Number(x.minPick||0)||null,maxPick:Number(x.maxPick||0)||null,draftPct:Number(x.draftSelPct||0)||null};
  const data={players,meta:{count:Object.keys(players).length,period:"RECENT",teams:10,ppr:true,keeper:false,mock:false,cutoff:5}};
  mflAdpCache={time:now,data}; return data;
}

let bsfflModelCache={time:0,data:null};
function extractScoreRows(raw){
  const c=[raw?.playerScores?.playerScore,raw?.playerScores?.player,raw?.projectedScores?.playerScore,raw?.projectedScores?.player];
  for(const x of c)if(Array.isArray(x))return x; return [];
}
function scoreMapFromRaw(raw){
  const out={}; for(const x of extractScoreRows(raw)){const id=String(x.id??x.player_id??x.player??"");const score=Number(x.score??x.points??x.value??0);if(id)out[id]=Number.isFinite(score)?score:0} return out;
}
function normModelPos(p){p=String(p||"").toUpperCase();if(p==="PK"||p==="K")return"K";if(p==="DEF"||p==="DST"||p==="D/ST")return"DEF";return p}
function metricVorpScore(scoreMap,playerMeta){
  const groups={},replacement={QB:15,RB:30,WR:30,TE:15,K:10,DEF:10},vorp={};let maxV=0;
  for(const [id,score] of Object.entries(scoreMap||{})){const pos=normModelPos(playerMeta.get(String(id))?.position);if(!["QB","RB","WR","TE","K","DEF"].includes(pos))continue;(groups[pos]||=[]).push({id:String(id),score:Number(score)||0})}
  for(const [pos,rows] of Object.entries(groups)){rows.sort((a,b)=>b.score-a.score);const ix=Math.min(rows.length-1,Math.max(0,(replacement[pos]||10)-1));const repl=rows.length?rows[ix].score:0;for(const r of rows){const v=Math.max(0,r.score-repl);vorp[r.id]=v;if(v>maxV)maxV=v}}
  const out={};if(maxV<=0)return out;for(const [id,v] of Object.entries(vorp))out[id]=100*Math.sqrt(v/maxV);return out;
}
async function fetchProjectedForPlayers(ids){
  const merged={};for(let i=0;i<ids.length;i+=60){try{const raw=await mflYear(YEAR,"projectedScores",{PLAYERS:ids.slice(i,i+60).join(",")});Object.assign(merged,scoreMapFromRaw(raw))}catch{}}return merged;
}
async function buildBsfflModel(){
  const now=Date.now();if(bsfflModelCache.data&&now-bsfflModelCache.time<6*60*60_000)return bsfflModelCache.data;
  const [rostersRaw,playersRaw,h2025,h2024,current]=await Promise.all([cached("rosters",60000),cached("players",21600000),mflYear("2025","playerScores",{W:"YTD"}).catch(()=>({})),mflYear("2024","playerScores",{W:"YTD"}).catch(()=>({})),mflYear(YEAR,"playerScores",{W:"YTD"}).catch(()=>({}))]);
  const rosterIds=[];for(const f of(rostersRaw?.rosters?.franchise||[]))for(const p of(f.player||[]))if(p.id)rosterIds.push(String(p.id));const ids=[...new Set(rosterIds)];
  const projections=await fetchProjectedForPlayers(ids),metaList=playersRaw?.players?.player||[],metaMap=new Map(metaList.map(p=>[String(p.id),p]));
  const raw25=scoreMapFromRaw(h2025),raw24=scoreMapFromRaw(h2024),rawCur=scoreMapFromRaw(current);
  const m25=metricVorpScore(raw25,metaMap),m24=metricVorpScore(raw24,metaMap),mCur=metricVorpScore(rawCur,metaMap),mProj=metricVorpScore(projections,metaMap);
  const hasCurrent=Object.values(rawCur).some(x=>Number(x)>0),weights=hasCurrent?{current:.35,projection:.25,y2025:.30,y2024:.10}:{projection:.40,y2025:.45,y2024:.15},players={};
  for(const id of ids){const components={current:mCur[id]??null,projection:mProj[id]??null,y2025:m25[id]??null,y2024:m24[id]??null};let num=0,den=0;for(const[k,w]of Object.entries(weights)){const v=components[k];if(v!==null&&Number.isFinite(v)){num+=v*w;den+=w}}if(den>0){const meta=metaMap.get(id)||{};players[id]={score:num/den,rank:null,name:meta.name||id,position:meta.position||"",team:meta.team||"",components}}}
  Object.entries(players).sort((a,b)=>b[1].score-a[1].score).forEach(([id,x],i)=>x.rank=i+1);
  const data={players,meta:{mappedPlayers:Object.keys(players).length,refreshHours:6,currentSeasonDataUsed:hasCurrent,weights,note:"Beta verification model. It does not affect the trade score yet."}};
  bsfflModelCache={time:now,data};return data;
}


async function fpGet(pathname){
  const key=fantasyProsKey();
  if(!key) throw new Error("FantasyPros key file missing or empty");
  const url=`https://api.fantasypros.com/public/v2/json${pathname}`;
  const r=await fetchWithRetry(url,{headers:{"x-api-key":key,"User-Agent":"BSFFL-Trade-Analyzer/1.9"}},3,12000);
  return await r.json();
}
function fpExternalMflId(p){
  const direct=p?.mflid ?? p?.mfl_id ?? p?.player_mfl_id ?? p?.external_ids?.mfl ?? p?.externalIds?.mfl;
  if(direct!==undefined && direct!==null && String(direct)!=="") return String(direct);
  const ext=p?.external_ids ?? p?.externalIds;
  if(Array.isArray(ext)){
    const x=ext.find(v=>String(v?.source||v?.type||v?.provider||"").toLowerCase()==="mfl");
    if(x) return String(x.id??x.value??x.external_id??"");
  }
  return "";
}
function fpId(p){
  return String(
    p?.player_id ?? p?.fpid ?? p?.player?.player_id ?? p?.player?.fpid ?? p?.id ?? ""
  );
}
function fpRankRows(rows){
  const out={};
  for(const p of (rows||[])){
    const id=fpId(p);
    if(!id)continue;
    const rank=Number(
      p.rank_ecr ?? p.rank ?? p.ecr ??
      p?.rankings?.ecr ?? p?.player?.rank_ecr ?? p?.player?.rank ?? 0
    )||null;
    out[id]={
      fpid:id,
      name:p.player_name||p?.player?.player_name||p.name||p?.player?.name||"",
      rank,
      pos:p.player_position_id||p?.player?.player_position_id||p.position_id||p.position||p?.player?.position||"",
      team:p.player_team_id||p?.player?.player_team_id||p.team_id||p.team||p?.player?.team||""
    };
  }
  return out;
}
function fpPlayersArray(j){
  if(Array.isArray(j?.players)) return j.players;
  if(Array.isArray(j?.rankings)) return j.rankings;
  if(Array.isArray(j?.data?.players)) return j.data.players;
  if(Array.isArray(j?.data?.rankings)) return j.data.rankings;
  return [];
}
async function buildFantasyProsProduction(){
  // One player-metadata request supplies the FantasyPros -> MFL crosswalk.
  // external_ids=mfl is explicitly supported by the public v2 API.
  const pj=await fpGet(`/nfl/players?external_ids=mfl&ecr=included`);
  const fpToMfl={};
  for(const p of fpPlayersArray(pj)){
    const fpid=fpId(p), mfl=fpExternalMflId(p);
    if(fpid && mfl) fpToMfl[fpid]=mfl;
  }
  await sleep(1050);

  const positions=["QB","RB","WR","TE","K","DST"];
  const redraftByFp={}, dynastyByFp={};
  let totalExpertsRedraft=0,totalExpertsDynasty=0;

  for(const pos of positions){
    const j=await fpGet(`/nfl/${YEAR}/consensus-rankings?position=${pos}&scoring=PPR`);
    totalExpertsRedraft=Math.max(totalExpertsRedraft,Number(j.total_experts||0));
    Object.assign(redraftByFp,fpRankRows(fpPlayersArray(j)));
    await sleep(1050);
  }

  // Current public docs describe Dynasty as a consensus ranking type.
  // The API historically accepts DK for NFL Dynasty; use DK and validate the response type.
  for(const pos of ["QB","RB","WR","TE"]){
    const j=await fpGet(`/nfl/${YEAR}/consensus-rankings?position=${pos}&scoring=PPR&type=DK`);
    totalExpertsDynasty=Math.max(totalExpertsDynasty,Number(j.total_experts||0));
    Object.assign(dynastyByFp,fpRankRows(fpPlayersArray(j)));
    await sleep(1050);
  }

  const players={};
  let unmapped=0;
  for(const fpid of new Set([...Object.keys(redraftByFp),...Object.keys(dynastyByFp)])){
    const mfl=fpToMfl[fpid];
    if(!mfl){unmapped++;continue;}
    const r=redraftByFp[fpid],d=dynastyByFp[fpid];
    players[mfl]={
      fpid,
      name:r?.name||d?.name||"",
      position:r?.pos||d?.pos||"",
      team:r?.team||d?.team||"",
      redraft:r?.rank||null,
      dynasty:d?.rank||null
    };
  }
  return {players,meta:{
    mappedPlayers:Object.keys(players).length,
    unmappedPlayers:unmapped,
    playerCrosswalk:Object.keys(fpToMfl).length,
    redraftRanked:Object.values(redraftByFp).filter(x=>x.rank).length,
    dynastyRanked:Object.values(dynastyByFp).filter(x=>x.rank).length,
    redraftPlayers:Object.keys(redraftByFp).length,
    dynastyPlayers:Object.keys(dynastyByFp).length,
    totalExpertsRedraft,totalExpertsDynasty,
    tier:"premium-production",
    endpoint:"public/v2/json",
    mapping:"FantasyPros fpid -> players external_ids=mfl"
  }};
}
function send(res,status,body,type="application/json"){
  res.writeHead(status,{
    "Content-Type":type,
    "Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff",
    "X-Frame-Options":"SAMEORIGIN",
    "Referrer-Policy":"no-referrer"
  });
  res.end(body);
}

const cache = new Map();
async function cached(type, ttlMs=60000) {
  const now = Date.now();
  const hit = cache.get(type);
  if (hit && (now - hit.time) < ttlMs) return hit.data;
  const data = await mfl(type);
  cache.set(type, { time: now, data });
  return data;
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host}`);
    if (u.pathname.includes("-debug")) {
      return send(res,404,JSON.stringify({error:"Not found"}));
    }
    if (u.pathname === "/api/health") {
      return send(res,200,JSON.stringify({
        status:"ok",
        version:"3.0",
        league:LEAGUE,
        season:YEAR,
        fantasyProsConfigured:Boolean(fantasyProsKey()),
        timestamp:new Date().toISOString()
      }));
    }
    if (u.pathname === "/api/fantasypros-rb-debug") {
      try {
        const [redraftRB,dynastyRB] = await Promise.all([
          fantasyPros(`/nfl/${YEAR}/consensus-rankings?position=RB&scoring=PPR&type=DRAFT`, 6*60*60_000),
          fantasyPros(`/nfl/${YEAR}/consensus-rankings?position=RB&scoring=PPR&type=DYNASTY`, 12*60*60_000)
        ]);
        const summarize=x=>({
          count:x.count ?? null,
          returned:Array.isArray(x.players)?x.players.length:0,
          totalExperts:x.total_experts ?? null,
          limited:x.public_api_limited ?? null,
          tier:x.tier ?? null,
          first:x.players?.[0]?.player_name ?? null,
          last:x.players?.[x.players.length-1]?.player_name ?? null
        });
        return send(res,200,JSON.stringify({
          redraftRB:summarize(redraftRB),
          dynastyRB:summarize(dynastyRB)
        },null,2));
      } catch(e) {
        return send(res,502,JSON.stringify({error:e.message}));
      }
    }
    if (u.pathname === "/api/fantasypros-mfl-debug") {
      try {
        const fp=await fantasyPros("/nfl/players?ecr=included&external_ids=mfl", 24*60*60_000);
        const sample=(fp.players||[]).find(p=>p.player_name==="TreVeyon Henderson") || (fp.players||[])[0] || null;
        return send(res,200,JSON.stringify({
          count:fp.count||0,
          samplePlayer:sample,
          sampleKeys:sample?Object.keys(sample):[]
        },null,2));
      } catch(e) {
        return send(res,502,JSON.stringify({error:e.message}));
      }
    }
    if (u.pathname === "/api/fantasypros-debug") {
      try {
        const [fpPlayers, redraft, dynasty] = await Promise.all([
          fantasyPros("/nfl/players?ecr=included&external_ids=mfl", 24*60*60_000),
          fantasyPros(`/nfl/${YEAR}/consensus-rankings?position=ALL&scoring=PPR&type=DRAFT`, 6*60*60_000),
          fantasyPros(`/nfl/${YEAR}/consensus-rankings?position=ALL&scoring=PPR&type=DYNASTY`, 12*60*60_000)
        ]);
        const shape=x=>({
          topLevelKeys:Object.keys(x||{}),
          playersIsArray:Array.isArray(x?.players),
          playersType:typeof x?.players,
          playersKeys:(x?.players && !Array.isArray(x.players) && typeof x.players==="object")?Object.keys(x.players).slice(0,20):[],
          firstPlayer:Array.isArray(x?.players)?x.players[0]:
            (Array.isArray(x?.players?.player)?x.players.player[0]:
            (Array.isArray(x?.rankings)?x.rankings[0]:
            (Array.isArray(x?.rankings?.player)?x.rankings.player[0]:null)))
        });
        return send(res,200,JSON.stringify({
          playerEndpoint:shape(fpPlayers),
          redraftEndpoint:shape(redraft),
          dynastyEndpoint:shape(dynasty)
        },null,2));
      } catch(e) {
        return send(res,502,JSON.stringify({error:e.message}));
      }
    }
    if (u.pathname === "/api/current-draft-picks") {
      try {
        const rr=await resilientJson("current-draft-picks", async()=>await buildCurrentDraftPicks(), 7);
        return send(res,200,JSON.stringify({...rr.data,_resilience:{source:rr._source,savedAt:rr._savedAt,liveError:rr._liveError||null}}));
      } catch(e){ return send(res,502,JSON.stringify({error:e.message})); }
    }
    if (u.pathname === "/api/bsffl-model") {
      try {
        const rr=await resilientJson("bsffl-model", async()=>await buildBsfflModel(), 30);
        const payload={...rr.data,_resilience:{source:rr._source,savedAt:rr._savedAt,liveError:rr._liveError||null}};
        return send(res,200,JSON.stringify(payload));
      } catch(e){ console.error("BSFFL Model:",e.message); return send(res,502,JSON.stringify({error:publicError("BSFFL Model")})); }
    }
    if (u.pathname === "/api/mfl-adp") {
      try {
        const rr=await resilientJson("mfl-adp", async()=>await buildMflAdp(), 30);
        const payload={...rr.data,_resilience:{source:rr._source,savedAt:rr._savedAt,liveError:rr._liveError||null}};
        return send(res,200,JSON.stringify(payload));
      } catch(e){ console.error("MFL ADP:",e.message); return send(res,502,JSON.stringify({error:publicError("MFL ADP")})); }
    }
    if (u.pathname === "/api/fantasycalc") {
      try {
        const rr=await resilientJson("fantasycalc", async()=>await buildFantasyCalcValues(), 30);
        const payload={...rr.data,_resilience:{source:rr._source,savedAt:rr._savedAt,liveError:rr._liveError||null}};
        return send(res,200,JSON.stringify(payload));
      } catch(e){ console.error("FantasyCalc:",e.message); return send(res,502,JSON.stringify({error:publicError("FantasyCalc")})); }
    }
    if (u.pathname === "/api/fantasypros") {
      try {
        const rr=await cachedJsonWithTtl("fantasypros-production-v4", 6*60*60*1000, async()=>await buildFantasyProsProduction());
        return send(res,200,JSON.stringify({...rr.data,_resilience:{source:rr._source,savedAt:rr._savedAt,liveError:rr._liveError?publicError("FantasyPros"):null}}));
      } catch(e){ console.error("FantasyPros:",e.message); return send(res,502,JSON.stringify({error:publicError("FantasyPros")})); }
    }
    if (u.pathname === "/api/valuation") {
      return send(res, 200, JSON.stringify(readValuationConfig()));
    }
    if (u.pathname === "/api/bootstrap") {
      try{
        const rr=await cachedJsonWithTtl("bootstrap-production-v1",60_000,async()=>{
          const [league, rosters, picks, currentDraftPicks, players, salaries] = await Promise.all([
            cached("league", 5 * 60_000),
            cached("rosters", 60_000),
            cached("futureDraftPicks", 60_000),
            buildCurrentDraftPicks(),
            cached("players", 6 * 60 * 60_000),
            cached("salaries", 60_000)
          ]);
          return {league,rosters,picks,currentDraftPicks,players,salaries};
        });
        return send(res,200,JSON.stringify({...rr.data,_resilience:{source:rr._source,savedAt:rr._savedAt,liveError:rr._liveError?publicError("MFL"):null}}));
      }catch(e){
        return send(res,503,JSON.stringify({error:publicError("MFL")}));
      }
    }

    let filePath = u.pathname === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, u.pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, "Forbidden", "text/plain");
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return send(res, 404, "Not found", "text/plain");

    const ext = path.extname(filePath).toLowerCase();
    const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"application/javascript; charset=utf-8" };
    return send(res, 200, fs.readFileSync(filePath), types[ext] || "application/octet-stream");
  } catch (e) {
    console.error(e);
    return send(res, 500, JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => {
  console.log(`BSFFL Trade Analyzer prototype: http://localhost:${PORT}`);
  console.log(`MFL league ${LEAGUE}, season ${YEAR}`);
});
