const mangayomiSources = [{"id":870214020,"name":"머니툰 웹뷰 연결시험","lang":"ko","baseUrl":"https://mtoon165.asia","apiUrl":"","iconUrl":"","typeSource":"single","itemType":0,"isNsfw":true,"hasCloudflare":false,"version":"0.0.11","dateFormat":"","dateFormatLocale":"","pkgPath":"mtoon_webview_probe.js"}];
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
    fetch(path,{method:'POST',credentials:'same-origin',headers:{'X-Requested-With':'XMLHttpRequest'},signal:controller.signal}).then(async r=>{
        const responseUrl=new URL(r.url||path,location.origin);
        if(responseUrl.origin!==location.origin){send({stage:'목록 응답 출처 변경',status:r.status});return;}
        if(!r.ok){send({stage:'목록 HTTP 오류',status:r.status});return;}
        let data;try{data=JSON.parse(await r.text());}catch(_){send({stage:'목록 JSON 아님',status:r.status});return;}
        if(!Array.isArray(data)){send({stage:'목록 배열 아님',status:r.status});return;}
        const rows=data.slice(0,30).filter(x=>x&&typeof x==='object').map(x=>{
            let image='';try{if(x.wt_thumb){const u=new URL(String(x.wt_thumb),location.origin+(/^[^/?:#]+\.(?:jpe?g|png|webp|gif)(?:[?#].*)?$/i.test(String(x.wt_thumb))?'/img/data/webtoon/':'/'));if(/^https?:$/.test(u.protocol))image=u.href;}}catch(_){}
            let dom='';for(const a of document.querySelectorAll('a[href]')){try{const u=new URL(a.href,location.href);if(u.pathname==='/list.php'&&u.searchParams.get('i')===String(x.wt_idx)){const im=a.querySelector('img')||(a.parentElement&&a.parentElement.querySelector('img'));if(im){dom=im.currentSrc||im.src||'';break;}}}catch(_){}}
            return {id:String(x.wt_idx||''),name:String(x.wt_title||''),imageUrl:image,meta:{author:String(x.wt_author||'').trim(),genre:String(x.wt_genre||'').trim(),description:new DOMParser().parseFromString(String(x.wt_intro||''),'text/html').body.textContent.trim(),state:String(x.wt_fin||'').trim()},raw:String(x.wt_thumb||'').split(/[?#]/)[0].slice(0,400),dom:String(dom).split(/[?#]/)[0].slice(0,400)};
        });

        send({stage:'ok',origin:location.origin,status:r.status,count:data.length,rows:rows});
    }).catch(e=>send({stage:e&&e.name==='AbortError'?'목록 요청 8초 초과':'목록 fetch 실패'})).finally(()=>clearTimeout(timer));
}.toString()+')('+JSON.stringify(page)+','+JSON.stringify(query)+','+JSON.stringify(options||null)+');';}
async function mtFirstList(page,query,options){
    if(typeof evaluateJavascriptViaWebview!=='function')throw new Error('WV 0.0.11: 웹뷰 함수 없음');
    let timer,value;try{
        value=await Promise.race([evaluateJavascriptViaWebview(mtBase11()+'/',{},[mtListScript(page,query,options)],20),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('WV 0.0.11: 웹뷰 전체 24초 초과')),24000);})]);
    }catch(e){if(e&&String(e.message||'').startsWith('WV 0.0.11:'))throw e;throw new Error('WV 0.0.11: 웹뷰 호출 실패');}
    finally{if(timer&&typeof clearTimeout==='function')clearTimeout(timer);}
    if(value==null||value==='')throw new Error('WV 0.0.11: 웹뷰 빈 응답');
    let data=value;for(let i=0;i<2&&typeof data==='string';i++){try{data=JSON.parse(data);}catch(_){throw new Error('WV 0.0.11: 반환 JSON 해석 실패');}}
    if(!data||data.stage!=='ok'){const address=data?String(data.protocol||'')+'//'+String(data.host||'').replace(/[^a-zA-Z0-9.:-]/g,'').slice(0,80)+String(data.path||'').slice(0,60):'';throw new Error('WV 0.0.11: '+String(data&&data.stage||'예상 밖 반환').slice(0,40)+' | '+address+(data&&data.status?' HTTP '+Number(data.status):''));}
    if(!/^https:\/\/(?:www\.)?mtoon\d+\.asia$/.test(String(data.origin||'')))throw new Error('WV 0.0.11: 반환 출처 검증 실패');
    if(!Array.isArray(data.rows))throw new Error('WV 0.0.11: 반환 목록 없음');
    const list=data.rows.filter(x=>x&&/^\d+$/.test(String(x.id))&&x.name).map(x=>({name:String(x.name),imageUrl:String(x.imageUrl||''),link:data.origin+'/list.php?i='+x.id}));
    if(!list.length&&Number(data.count)>0)throw new Error('WV 0.0.11: 목록 항목 해석 실패 (원본 '+Number(data.count)+'개)');
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
    if(!m||(mode==='detail'?(m[1]!=='list'||m[2]!=='i'):(m[1]!=='detail'||m[2]!=='wi')))throw new Error('WV 0.0.11: 작품/회차 주소 형식 오류');
    if(typeof evaluateJavascriptViaWebview!=='function')throw new Error('WV 0.0.11: 웹뷰 함수 없음');
    let timer,value;try{value=await Promise.race([evaluateJavascriptViaWebview(text,{},[mtReaderScript07(mode,m[3])],20),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('WV 0.0.11: 작품/회차 웹뷰 24초 초과')),24000);})]);}finally{if(timer&&typeof clearTimeout==='function')clearTimeout(timer);}
    for(let n=0;n<2&&typeof value==='string';n++){try{value=JSON.parse(value);}catch(_){throw new Error('WV 0.0.11: 작품/회차 JSON 해석 실패');}}
    if(!value||value.error)throw new Error('WV 0.0.11: '+String(value&&value.error||'빈 응답'));
    if(mode==='detail'){if(!value.detail||!Array.isArray(value.detail.chapters)||!value.detail.chapters.length)throw new Error('WV 0.0.11: 유효한 회차 없음');return value.detail;}
    if(!Array.isArray(value.pages)||!value.pages.length)throw new Error('WV 0.0.11: 본문 이미지 없음');return value.pages;
}

async function mtPaged08(page,query,options){options=mtOptions11(options);const n=Number(page==null?1:page);if(!Number.isSafeInteger(n)||n<1||n>100000)throw new Error('WV 0.0.11: 잘못된 페이지 번호');const key=JSON.stringify([n,query,options||null]);if(!MT_WV_PENDING[key])MT_WV_PENDING[key]=mtFirstList(n,query,options).finally(()=>{delete MT_WV_PENDING[key];});return await MT_WV_PENDING[key];}

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
function mtApplyRule11(filters,options){const f=(Array.isArray(filters)?filters:[]).find(x=>x&&(x.type==='rule'||x.param==='rule'||x.name==='탭 조건 저장')),n=f?Number(f.state):0;if(![1,2,3,4,5].includes(n))return;try{const p=new SharedPreferences();if(n===1||n===2){if(!mtValidRule11(options))throw new Error('invalid rule');p.setString('mt_rule11_'+(n===1?'popular':'latest'),JSON.stringify(options));}else{if(n===3||n===5)p.setString('mt_rule11_popular','');if(n===4||n===5)p.setString('mt_rule11_latest','');}}catch(_){throw new Error('WV 0.0.11: 탭 조건 저장 실패');}}
