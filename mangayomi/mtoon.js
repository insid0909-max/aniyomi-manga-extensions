const mangayomiSources = [{"id":870214019,"name":"머니툰 웹툰","lang":"ko","baseUrl":"https://mtoon165.asia","apiUrl":"","iconUrl":"https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/icon/eu.kanade.tachiyomi.extension.ko.newxtoon.png","typeSource":"single","itemType":0,"isNsfw":true,"hasCloudflare":false,"version":"0.1.27","dateFormat":"","dateFormatLocale":"","pkgPath":"mtoon.js"}];
const MT_WV_PENDING = {};
const MT_COVERS = {};
function mtListScript(page,query,options){return '('+function(page,query,options){
    if(window.__mtListStarted)return;window.__mtListStarted=true;
    const host=String(location.hostname||'').toLowerCase(),pathName=String(location.pathname||'').slice(0,60);
    const site=/^(?:www\.)?mtoon\d+\.asia$/.test(host)&&location.protocol==='https:';
    let done=false;const send=x=>{if(done)return;done=true;x.host=host;x.path=site?pathName:'';x.protocol=String(location.protocol||'');window.flutter_inappwebview.callHandler('setResponse',JSON.stringify(x));};
    if(!site){send({stage:'허용 범위 밖 웹뷰 주소'});return;}
    const mark=Array.from(document.images).some(x=>String(x.getAttribute('src')||'').includes('money_toon.png'));
    if(!mark){send({stage:'머니툰 로고 미확인'});return;}
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);
    const offset=(page-1)*30,o=options||{state:'연재중',day:'8',genre:''};const path=query?'/more.php?search='+encodeURIComponent(query)+'&c='+offset:'/more.php?wt_fin='+encodeURIComponent(o.state)+(o.genre?'&cate='+encodeURIComponent(o.genre):'&w='+encodeURIComponent(o.day))+'&c='+offset;
    const one=p=>fetch(p,{method:'POST',credentials:'same-origin',headers:{'X-Requested-With':'XMLHttpRequest'},signal:controller.signal}).then(async r=>{
        const responseUrl=new URL(r.url||p,location.origin);
        if(responseUrl.origin!==location.origin)return {fail:'목록 응답 출처 변경',status:r.status};
        if(!r.ok)return {fail:'목록 HTTP 오류',status:r.status};
        let data;try{data=JSON.parse(await r.text());}catch(_){return {fail:'목록 JSON 아님',status:r.status};}
        if(!Array.isArray(data))return {fail:'목록 배열 아님',status:r.status};
        return {data:data,status:r.status};
    });
    // 사이트 검색은 기본으로 연재 중 작품만 찾음 → 검색어가 있으면 완결(wt_fin=완결)도 같이 찾아 합침 (완결 쪽 실패는 무시)
    Promise.all([one(path),query?one(path+'&wt_fin='+encodeURIComponent('완결')).catch(()=>({data:[]})):Promise.resolve({data:[]})]).then(([a,b])=>{
        if(a.fail){send({stage:a.fail,status:a.status});return;}
        const r={status:a.status};const seen={},both=a.data.concat(Array.isArray(b.data)?b.data:[]).filter(x=>x&&typeof x==='object'&&!seen[x.wt_idx]&&(seen[x.wt_idx]=true));
        const count=Math.max(a.data.length,Array.isArray(b.data)?b.data.length:0),data=both;
        const rows=data.slice(0,60).filter(x=>x&&typeof x==='object').map(x=>{
            let image='';try{if(x.wt_thumb){const u=new URL(String(x.wt_thumb),location.origin+(/^[^/?:#]+\.(?:jpe?g|png|webp|gif)(?:[?#].*)?$/i.test(String(x.wt_thumb))?'/img/data/webtoon/':'/'));if(/^https?:$/.test(u.protocol))image=u.href;}}catch(_){}
            let dom='';for(const a of document.querySelectorAll('a[href]')){try{const u=new URL(a.href,location.href);if(u.pathname==='/list.php'&&u.searchParams.get('i')===String(x.wt_idx)){const im=a.querySelector('img')||(a.parentElement&&a.parentElement.querySelector('img'));if(im){dom=im.currentSrc||im.src||'';break;}}}catch(_){}}
            return {id:String(x.wt_idx||''),name:String(x.wt_title||''),imageUrl:image,meta:{author:String(x.wt_author||'').trim(),genre:String(x.wt_genre||'').trim(),description:new DOMParser().parseFromString(String(x.wt_intro||''),'text/html').body.textContent.trim(),state:String(x.wt_fin||'').trim()},raw:String(x.wt_thumb||'').split(/[?#]/)[0].slice(0,400),dom:String(dom).split(/[?#]/)[0].slice(0,400)};
        });

        send({stage:'ok',origin:location.origin,status:r.status,count:count,rows:rows});
    }).catch(e=>send({stage:e&&e.name==='AbortError'?'목록 요청 8초 초과':'목록 fetch 실패'})).finally(()=>clearTimeout(timer));
}.toString()+')('+JSON.stringify(page)+','+JSON.stringify(query)+','+JSON.stringify(options||null)+');';}
async function mtFirstList(page,query,options){
    if(typeof evaluateJavascriptViaWebview!=='function')throw new Error('WV 0.1.26: 웹뷰 함수 없음');
    let timer,value;try{
        value=await Promise.race([evaluateJavascriptViaWebview(mtBase11()+'/',{},[mtListScript(page,query,options)],20),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('WV 0.1.26: 웹뷰 전체 24초 초과')),24000);})]);
    }catch(e){if(e&&String(e.message||'').startsWith('WV 0.1.26:'))throw e;throw new Error('WV 0.1.26: 웹뷰 호출 실패');}
    finally{if(timer&&typeof clearTimeout==='function')clearTimeout(timer);}
    if(value==null||value==='')throw new Error('WV 0.1.26: 웹뷰 빈 응답');
    let data=value;for(let i=0;i<2&&typeof data==='string';i++){try{data=JSON.parse(data);}catch(_){throw new Error('WV 0.1.26: 반환 JSON 해석 실패');}}
    if(!data||data.stage!=='ok'){const address=data?String(data.protocol||'')+'//'+String(data.host||'').replace(/[^a-zA-Z0-9.:-]/g,'').slice(0,80)+String(data.path||'').slice(0,60):'';throw new Error('WV 0.1.26: '+String(data&&data.stage||'예상 밖 반환').slice(0,40)+' | '+address+(data&&data.status?' HTTP '+Number(data.status):''));}
    if(!/^https:\/\/(?:www\.)?mtoon\d+\.asia$/.test(String(data.origin||'')))throw new Error('WV 0.1.26: 반환 출처 검증 실패');
    if(!Array.isArray(data.rows))throw new Error('WV 0.1.26: 반환 목록 없음');
    const list=data.rows.filter(x=>x&&/^\d+$/.test(String(x.id))&&x.name).map(x=>({name:String(x.name),imageUrl:String(x.imageUrl||''),link:data.origin+'/list.php?i='+x.id}));
    if(!list.length&&Number(data.count)>0)throw new Error('WV 0.1.26: 목록 항목 해석 실패 (원본 '+Number(data.count)+'개)');
    data.rows.forEach(x=>{if(!x||!/^\d+$/.test(String(x.id)))return;const c={meta:x.meta||null,name:String(x.name||''),image:String(x.imageUrl||''),raw:x.raw||'',dom:x.dom||'',state:x.coverState||'미검사 (첫 3개만 검사)'};MT_COVERS[String(x.id)]=c;try{new SharedPreferences().setString('mt_meta10_'+x.id,JSON.stringify(c));}catch(_){}});
    mtRemember11(data.origin);
    return {list:list,hasNextPage:Number(data.count)>=30};
}
class DefaultExtension extends MProvider{
    getBaseUrl(){return mtBase11();}
    async getPopular(page){return await mtPaged08(page,'',mtRule11('popular'));}
    async getLatestUpdates(page){return await mtPaged08(page,'',mtRule11('latest'));}
    getFilterList(){const select=(type,name,rows)=>({type_name:'SelectFilter',type:type,param:type,name:name,state:0,values:rows.map(x=>({type_name:'SelectOption',name:x[0],value:x[1]}))});return [{type_name:'HeaderFilter',name:'제목 입력 시 검색 우선 · 장르 선택 시 요일 대신 장르 적용'},select('state','연재 상태',MT_STATES09),select('day','요일',MT_DAYS09),select('genre','장르',MT_GENRES09),{type_name:'HeaderFilter',name:'현재 주소: '+mtBase11()},{type_name:'HeaderFilter',name:'인기: '+mtRuleLabel11('popular')+' · 최신: '+mtRuleLabel11('latest')},select('rule','탭 조건 저장',MT_RULES11)];}
    async search(query,page,filters){const q=String(query||'').trim(),options=mtRawRule11(filters),result=await mtPaged08(page,q,options);if(!q&&Number(page==null?1:page)===1)mtApplyRule11(filters,options);return result;}
    async getDetail(url){return await mtDetail10(url);}
    async getPageList(url){return await mtRead07(url,'pages');}
}

function mtReaderScript07(mode,id){return '('+function(mode,id){
    if(window.__mtRead07)return;window.__mtRead07=true;let done=false,tries=0;
    const send=x=>{if(done)return;done=true;window.flutter_inappwebview.callHandler('setResponse',JSON.stringify(x));};
    const abs=v=>{try{const u=new URL(v,location.href);return /^https?:$/.test(u.protocol)?u.href:'';}catch(_){return '';}};
    const image=el=>el?abs(el.getAttribute('data-src')||el.getAttribute('data-original')||el.getAttribute('src')||''):'';
    function mtDate10(t,now){
    t=String(t||'').trim();const day=86400000,n=now==null?Date.now():Number(now),mid=Math.floor((n+32400000)/day)*day-32400000;let m;
    if(/^오늘/.test(t)||/\d+\s*(시간|분|초)\s*전/.test(t))return String(mid);
    if(/^어제/.test(t))return String(mid-day);
    if((m=/^(\d+)\s*일\s*전/.exec(t)))return String(mid-Number(m[1])*day);
    if((m=/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(t))){const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]),u=Date.UTC(y,mo-1,d),v=new Date(u);if(v.getUTCFullYear()===y&&v.getUTCMonth()===mo-1&&v.getUTCDate()===d)return String(u-32400000);}
    return null;
}
    const run=()=>{
        if(done)return;tries++;
        if(location.protocol!=='https:'||!/^(?:www\.)?mtoon\d+\.asia$/.test(location.hostname)){send({error:'허용 범위 밖 페이지'});return;}
        const here=new URL(location.href),key=mode==='detail'?'i':'wi';
        if(here.searchParams.get(key)!==id){send({error:'작품 또는 회차 주소 변경'});return;}
        if(mode==='detail'){
            const title=document.querySelector('h1.list_page_title'),links=Array.from(document.querySelectorAll('.list_data .l_d_t a[href]'));
            const seen=new Set(),chapters=[];for(const a of links){const link=abs(a.getAttribute('href'));if(!link)continue;const u=new URL(link);if(u.origin!==location.origin||u.pathname!=='/detail.php'||!/^\d+$/.test(u.searchParams.get('wi')||'')||seen.has(link))continue;seen.add(link);const name=String(a.textContent||'').replace(/\s+/g,' ').trim();if(name)chapters.push({name:name,url:link,dateUpload:mtDate10(String(((a.closest('li')&&a.closest('li').querySelector('.l_d_d'))||{}).textContent||''))});}
            if(title&&chapters.length){send({detail:{name:String(title.textContent||'').trim(),imageUrl:image(document.querySelector('.list_page_head img')),description:String((document.querySelector('.list_page_head p')||{}).textContent||'').trim(),chapters:chapters}});return;}
        }else{
            const urls=[],seen=new Set();for(const im of document.images){const u=image(im);if(!u)continue;const parsed=new URL(u);if(!/\/data\/file\//i.test(parsed.pathname)||/\/ban\/|money_toon/i.test(u)||seen.has(u))continue;seen.add(u);urls.push(u);}
            if(urls.length&&document.readyState==='complete'){send({pages:urls});return;}
        }
        if(tries>=30){send({error:mode==='detail'?'작품 회차 추출 12초 초과 (회차 링크 '+document.querySelectorAll('a[href*="detail.php"]').length+'개)':'본문 이미지 추출 12초 초과 (전체 이미지 '+document.images.length+'개)'});return;}
        setTimeout(run,400);
    };run();
}.toString()+')('+JSON.stringify(mode)+','+JSON.stringify(id)+');';}
async function mtRead07(url,mode){
    const text=String(url||''),m=/^https:\/\/(?:www\.)?mtoon\d+\.asia\/(list|detail)\.php\?(?:[^#]*&)?(i|wi)=(\d+)(?:&[^#]*)?$/.exec(text);
    if(!m||(mode==='detail'?(m[1]!=='list'||m[2]!=='i'):(m[1]!=='detail'||m[2]!=='wi')))throw new Error('WV 0.1.26: 작품/회차 주소 형식 오류');
    if(typeof evaluateJavascriptViaWebview!=='function')throw new Error('WV 0.1.26: 웹뷰 함수 없음');
    let timer,value;try{value=await Promise.race([evaluateJavascriptViaWebview(text,{},[mtReaderScript07(mode,m[3])],20),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('WV 0.1.26: 작품/회차 웹뷰 24초 초과')),24000);})]);}finally{if(timer&&typeof clearTimeout==='function')clearTimeout(timer);}
    for(let n=0;n<2&&typeof value==='string';n++){try{value=JSON.parse(value);}catch(_){throw new Error('WV 0.1.26: 작품/회차 JSON 해석 실패');}}
    if(!value||value.error)throw new Error('WV 0.1.26: '+String(value&&value.error||'빈 응답'));
    if(mode==='detail'){if(!value.detail||!Array.isArray(value.detail.chapters)||!value.detail.chapters.length)throw new Error('WV 0.1.26: 유효한 회차 없음');return value.detail;}
    if(!Array.isArray(value.pages)||!value.pages.length)throw new Error('WV 0.1.26: 본문 이미지 없음');return value.pages;
}

async function mtPaged08(page,query,options){options=mtOptions11(options);const n=Number(page==null?1:page);if(!Number.isSafeInteger(n)||n<1||n>100000)throw new Error('WV 0.1.26: 잘못된 페이지 번호');const key=JSON.stringify([n,query,options||null]);if(!MT_WV_PENDING[key])MT_WV_PENDING[key]=mtFirstList(n,query,options).finally(()=>{delete MT_WV_PENDING[key];});return await MT_WV_PENDING[key];}

const MT_STATES09 = [["연재", "연재중"], ["완결", "완결"]];
const MT_DAYS09 = [["UP (최근 업데이트)", "8"], ["월", "1"], ["화", "2"], ["수", "3"], ["목", "4"], ["금", "5"], ["토", "6"], ["일", "0"], ["열흘", "7"], ["오늘 요일", "today"]];
const MT_GENRES09 = [["전체 (요일로 보기)", ""], ["판타지", "판타지"], ["액션", "액션"], ["개그", "개그"], ["미스터리", "미스터리"], ["로맨스", "로맨스"], ["드라마", "드라마"], ["무협", "무협"], ["스포츠", "스포츠"], ["일상", "일상"], ["학원", "학원"], ["성인", "성인"], ["BL", "BL"], ["SF", "SF"], ["시대극", "시대극"], ["기타", "기타"]];

function mtFilter09(filters){
    const rows=Array.isArray(filters)?filters:[];
    const pick=(key,name,values)=>{const f=rows.find(x=>x&&(x.type===key||x.param===key||x.name===name)),i=f?Number(f.state):0;return values[Number.isInteger(i)&&i>=0&&i<values.length?i:0][1];};
    const day=pick('day','요일',MT_DAYS09);return {state:pick('state','연재 상태',MT_STATES09),day:day==='today'?String(new Date(Date.now()+9*3600000).getUTCDay()):day,genre:pick('genre','장르',MT_GENRES09)};
}

async function mtDetail10(url){
    const detail=await mtRead07(url,'detail'),id=(/[?&]i=(\d+)/.exec(String(url))||[])[1];let saved=MT_COVERS[id];
    if(!saved){try{saved=JSON.parse(new SharedPreferences().get('mt_meta10_'+id)||'null');}catch(_){}}
    const m=saved&&saved.meta;if(!m)return detail;
    if(m.author)detail.author=String(m.author);
    if(m.genre)detail.genre=String(m.genre).split(/[,|/]+/).map(x=>x.trim()).filter(Boolean);
    if(!detail.description&&m.description)detail.description=String(m.description);
    detail.status=m.state==='완결'?1:m.state==='연재중'||m.state==='연재'?0:5;
    return detail;
}

const MT_RULES11=[['저장하지 않음','0'],['현재 조건을 인기 탭에 저장','1'],['현재 조건을 최신 탭에 저장','2'],['인기 탭 기본값 복원','3'],['최신 탭 기본값 복원','4'],['두 탭 기본값 복원','5']];
let MT_ORIGIN11='';
function mtBase11(){let s=MT_ORIGIN11;try{s=s||String(new SharedPreferences().get('mt_origin11')||'');}catch(_){}return /^https:\/\/(?:www\.)?mtoon\d+\.asia$/.test(s)?s:'https://mtoon165.asia';}
function mtRemember11(origin){const s=String(origin||'');if(!/^https:\/\/(?:www\.)?mtoon\d+\.asia$/.test(s))return;MT_ORIGIN11=s;try{new SharedPreferences().setString('mt_origin11',s);}catch(_){}}
function mtValidRule11(o){return o&&MT_STATES09.some(x=>x[1]===o.state)&&MT_DAYS09.some(x=>x[1]===o.day)&&MT_GENRES09.some(x=>x[1]===o.genre);}
function mtRule11(tab){try{const o=JSON.parse(new SharedPreferences().get('mt_rule11_'+tab)||'null');return mtValidRule11(o)?o:null;}catch(_){return null;}}
function mtOptions11(o){if(!mtValidRule11(o))return null;return {state:o.state,day:o.day==='today'?String(new Date(Date.now()+32400000).getUTCDay()):o.day,genre:o.genre};}
function mtRawRule11(filters){const o=mtFilter09(filters),f=(Array.isArray(filters)?filters:[]).find(x=>x&&(x.type==='day'||x.param==='day'||x.name==='요일'));if(f&&Number(f.state)===MT_DAYS09.findIndex(x=>x[1]==='today'))o.day='today';return o;}
function mtRuleLabel11(tab){const o=mtRule11(tab);if(!o)return '기본값 (연재·UP)';const day=MT_DAYS09.find(x=>x[1]===o.day);return (o.state==='완결'?'완결':'연재')+' / '+(o.genre||(day?day[0]:'UP'));}
function mtApplyRule11(filters,options){const f=(Array.isArray(filters)?filters:[]).find(x=>x&&(x.type==='rule'||x.param==='rule'||x.name==='탭 조건 저장')),n=f?Number(f.state):0;if(![1,2,3,4,5].includes(n))return;try{const p=new SharedPreferences();if(n===1||n===2){if(!mtValidRule11(options))throw new Error('invalid rule');p.setString('mt_rule11_'+(n===1?'popular':'latest'),JSON.stringify(options));}else{if(n===3||n===5)p.setString('mt_rule11_popular','');if(n===4||n===5)p.setString('mt_rule11_latest','');}}catch(_){throw new Error('WV 0.1.26: 탭 조건 저장 실패');}}

// ======================= 0.1.27: 공통 규칙 다시 넣기 (웹뷰 방식 0.1.26 은 그대로) =======================

// ---------- 회차 이름 "N화 : 부제" (0.1.25 와 같은 이름) ----------
// 사이트 이름이 "A.I. 닥터 249화"·"A.I. 닥터 - 231화 : 그런 미신"·"257화 ： 대오각성의 시간" 처럼 섞여 있음 → 번호를 앞으로. 외전·번외 등은 그대로
function chapterName(name, title) {
    let n = String(name || "").replace(/\s+/g, " ").trim();
    if (/외전|번외|특별/.test(n)) return n;
    const m = /(\d+(?:\.\d+)?)\s*화\s*[:：\-–.]?\s*(.*)$/.exec(n);
    if (!m) return n;
    const tt = String(title || "").replace(/\s+/g, "");
    // 번호 앞에 작품 제목 말고 다른 글자가 있으면("프롤로그 · 남은 98화") 원래 이름 그대로
    const before = n.substring(0, m.index).replace(/\s+/g, "").split(tt).join("").replace(/[^\p{L}\p{N}]/gu, "");
    if (tt && before) return n;
    const sub = m[2].trim();
    return `${m[1]}화` + (sub && sub.replace(/\s+/g, "") !== tt ? ` : ${sub}` : "");
}
(function () {
    const base = DefaultExtension.prototype.getDetail;
    DefaultExtension.prototype.getDetail = async function () {
        const d = await base.apply(this, arguments);
        try {
            for (const c of (d && d.chapters) || []) c.name = chapterName(c.name, d.name);
        } catch (e) {
            // 그대로
        }
        return d;
    };
})();

// ---------- 쉬운 오류 문구 + 주소 붙여 넣기 + 주소 목록(domains.json) ----------
const MT_HELP = "① 잠시 뒤 다시 ② 앱 완전히 껐다 켜기 ③ 유니콘 등 DNS 앱을 쓰면 DNS 를 Google 로 ④ 브라우저에서 사이트가 열리면 그 주소를 검색창에 붙여 넣기";
const MT_DOMAIN_LIST = "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/main/domains.json";
const MT_HOST_RE = /^(?:https?:\/\/)?((?:www\.)?mtoon\d+\.asia)(\/[^\s]*)?$/i;

function mtFriendly(e) {
    const m = String((e && e.message) || e || "");
    let easy = "";
    if (/로고 미확인|허용 범위 밖|빈 응답|호출 실패|fetch 실패|출처 변경|HTTP 5\d\d/.test(m)) easy = "사이트가 열리지 않거나 주소가 바뀐 것 같아요.";
    else if (/HTTP 403/.test(m)) easy = "사이트가 접속을 막았어요 (HTTP 403). 오른쪽 위 지구본(웹뷰)으로 한 번 열어 본 뒤 다시 시도해 주세요.";
    else if (/HTTP 429/.test(m)) easy = "요청이 너무 많아 사이트가 잠시 막았어요 (HTTP 429). 1~2분 뒤 다시 시도해 주세요.";
    else if (/초과/.test(m)) easy = "사이트 응답이 너무 늦어요 (시간 초과).";
    if (!easy) return m;
    return `${easy} ${MT_HELP} [${m.replace(/^WV 0\.1\.\d+:\s*/, "")}]`;
}

// 주소 목록 파일에 적힌 머니툰 주소 (5분 기억)
let MT_LISTED = { at: 0, v: "" };
async function mtListed() {
    if (Date.now() - MT_LISTED.at < 5 * 60000) return MT_LISTED.v;
    let v = "";
    try {
        const r = await new Client().get(MT_DOMAIN_LIST, {});
        const u = String((((JSON.parse(String(r.body || "{}")).domains || {}).mtoon || {}).baseUrl) || "").replace(/\/+$/, "");
        if (/^https:\/\/(?:www\.)?mtoon\d+\.asia$/.test(u)) v = u;
    } catch (e) {
        v = "";
    }
    MT_LISTED = { at: Date.now(), v };
    return v;
}

// 다른 주소로 한 번 불러 보기 (웹뷰가 머니툰 로고를 확인해야 성공, 성공하면 mtFirstList 가 그 주소를 기억)
async function mtTryOrigin(origin, run) {
    const keep = MT_ORIGIN11;
    MT_ORIGIN11 = origin;
    try {
        return await run();
    } catch (e) {
        MT_ORIGIN11 = keep;
        throw e;
    }
}

(function () {
    const P = DefaultExtension.prototype;
    // 목록: 사이트가 안 열리면 주소 목록 파일의 주소로 한 번 더 (망가요미는 목록을 40초까지만 기다려서 첫 시도가 15초 안에 실패했을 때만)
    const guard = (base) => async function () {
        const t0 = Date.now();
        try {
            return await base.apply(this, arguments);
        } catch (e) {
            const m = String((e && e.message) || e || "");
            if (/로고 미확인|허용 범위 밖|빈 응답|호출 실패|fetch 실패|HTTP 5\d\d/.test(m) && Date.now() - t0 < 15000) {
                const listed = await mtListed();
                if (listed && listed !== mtBase11()) {
                    try {
                        return await mtTryOrigin(listed, () => base.apply(this, arguments));
                    } catch (e2) {
                        // 아래 원래 오류로
                    }
                }
            }
            throw new Error(mtFriendly(e));
        }
    };
    const plain = (base) => async function () {
        try {
            return await base.apply(this, arguments);
        } catch (e) {
            throw new Error(mtFriendly(e));
        }
    };
    const popular = guard(P.getPopular), latest = guard(P.getLatestUpdates), searchG = guard(P.search);
    P.getPopular = popular;
    P.getLatestUpdates = latest;
    P.getDetail = plain(P.getDetail);
    P.getPageList = plain(P.getPageList);
    // 검색창에 사이트 주소(https:// 없어도)를 붙여 넣으면 그 주소로 목록을 불러 확인 후 적용, 작품 주소면 그 작품
    P.search = async function (query, page, filters) {
        const q = String(query || "").trim();
        const hit = MT_HOST_RE.exec(q);
        if (hit) {
            const origin = "https://" + hit[1].toLowerCase();
            const id = (/[?&]i=(\d+)/.exec(hit[2] || "") || [])[1];
            try {
                const r = await mtTryOrigin(origin, () => mtFirstList(1, "", null));
                if (id) return { list: [{ name: `작품 열기 (${id})`, imageUrl: "", link: `${mtBase11()}/list.php?i=${id}` }], hasNextPage: false };
                return r;
            } catch (e) {
                throw new Error(`붙여 넣은 주소(${origin})에서 머니툰 화면을 확인하지 못했어요. ${mtFriendly(e)}`);
            }
        }
        return searchG.apply(this, arguments);
    };
})();
// ---------- 업데이트 내역 (필터 맨 위 📝 줄) ----------
// 저장소의 changelog.json 을 1시간에 한 번 받아 두었다가 그 소스의 최근 3개를 보여 줌 (필터 화면을 열 때 기다리지 않음)
const NOTES_URL = "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/main/changelog.json";

async function notesRefresh(client) {
    let p;
    try {
        p = new SharedPreferences();
    } catch (e) {
        return;
    }
    await verRefresh(client, p);
    const last = Number(p.getString("notes_at", "0")) || 0;
    if (Date.now() - last < 60 * 60000) return;
    p.setString("notes_at", String(Date.now()));
    try {
        const r = await client.get(NOTES_URL, {});
        const body = String(r.body || "");
        if (r.statusCode === 200 && body.trim().startsWith("{")) p.setString("notes_json", body);
    } catch (e) {
        // 다음 기회에 다시 받음
    }
}
// ---------- 설치 버전 확인 (필터 맨 위 📝 줄) ----------
// 망가요미는 자동 업데이트를 해도 알림이 없어 → 설치된 버전과 저장소의 최신 버전을 1시간마다 비교해 보여 줌 (2026-11-03)
const VER_INDEX_URLS = ["https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/mangayomi/index.json", "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/mangayomi/novel_index.json"];

function verCmp(a, b) {
    const x = String(a || "").split(".").map((n) => parseInt(n, 10) || 0);
    const y = String(b || "").split(".").map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
    return 0;
}

async function verRefresh(client, p) {
    const last = Number(p.getString("ver_at", "0")) || 0;
    if (Date.now() - last < 60 * 60000) return;
    p.setString("ver_at", String(Date.now()));
    const file = String(mangayomiSources[0].pkgPath || "").split("/").pop();
    for (const u of VER_INDEX_URLS) {
        try {
            const r = await client.get(u, {});
            const arr = JSON.parse(String(r.body || "[]"));
            const hit = (Array.isArray(arr) ? arr : []).find((x) => x && String(x.sourceCodeUrl || "").endsWith("/" + file));
            if (hit && hit.version) {
                p.setString("ver_latest", String(hit.version));
                return;
            }
        } catch (e) {
            // 다음 기회에 다시 확인
        }
    }
}

function verLine(key, note) {
    // 버전과 마지막 업데이트 내역을 한 줄로 (필터가 지저분해 보여, 사용자 2026-11-03)
    const mine = String(mangayomiSources[0].version || "");
    let latest = "";
    try {
        latest = new SharedPreferences().getString("ver_latest", "") || "";
    } catch (e) {
        latest = "";
    }
    const last = note && note.t ? ` · ${String(note.d || "").substring(5).replace("-", ".")} ${String(note.t).replace(/^망가요미:\s*/, "")}` : "";
    let name = `📝 ${mine}${last}`;
    if (latest && verCmp(latest, mine) > 0) name = `📝 ⚠️ OLD ${mine} → 새 버전 ${latest} 있음, 확장 화면에서 업데이트`;
    else if (latest) name = `📝 🆕 NEW ${mine}${last}`;
    return { type_name: "HeaderFilter", name, _status: true };
}

function notesFilters(key) {
    let list = [];
    try {
        list = (JSON.parse(new SharedPreferences().getString("notes_json", "") || "{}").items || {})[key] || [];
    } catch (e) {
        list = [];
    }
    return [verLine(key, list.filter((n) => n && n.t)[0])];
}

// 필터 맨 위 📝 줄 (설치 버전 NEW/OLD + 마지막 업데이트 내역)
(function () {
    const P = DefaultExtension.prototype;
    const fl = P.getFilterList;
    P.getFilterList = function () {
        let head = [];
        try {
            head = notesFilters("mtoon");
        } catch (e) {
            head = [];
        }
        return head.concat(fl.apply(this, arguments));
    };
    // 1시간에 한 번 내역·버전 받기 (목록 열 때, 실패해도 목록엔 영향 없음)
    for (const k of ["getPopular", "getLatestUpdates"]) {
        const b = P[k];
        P[k] = async function () {
            try {
                await notesRefresh(new Client());
            } catch (e) {
                // 그대로
            }
            return b.apply(this, arguments);
        };
    }
})();

// ---------- 필터 맨 끝 빈 줄 (2026-11-03) ----------
// 망가요미 필터 창이 휴대폰 하단 버튼(|||·○·<)에 가려 맨 아래 항목이 안 눌림 → 맨 끝에 빈 줄을 두어 위로 올릴 수 있게.
// 맨 끝에만 붙여 기존 필터 순서·저장된 탭 규칙은 그대로
(function () {
    const base = DefaultExtension.prototype.getFilterList;
    DefaultExtension.prototype.getFilterList = function () {
        const list = base.apply(this, arguments) || [];
        return list.concat([1, 2, 3].map(() => ({ type_name: "HeaderFilter", name: "\u3000", _status: true })));
    };
})();

// ---------- 빠진 회차 번호 (2026-11-04) ----------
// 망가요미는 "N화 누락됨" 개수만 보여 줌 → 작품 설명 맨 위에 빠진 회차 번호를 적음 (회차 이름 맨 앞 번호 기준)
function missingNote(chapters) {
    const nums = {};
    let max = 0;
    let min = Infinity;
    for (const c of chapters || []) {
        const m = /^\D{0,6}?(\d{1,5})(?:\.\d+)?\s*(?:화|회|부|권|장|편|$|\s|\D)/.exec(String((c && c.name) || "").trim());
        if (!m) continue;
        const n = Number(m[1]);
        if (!(n > 0) || n > 20000) continue;
        nums[n] = true;
        if (n > max) max = n;
        if (n < min) min = n;
    }
    if (!max || max - min > 5000) return "";
    // 가장 작은 번호 ~ 가장 큰 번호 사이만 (앞쪽 1~21화가 원래 없는 작품은 세지 않음, 애니요미와 같음)
    const miss = [];
    for (let i = min; i <= max; i++) if (!nums[i]) miss.push(i);
    if (!miss.length || miss.length > (max - min + 1) / 2) return "";
    const shown = miss.slice(0, 10).map((n) => `${n}화`).join(", ");
    return `⚠️ 빠진 회차: ${shown}${miss.length > 10 ? ` 외 ${miss.length - 10}개` : ""} (사이트에 없거나 확장이 못 받아 온 회차)`;
}
(function () {
    const base = DefaultExtension.prototype.getDetail;
    if (!base) return;
    DefaultExtension.prototype.getDetail = async function () {
        const d = await base.apply(this, arguments);
        try {
            const note = d ? missingNote(d.chapters) : "";
            if (note) d.description = note + (d.description ? "\n\n" + d.description : "");
        } catch (e) {
            // 그대로
        }
        return d;
    };
})();

// ---------- 검색 띄어쓰기 (2026-11-05) ----------
// 사이트 검색이 띄어쓰기를 구분해 "괴력난신"·"나혼자만레벨업" 으로는 "괴력 난신"·"나 혼자만 레벨업" 이 안 나오는 곳이 있음.
// 결과가 0개일 때만: ① 띄어쓰기를 뺀 검색어 ② 검색어 앞부분(절반) ③ 두 글자씩(앞에서부터) 으로 최대 6번 다시 찾아,
// 띄어쓰기·기호를 빼고 비교했을 때 검색어가 들어 있는 작품만 보여 줌. 결과가 있으면 원래 그대로
(function () {
    const base = DefaultExtension.prototype.search;
    DefaultExtension.prototype.search = async function (query, page, filters) {
        const r = await base.apply(this, arguments);
        const q = String(query || "").trim();
        if (!q || Number(page) > 1 || /^(?:https?:\/\/|[\w-]+(?:\.[\w-]+)+(?:[/?#]|$))/i.test(q) || (r && r.list && r.list.length)) return r;
        const squash = (s) => String(s || "").normalize("NFC").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
        const want = squash(q);
        if (want.length < 2) return r;
        const joined = q.replace(/\s+/g, "");
        const tries = [];
        const add = (t) => { if (t && t.length >= 2 && t !== q && tries.indexOf(t) < 0) tries.push(t); };
        // 사이트 검색은 쉼표·쌍점·물결·괄호·한자 같은 기호가 있으면 못 찾음("밑도 끝도 없이, 너다" 0개, 2026-11-06 검색 검사)
        // → 기호를 뺀 검색어, 앞쪽 단어만으로 먼저 찾아 봄
        const plain = q.replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/[\u3400-\u9fff]+/g, " ").replace(/\s+/g, " ").trim();
        const words = plain.split(" ").filter((w) => w);
        add(plain);
        if (words.length > 2) add(words.slice(0, words.length - 1).join(" "));
        if (words.length > 1) add(words.slice(0, Math.ceil(words.length / 2)).join(" "));
        add(joined);
        if (joined.length > 2) add(joined.substring(0, Math.max(2, Math.ceil(joined.length / 2))));
        for (let i = 0; i + 2 <= joined.length; i++) add(joined.substring(i, i + 2));
        // 머니툰은 한 번 찾을 때마다 웹뷰를 열어서 오래 걸림 → 망가요미 40초 제한 안에 끝나게 22초 넘으면 그만
        const t0 = Date.now();
        for (const t of tries.slice(0, 8)) {
            if (Date.now() - t0 > 22000) break;
            try {
                const r2 = await base.call(this, t, 1, filters);
                const hit = ((r2 && r2.list) || []).filter((x) => squash(x && x.name).includes(want));
                if (hit.length) return { list: hit, hasNextPage: false };
            } catch (e) {
                // 다음 방법으로
            }
        }
        return r;
    };
})();

// ---------- 회차 번호 겹침 막기 (2026-11-07 회차 점검) ----------
// 망가요미는 회차 이름에서 숫자를 읽어 번호를 매기고(lib/utils/chapter_recognition.dart: 작품 제목을 지운 뒤 첫 숫자,
// "season/s/t N"·"ep N" 따로), 번호가 같은 회차는 하나만 남김 → "프롤로그 · 남은 98화"(98)와 "98화"가 겹치거나
// "키스 대신 7초 34화"가 모두 7 이 되어 회차가 사라짐. 같은 방식으로 미리 읽어 보고, 겹치거나 번호가 없는 작품만
// 오래된 회차부터 겹치지 않는 번호를 이름 앞에 붙임("35. …", 겹치면 "39.01. …"). 문제없는 작품은 그대로
(function () {
    const base = DefaultExtension.prototype.getDetail;
    const unwanted = /\b(?:v|ver|vol|version|volume|season|staffel|saison|temporada|s|t)[^a-z]?[0-9]+/g;
    const seasonKw = /\b(?:staffel|season|saison|temporada|s|t)\s*([0-9]+)/;
    const epKw = /\b(?:folge|episode|episodio|ep\.?)\s*([0-9]+(?:\.[0-9]+)?)/;
    const chNot = /(?<=ch\.) *([0-9]+)(\.[0-9]+)?(\.?[a-z]+)?/;
    const bare = /([0-9]+)(\.[0-9]+)?(\.?[a-z]+)?/;
    const dec = (d, a) => {
        if (d) return parseFloat(d);
        if (a) {
            if (a.includes("extra")) return 0.99;
            if (a.includes("omake")) return 0.98;
            if (a.includes("special")) return 0.97;
            const t = a.replace(".", "");
            if (t.length === 1) { const k = t.charCodeAt(0) - 96; return k >= 10 ? 0 : k / 10; }
        }
        return 0;
    };
    const read = (title, ch) => {
        let n = String(ch || "").toLowerCase();
        if (title) n = n.split(String(title).toLowerCase()).join("");
        n = n.trim().replace(/,/g, ".").replace(/-/g, ".").replace(/\s(?=extra|special|omake)/g, "");
        const sm = seasonKw.exec(n);
        const season = sm ? sm[1] : "0";
        const em = epKw.exec(n);
        if (em) return { season, ep: parseFloat(em[1]) };
        const s2 = n.replace(unwanted, "");
        const m = chNot.exec(s2) || bare.exec(s2);
        return { season, ep: m ? parseFloat(m[1]) + dec(m[2], m[3]) : null };
    };
    const ok = (list, title) => {
        const seen = {};
        for (const x of list) {
            const r = read(title, x.name);
            if (r.ep === null || !(r.ep > 0)) return false;
            const k = `${r.season}::${r.ep}::${x.scanlator || ""}`;
            if (seen[k]) return false;
            seen[k] = true;
        }
        return true;
    };
    // 붙일 번호 짐작: "34화"·"5회" 를 먼저, 없으면 앱 방식. 확장이 붙인 " · 남은 N화"·" · 마지막"·끝 날짜 "(11.05)" 는 빼고 읽음
    const guessNo = (title, name) => {
        const core = String(name || "").replace(/\s*·\s*(?:남은\s*\d+\s*화|마지막)\s*$/, "").replace(/\s*\(\d{2}(?:\.\d{2}){1,2}\)\s*$/, "");
        const m = /(\d+(?:[.-]\d+)?)\s*(?:화|회|話)/.exec(core);
        if (m) return parseFloat(m[1].replace("-", "."));
        return read(title, core).ep;
    };
    DefaultExtension.prototype.getDetail = async function (url) {
        const d = await base.apply(this, arguments);
        const list = d && (d.episodes || d.chapters);
        if (!list || !list.length) return d;
        const title = String(d.name || "");
        // 앱이 기억한 제목이 조금 달라 지워지지 않는 경우까지 보려고 제목을 지운 것·안 지운 것 둘 다 확인
        if (ok(list, title) && ok(list, "")) return d;
        let last = 0;
        const fmt = (v) => String(Math.round(v * 100) / 100);
        for (let i = list.length - 1; i >= 0; i--) { // 목록은 최신이 위 → 오래된 것부터
            const x = list[i];
            const plain = String(x.name || "").replace(/^\s*\d+(?:\.\d+)?\.\s+/, "");
            const guess = guessNo(title, plain);
            const v = guess !== null && guess > last ? guess : Math.round((last + 0.01) * 100) / 100;
            last = v;
            const lead = /^\s*(\d+(?:\.\d+)?)/.exec(plain);
            x.name = lead && parseFloat(lead[1]) === v && !/^\s*\d+(?:\.\d+)?\s*[-.,]\s*\d/.test(plain) ? plain : `${fmt(v)}. ${plain}`;
        }
        return d;
    };
})();
