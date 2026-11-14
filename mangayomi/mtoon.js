const mangayomiSources = [{"id":870214019,"name":"머니툰 웹툰","lang":"ko","baseUrl":"https://mtoon168.asia","apiUrl":"","iconUrl":"https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/icon/eu.kanade.tachiyomi.extension.ko.newxtoon.png","typeSource":"single","itemType":0,"isNsfw":true,"hasCloudflare":false,"version":"0.1.44","dateFormat":"","dateFormatLocale":"","pkgPath":"mtoon.js"}];
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
async function mtFirstListSlow(page,query,options){
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
    getSourcePreferences(){return [{key:'mt_domain',editTextPreference:{title:'사이트 주소',summary:'비워 두면 자동으로 찾은 주소(기본 mtoon168.asia). 직접 넣으면 그 주소를 바로 쓰고, 더 새 번호 주소가 확인되면 자동으로 바뀜',value:'',dialogTitle:'사이트 주소',dialogMessage:'예: https://mtoon168.asia (https:// 없어도 됨)'}},{key:'mt_auto_on',switchPreferenceCompat:{title:'주소 자동 찾기',summary:'사이트가 안 열리면 주소 목록·넘겨 준 주소·번호 주소(mtoonN.asia) 중 머니툰 화면이 확인된 주소로 바꿈. 기본 켬',value:true}},{key:'mt_direct_on',switchPreferenceCompat:{title:'바로 받기 (웹뷰 없이)',summary:'켜면 목록·회차 그림을 웹뷰 없이 바로 받아 봄(되면 더 빠름). 글리치는 설정의 SNI 파편화를 켜야 될 수 있음. 안 되면 4초 뒤 웹뷰로 넘어감. 기본 켬',value:true}}];}
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
async function mtRead07Slow(url,mode){
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

// ======================= 0.1.28: 빠른 길 (가벼운 화면 + 글자만 받기) =======================
// 전: 웹뷰로 첫 화면 전체(표지 수십 장)나 회차 화면 전체를 다 연 뒤 읽음 → 목록 3~4초·회차 그림 3초 (사용자 2026-11-09)
// 지금: 웹뷰로 가벼운 같은 사이트 주소(/robots.txt)만 열고, 그 안에서 목록 자료·작품/회차 화면 글자만 받아 읽음(그림은 안 받음).
// 안 되면 예전 방식(첫 화면·회차 화면 열기)으로 바로 넘어가고 6시간 동안은 예전 방식만.
// 목록은 다음 쪽도 같이 받아 두고, 받은 목록은 5분 동안 기억
const MT_LIGHT_PATH = '/robots.txt';
const MT_LIST_CACHE = {};
function mtLightOff(){try{return Number(new SharedPreferences().get('mt_light_off_until')||0)>Date.now();}catch(_){return false;}}
function mtLightFailed(){try{new SharedPreferences().setString('mt_light_off_until',String(Date.now()+10*60000));}catch(_){}}
function mtListPath(page,query,o){const offset=(page-1)*30;o=o||{state:'연재중',day:'8',genre:''};return query?'/more.php?search='+encodeURIComponent(query)+'&c='+offset:'/more.php?wt_fin='+encodeURIComponent(o.state)+(o.genre?'&cate='+encodeURIComponent(o.genre):'&w='+encodeURIComponent(o.day))+'&c='+offset;}
function mtLightScript(job){return '('+function(job){
    if(window.__mtLight)return;window.__mtLight=true;
    let done=false;const send=x=>{if(done)return;done=true;window.flutter_inappwebview.callHandler('setResponse',JSON.stringify(x));};
    if(location.protocol!=='https:'||!/^(?:www\.)?mtoon\d+\.asia$/.test(location.hostname)){send({error:'허용 범위 밖 웹뷰 주소'});return;}
    const ctl=new AbortController();setTimeout(()=>ctl.abort(),8000);
    const same=(r,p)=>{const u=new URL(r.url||p,location.origin);if(u.origin!==location.origin)throw new Error('응답 출처 변경');if(!r.ok)throw new Error('HTTP '+r.status);return u;};
    const post=p=>fetch(p,{method:'POST',credentials:'same-origin',headers:{'X-Requested-With':'XMLHttpRequest'},signal:ctl.signal}).then(async r=>{same(r,p);const d=JSON.parse(await r.text());if(!Array.isArray(d))throw new Error('목록 배열 아님');return d;});
    const html=p=>fetch(p,{credentials:'same-origin',signal:ctl.signal}).then(async r=>{const u=same(r,p);return {doc:new DOMParser().parseFromString(await r.text(),'text/html'),url:u};});
    const abs=(v,base)=>{try{const u=new URL(v,base);return /^https?:$/.test(u.protocol)?u.href:'';}catch(_){return '';}};
    const img=(el,base)=>el?abs(el.getAttribute('data-src')||el.getAttribute('data-original')||el.getAttribute('src')||'',base):'';
    const row=x=>{let image='';try{if(x.wt_thumb){const t=String(x.wt_thumb);const u=new URL(t,location.origin+(/^[^/?:#]+\.(?:jpe?g|png|webp|gif)(?:[?#].*)?$/i.test(t)?'/img/data/webtoon/':'/'));if(/^https?:$/.test(u.protocol))image=u.href;}}catch(_){}
        return {id:String(x.wt_idx||''),name:String(x.wt_title||''),imageUrl:image,meta:{author:String(x.wt_author||'').trim(),genre:String(x.wt_genre||'').trim(),description:new DOMParser().parseFromString(String(x.wt_intro||''),'text/html').body.textContent.trim(),state:String(x.wt_fin||'').trim()}};};
    const date=t=>{t=String(t||'').trim();const day=86400000,mid=Math.floor((Date.now()+32400000)/day)*day-32400000;let m;
        if(/^오늘/.test(t)||/\d+\s*(시간|분|초)\s*전/.test(t))return String(mid);if(/^어제/.test(t))return String(mid-day);
        if((m=/^(\d+)\s*일\s*전/.exec(t)))return String(mid-Number(m[1])*day);
        if((m=/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(t)))return String(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))-32400000);return null;};
    let work;
    if(job.kind==='list'){
        // groups: [[주소…](필수 쪽), [주소…](다음 쪽, 실패해도 됨)] · 한 쪽 안의 주소들(연재+완결)은 합침
        work=Promise.all(job.groups.map((g,gi)=>Promise.all(g.map((p,pi)=>gi===0&&pi===0?post(p):post(p).catch(()=>null))).then(ds=>{
            if(ds.every(d=>d==null))return null;const seen={},all=[];let count=0;
            for(const d of ds){if(!d)continue;count=Math.max(count,d.length);for(const x of d){if(x&&typeof x==='object'&&x.wt_idx&&!seen[x.wt_idx]){seen[x.wt_idx]=1;all.push(row(x));}}}
            return {count:count,rows:all.slice(0,60)};
        }).catch(e=>{if(gi===0)throw e;return null;}))).then(pages=>send({ok:1,origin:location.origin,pages:pages}));
    }else if(job.kind==='detail'){
        work=html(job.path).then(({doc,url})=>{
            if(url.searchParams.get('i')!==job.id)throw new Error('작품 주소 변경');
            const title=doc.querySelector('h1.list_page_title'),seen=new Set(),chapters=[];
            for(const a of doc.querySelectorAll('.list_data .l_d_t a[href]')){const link=abs(a.getAttribute('href'),url.href);if(!link)continue;const u=new URL(link);if(u.origin!==location.origin||u.pathname!=='/detail.php'||!/^\d+$/.test(u.searchParams.get('wi')||'')||seen.has(link))continue;seen.add(link);const name=String(a.textContent||'').replace(/\s+/g,' ').trim();const li=a.closest('li'),d=li&&li.querySelector('.l_d_d');if(name)chapters.push({name:name,url:link,dateUpload:date(d?d.textContent:'')});}
            if(!title||!chapters.length)throw new Error('회차 링크 '+chapters.length+'개');
            send({ok:1,detail:{name:String(title.textContent||'').trim(),imageUrl:img(doc.querySelector('.list_page_head img'),url.href),description:String((doc.querySelector('.list_page_head p')||{}).textContent||'').trim(),chapters:chapters}});
        });
    }else{
        work=html(job.path).then(({doc,url})=>{
            if(url.searchParams.get('wi')!==job.id)throw new Error('회차 주소 변경');
            const urls=[],seen=new Set();for(const im of doc.querySelectorAll('img')){const u=img(im,url.href);if(!u)continue;const pu=new URL(u);if(!/\/data\/file\//i.test(pu.pathname)||/\/ban\/|\/assets\/|money_toon/i.test(u)||seen.has(u))continue;seen.add(u);urls.push(u);}
            if(!urls.length)throw new Error('본문 이미지 0개');
            send({ok:1,pages:urls});
        });
    }
    work.catch(e=>send({error:e&&e.name==='AbortError'?'8초 초과':String(e&&e.message||e).slice(0,60)}));
}.toString()+')('+JSON.stringify(job)+');';}
async function mtLightRun(job){
    if(typeof evaluateJavascriptViaWebview!=='function')throw new Error('웹뷰 함수 없음');
    let timer,value;try{value=await Promise.race([evaluateJavascriptViaWebview(mtBase11()+MT_LIGHT_PATH,{},[mtLightScript(job)],10),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('빠른 길 12초 초과')),12000);})]);}
    finally{if(timer&&typeof clearTimeout==='function')clearTimeout(timer);}
    for(let n=0;n<2&&typeof value==='string';n++){try{value=JSON.parse(value);}catch(_){throw new Error('빠른 길 JSON 해석 실패');}}
    if(!value||!value.ok)throw new Error(String(value&&value.error||'빠른 길 빈 응답'));
    return value;
}
function mtListOut(origin,pg){
    const list=pg.rows.filter(x=>x&&/^\d+$/.test(String(x.id))&&x.name).map(x=>({name:String(x.name),imageUrl:String(x.imageUrl||''),link:origin+'/list.php?i='+x.id}));
    pg.rows.forEach(x=>{if(!x||!/^\d+$/.test(String(x.id)))return;const c={meta:x.meta||null,name:String(x.name||''),image:String(x.imageUrl||'')};MT_COVERS[String(x.id)]=c;try{new SharedPreferences().setString('mt_meta10_'+x.id,JSON.stringify(c));}catch(_){}});
    return {list:list,hasNextPage:Number(pg.count)>=30};
}
// 0.1.42: 마지막 목록을 받은 길과 시간 (필터 📡 줄 끝 "🚀") — 바로 받기·가벼운 웹뷰·웹뷰 중 실제로 쓰이는 길 확인용
let MT_PATH='';
function mtPathNote(t0){try{new SharedPreferences().setString('mt_last_path',((Date.now()-t0)/1000).toFixed(1)+'초 ('+MT_PATH+')');}catch(_){}}
async function mtFirstList(page,query,options){
    const t0=Date.now();MT_PATH='웹뷰';
    try{return await mtFirstListInner(page,query,options);}finally{mtPathNote(t0);}
}
async function mtFirstListInner(page,query,options){
    const key=mtBase11()+'|'+JSON.stringify([page,query,options||null]),hit=MT_LIST_CACHE[key];
    if(hit&&Date.now()-hit.at<5*60000){MT_PATH='기억';return hit.value;}
    if(!mtDirectOff()){
        try{
            const v=await mtDirectList(page,query,options);
            const out=mtListOut(v.origin,v.pages[0]);
            if(!out.list.length&&v.pages[0].count>0)throw new Error('목록 해석 실패');
            MT_LIST_CACHE[key]={at:Date.now(),value:out};
            if(v.pages[1]&&out.hasNextPage)MT_LIST_CACHE[mtBase11()+'|'+JSON.stringify([page+1,query,options||null])]={at:Date.now(),value:mtListOut(v.origin,v.pages[1])};
            MT_PATH='바로';
            return out;
        }catch(e){var directBad=true;MT_PATH='바로 실패 → ';}
    }
    const viaWebview=await mtFirstListWv(page,query,options,key);
    if(directBad)mtDirectFailed();
    return viaWebview;
}
async function mtFirstListWv(page,query,options,key){
    if(!mtLightOff()){
        try{
            const group=n=>{const p=mtListPath(n,query,options);return query?[p,p+'&wt_fin='+encodeURIComponent('완결')]:[p];};
            const v=await mtLightRun({kind:'list',groups:[group(page),group(page+1)]});
            const origin=String(v.origin||'');if(!/^https:\/\/(?:www\.)?mtoon\d+\.asia$/.test(origin))throw new Error('출처 확인 실패');
            mtRemember11(origin);
            const out=mtListOut(origin,v.pages[0]);
            MT_LIST_CACHE[mtBase11()+'|'+JSON.stringify([page,query,options||null])]={at:Date.now(),value:out};
            if(v.pages[1]&&out.hasNextPage)MT_LIST_CACHE[mtBase11()+'|'+JSON.stringify([page+1,query,options||null])]={at:Date.now(),value:mtListOut(origin,v.pages[1])};
            MT_PATH=(MT_PATH==='웹뷰'?'':MT_PATH)+'가벼운 웹뷰';
            return out;
        }catch(e){var lightBad=true;}
    }
    const out=await mtFirstListSlow(page,query,options);
    MT_PATH=(MT_PATH==='웹뷰'?'':MT_PATH)+'웹뷰';
    if(lightBad)mtLightFailed();
    MT_LIST_CACHE[mtBase11()+'|'+JSON.stringify([page,query,options||null])]={at:Date.now(),value:out};
    return out;
}
async function mtRead07(url,mode){
    const text=String(url||''),m=/^https:\/\/(?:www\.)?mtoon\d+\.asia\/(list|detail)\.php\?(?:[^#]*&)?(i|wi)=(\d+)(?:&[^#]*)?$/.exec(text);
    if(m&&!mtDirectOff()){
        try{return await mtDirectRead(mode,m[3]);}catch(e){var directBad=true;}
    }
    const viaWebview=await mtRead07Wv(text,mode,m);
    if(directBad)mtDirectFailed();
    return viaWebview;
}
async function mtRead07Wv(url,mode,m){
    if(m&&!mtLightOff()){
        try{
            const v=await mtLightRun({kind:mode,id:m[3],path:mode==='detail'?'/list.php?i='+m[3]:'/detail.php?wi='+m[3]});
            if(mode==='detail'&&v.detail)return v.detail;
            if(mode==='pages'&&Array.isArray(v.pages)&&v.pages.length)return v.pages;
        }catch(e){var lightBad=true;}
    }
    const r=await mtRead07Slow(url,mode);
    if(lightBad)mtLightFailed();
    return r;
}

// ======================= 0.1.29: 바로 받기 (웹뷰 없이) =======================
// Mangayomi Glitch 0.9.230 소스 확인(2026-11-09): 설정 "SNI 파편화"를 켜면 확장의 기본 통신(new Client(), noProxy 아님)이
// 앱 안 중계(127.0.0.1:48799, TLS 첫 인사를 쪼갬)를 거침. noProxy:true 통신은 중계를 건너뜀(glitchApplySniProxy).
// 순정은 원래 바로 받기가 됐음(0.1.25). → 웹뷰보다 먼저 바로 받기 4초, 안 되면 웹뷰 길, 6시간 동안 바로 받기 건너뜀
const MT_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
// 0.1.30: 글리치 SNI 파편화를 안 켜면 바로 받기가 매번 실패해 오히려 느려짐(사용자 5초) → 설정 스위치로 켤 때만 (기본 끔)
// 0.1.42 (2026-11-14, 사용자 "규칙 때문에 역효과" 검토): 기준 앱은 순정(바로 받기가 되던 앱) → 기본 켬, 직접 끈 사람만 끔.
// 실패 뒤 건너뛰기도 6시간 → 10분 (한 번 실패로 몇 시간 동안 느린 길만 쓰지 않게)
function mtDirectOn(){try{const v=new SharedPreferences().get('mt_direct_on');return !(v===false||v==='false');}catch(_){return true;}}
function mtDirectOff(){if(!mtDirectOn())return true;try{return Number(new SharedPreferences().get('mt_direct_off_until')||0)>Date.now();}catch(_){return false;}}
function mtDirectFailed(){try{new SharedPreferences().setString('mt_direct_off_until',String(Date.now()+10*60000));}catch(_){}}
function mtUnesc(t){return String(t||'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#0*39;/g,"'").replace(/&nbsp;/g,' ').replace(/&amp;/g,'&');}
async function mtDirectGet(path,ms,xhr){
    const base=mtBase11(),h={'User-Agent':MT_UA,'Referer':base+'/'};if(xhr)h['X-Requested-With']='XMLHttpRequest';
    let timer;const r=await Promise.race([new Client().get(base+path,h),new Promise((_,rej)=>{timer=setTimeout(()=>rej(new Error('바로 받기 시간 초과')),ms);})]).finally(()=>{if(timer&&typeof clearTimeout==='function')clearTimeout(timer);});
    if(Number(r.statusCode)!==200)throw new Error('바로 받기 HTTP '+r.statusCode);
    return String(r.body||'');
}
function mtDirectRows(body){
    const d=JSON.parse(body);if(!Array.isArray(d))throw new Error('목록 배열 아님');const base=mtBase11();
    return {count:d.length,rows:d.filter(x=>x&&x.wt_idx).map(x=>{const t=String(x.wt_thumb||'').trim();let image='';
        if(/^https?:\/\//.test(t))image=t;else if(t)image=/^[^/?:#]+\.(?:jpe?g|png|webp|gif)(?:[?#].*)?$/i.test(t)?base+'/img/data/webtoon/'+t:base+'/'+t.replace(/^\.?\//,'');
        return {id:String(x.wt_idx),name:mtUnesc(x.wt_title).trim(),imageUrl:image,meta:{author:String(x.wt_author||'').trim(),genre:String(x.wt_genre||'').trim(),description:mtUnesc(String(x.wt_intro||'').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'')).trim(),state:String(x.wt_fin||'').trim()}};})};
}
async function mtDirectList(page,query,options){
    const one=async n=>{const p=mtListPath(n,query,options);const ps=query?[p,p+'&wt_fin='+encodeURIComponent('완결')]:[p];
        const got=await Promise.all(ps.map((x,i)=>i===0?mtDirectGet(x,4000,true):mtDirectGet(x,4000,true).catch(()=>null)));
        const seen={},rows=[];let count=0;for(const b of got){if(b==null)continue;const r=mtDirectRows(b);count=Math.max(count,r.count);for(const x of r.rows)if(!seen[x.id]){seen[x.id]=1;rows.push(x);}}
        return {count:count,rows:rows};};
    const [a,b]=await Promise.all([one(page),one(page+1).catch(()=>null)]);
    return {origin:mtBase11(),pages:[a,b]};
}
async function mtDirectRead(mode,id){
    const base=mtBase11();
    if(mode==='detail'){
        const html=await mtDirectGet('/list.php?i='+id,4000,false);
        const head=(/<div class="list_page_head">([\s\S]*?)<div class="none_box">/.exec(html)||[0,''])[1];
        const title=mtUnesc(((/<h1[^>]*list_page_title[^>]*>([\s\S]*?)<\/h1>/.exec(head||html)||[0,''])[1]).replace(/<[^>]+>/g,'')).trim();
        let cover=(/<img[^>]+src="([^"]+)"/.exec(head)||[0,''])[1];if(cover&&!/^https?:/.test(cover))cover=base+'/'+cover.replace(/^\.?\//,'');
        const intro=mtUnesc(((/<p[^>]*>([\s\S]*?)<\/p>/.exec(head)||[0,''])[1]).replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'')).trim();
        const chapters=[],seen={},re=/<li class="mb-2">([\s\S]*?)<\/li>/g;let m;
        while((m=re.exec(html))){const a=/href="(?:\.?\/)?detail\.php\?wi=(\d+)"[^>]*>([\s\S]*?)<\/a>/.exec(m[1]);if(!a||seen[a[1]])continue;seen[a[1]]=1;
            const d=((/<div class="l_d_d">([\s\S]*?)<\/div>/.exec(m[1])||[0,''])[1]).replace(/<[^>]+>/g,'').trim();
            chapters.push({name:mtUnesc(a[2].replace(/<[^>]+>/g,'')).replace(/\s+/g,' ').trim(),url:base+'/detail.php?wi='+a[1],dateUpload:mtDirectDate(d)});}
        if(!title||!chapters.length)throw new Error('바로 받기: 회차 '+chapters.length+'개');
        return {name:title,imageUrl:cover,description:intro,chapters:chapters};
    }
    const html=await mtDirectGet('/detail.php?wi='+id,4000,false),urls=[],re=/<img\b[^>]*?\b(?:data-src|data-original|src)=['"]([^'"]+)['"][^>]*>/gi;let m;
    while((m=re.exec(html))){let u=mtUnesc(m[1].trim());if(!/^https?:/.test(u))u=base+'/'+u.replace(/^\.?\//,'');if(!/\/data\/file\//.test(u)||/\/ban\/|\/assets\/|money_toon/.test(u))continue;if(urls.indexOf(u)<0)urls.push(u);}
    if(!urls.length)throw new Error('바로 받기: 그림 0개');
    return urls;
}
function mtDirectDate(t){t=String(t||'').trim();const day=86400000,mid=Math.floor((Date.now()+32400000)/day)*day-32400000;let m;
    if(/^오늘/.test(t)||/\d+\s*(시간|분|초)\s*전/.test(t))return String(mid);if(/^어제/.test(t))return String(mid-day);
    if((m=/^(\d+)\s*일\s*전/.exec(t)))return String(mid-Number(m[1])*day);
    if((m=/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(t)))return String(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))-32400000);return null;}

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
// 0.1.34: 주소 규칙(다른 확장과 같게) — 직접 넣은 주소(mt_domain)는 바로 씀, 자동으로 찾은 주소(mt_origin11)가 번호가 더 크면 그 주소로 바꾸고 칸도 고침, 자동 찾기 끄면 직접 넣은 주소·기본 주소만
const MT_DEFAULT='https://mtoon168.asia',MT_ORIGIN_RE=/^https:\/\/(?:www\.)?mtoon\d+\.asia$/;
function mtNum(o){return Number((/mtoon(\d+)\./.exec(String(o||''))||[])[1]||0);}
function mtPref(k){try{const v=new SharedPreferences().get(k);return v==null?'':String(v);}catch(_){return '';}}
function mtAutoOn(){const v=mtPref('mt_auto_on');return !(v==='false');}
function mtManual(){let v=mtPref('mt_domain').trim().replace(/\/+$/,'').toLowerCase();if(v&&!/^https?:\/\//.test(v))v='https://'+v;v=v.replace(/^http:/,'https:');return MT_ORIGIN_RE.test(v)?v:'';}
let MT_TRY='';
function mtBase11(){if(MT_TRY)return MT_TRY;const manual=mtManual(),on=mtAutoOn();let auto=MT_ORIGIN11||mtPref('mt_origin11');if(!MT_ORIGIN_RE.test(auto))auto='';
    if(manual){if(on&&auto&&mtNum(auto)>mtNum(manual)){try{new SharedPreferences().setString('mt_domain',auto);}catch(_){}return auto;}return manual;}
    return on&&auto?auto:MT_DEFAULT;}
function mtRemember11(origin){const s=String(origin||'').toLowerCase();if(!MT_ORIGIN_RE.test(s))return;const manual=mtManual();if(manual&&mtNum(s)<mtNum(manual))return;MT_ORIGIN11=s;try{new SharedPreferences().setString('mt_origin11',s);}catch(_){}}
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
    // 0.1.36: "제53화 세실의…"·"이세계 밀프 헌터 제132화" 처럼 번호 앞 "제" 도 번호의 일부로 (전엔 번호 없는 회차로 봐서 55.5 같은 번호가 붙음)
    const m = /(?:제\s*)?(\d+(?:\.\d+)?)\s*화\s*[:：\-–.]?\s*(.*)$/.exec(n);
    if (!m) return n;
    const tt = String(title || "").replace(/\s+/g, "");
    // 번호 앞에 작품 제목 말고 다른 글자가 있으면("프롤로그 · 남은 98화") 원래 이름 그대로
    // 0.1.37: 기호·띄어쓰기는 빼고 비교("중증외상센터 : 외과의사 백강혁" ↔ "중증외상센터 외과의사 백강혁 51화"), 번호 앞에 제목이 통째로 있으면("밤꽃:밤에 피는 꽃 24화") 번호로,
    // 남은 글자가 영어·숫자뿐이어도("취향폴더.ZIP 16화" — 제목은 "취향폴더") 번호로, 제목 없이 한글이 남으면("남은 98화") 그대로
    const plain = (v) => String(v || "").replace(/[^\p{L}\p{N}]/gu, "");
    const pt = plain(title), pb = plain(n.substring(0, m.index));
    const before = pt && pb.includes(pt) ? "" : pb.split(pt || "\u0000").join("");
    if (tt && before && /\p{Script=Hangul}/u.test(before)) return n;
    const sub = m[2].trim();
    return `${m[1]}화` + (sub && sub.replace(/\s+/g, "") !== tt ? ` : ${sub}` : "");
}
// 회차 정리 (0.1.25 orderChapters·siteOrder 그대로, 애니요미 Mtoon.messyOrder 와 같은 규칙)
function mtOrderChapters(chapters, title) {
    const n = chapters.length;
    const t = String(title || "").replace(/\s+/g, " ").trim();
    const strip = (v) => {
        let x = String(v || "").replace(/\s+/g, " ").trim();
        if (t && x.startsWith(t)) x = x.substring(t.length).replace(/^[\s\-–:·.]+/, "").trim() || x;
        return x;
    };
    const extra = /외전|번외|특별|후기|에필로그|프롤로그|공지|휴재/;
    const numIn = (v) => { const m = /(\d+(?:\.\d+)?)\s*화/.exec(v); return m && !extra.test(v) ? parseFloat(m[1]) : null; };
    const oldFirst = chapters.slice().reverse();
    let unnumbered = 0;
    let backwards = false;
    let maxSeen = -1;
    for (const c of oldFirst) {
        const v = numIn(strip(c.name));
        if (v === null) { if (!extra.test(c.name)) unnumbered++; continue; }
        if (v < maxSeen) backwards = true;
        maxSeen = Math.max(maxSeen, v);
    }
    if (unnumbered < 3 && !backwards) {
        return mtSiteOrder(chapters.map((c, i) => Object.assign(c, { seq: n - i, name: chapterName(c.name, title) })), title);
    }
    // 같은 이름(빈칸·작품 제목 빼고)으로 다시 올린 것은 최근 것(목록에서 위)만
    const key = (v) => strip(v).replace(/\s+/g, "").toLowerCase();
    const seen = {};
    const kept = chapters.filter((c) => { const k = key(c.name); if (seen[k]) return false; seen[k] = true; return true; });
    const total = kept.length;
    return kept.map((c, i) => {
        const no = total - i;
        const name = strip(c.name);
        const o = Object.assign({}, c);
        // 이름이 같은 번호 "N화" 로 시작하면 그 부분은 빼고 ("33화 - 여름의 짐승 6" → "33화 : 여름의 짐승 6", "1화 - 1화" → "1화")
        let rest = name;
        const lead = new RegExp(`^${no}\\s*화\\s*[:：\\-–.]?\\s*`);
        while (lead.test(rest)) rest = rest.replace(lead, "");
        o.name = rest ? `${no}화 : ${rest}` : `${no}화`;
        return o;
    });
}

function mtSiteOrder(chapters, title) {
    const clean = (list) => list.map((c) => { const o = Object.assign({}, c); delete o.seq; delete o._main; return o; });
    const numOf = (c) => { const x = /^(\d+(?:\.\d+)?)화/.exec(c.name); return x && (c._main || !/외전|번외|특별/.test(c.name)) ? x[1] : null; };
    // 0.1.33 (환골탈태 "환골탈태 248화_외전"·"환골탈태 외전 286화"): 외전 표시가 있어도 그 번호를 본편이 안 쓰면 본편 번호로 ("248화 : 외전")
    {
        const t = String(title || "").replace(/\s+/g, "");
        const main = new Set(chapters.map(numOf).filter((k) => k !== null));
        const taken = new Set();
        for (const c of chapters) {
            if (numOf(c) !== null || !/외전/.test(c.name) || /번외|특별/.test(c.name)) continue;
            const m = /(\d+(?:\.\d+)?)\s*화/.exec(c.name);
            if (!m || main.has(m[1]) || taken.has(m[1])) continue;
            taken.add(m[1]);
            let rest = c.name.replace(m[0], " ").replace(/외전/g, " ");
            if (t) rest = rest.replace(/\s+/g, " ").split(" ").filter((w) => w && t.indexOf(w) < 0).join(" ");
            rest = rest.replace(/^[\s_\-–:·.]+|[\s_\-–:·.]+$/g, "").trim();
            c.name = `${m[1]}화 : 외전${rest ? " " + rest : ""}`;
            c._main = true;
        }
    }
    const best = {};
    chapters.forEach((c) => { const k = numOf(c); if (k !== null && (!best[k] || c.seq > best[k].seq)) best[k] = c; });
    const list = chapters.filter((c) => { const k = numOf(c); return k === null || best[k] === c; }).sort((a, b) => b.seq - a.seq);
    // 0.1.33: 번호 없는 회차 하나가 비어 있는 번호 하나 사이에 끼어 있으면(239화·"마지막화"·241화) 그 번호 ("240화 : 마지막화")
    {
        const used = new Set(list.map(numOf).filter((k) => k !== null).map(Number));
        const t = String(title || "").replace(/\s+/g, " ").trim();
        for (let i = 1; i + 1 < list.length; i++) {
            const c = list[i];
            if (numOf(c) !== null || /^\d/.test(c.name) || /외전|번외|특별|후기|공지|휴재/.test(c.name)) continue;
            const newer = numOf(list[i - 1]);
            const older = numOf(list[i + 1]);
            if (newer === null || older === null) continue;
            const a = Number(older);
            const b = Number(newer);
            if (!Number.isInteger(a) || b !== a + 2 || used.has(a + 1)) continue;
            let rest = String(c.name).replace(/\s+/g, " ").trim();
            if (t && rest.startsWith(t)) rest = rest.substring(t.length).replace(/^[\s\-–:·.]+/, "").trim();
            c.name = `${a + 1}화${rest ? " : " + rest : ""}`;
            c._main = true;
            used.add(a + 1);
        }
    }
    let last = 0;
    let step = 0;
    for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i];
        const k = numOf(c);
        if (k !== null) { last = parseFloat(k); step = 0; continue; }
        if (/^\d/.test(c.name) && !/외전|번외|특별/.test(c.name)) continue;
        step = Math.min(step + 1, 9);
        c.name = `${Math.round((last + (step === 1 ? 0.5 : 0.5 + (step - 1) / 10)) * 10) / 10} · ${c.name}`;
    }
    return clean(list);
}

(function () {
    const base = DefaultExtension.prototype.getDetail;
    DefaultExtension.prototype.getDetail = async function () {
        const d = await base.apply(this, arguments);
        try {
            // 0.1.32: 0.1.25·애니요미와 같은 회차 정리 — 이름이 뒤죽박죽(번호 없는 회차 3개 이상·번호 거꾸로)이면 올라온 순서 차례 번호 "N화 : 부제"
            if (d && Array.isArray(d.chapters)) d.chapters = mtOrderChapters(d.chapters, d.name);
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

// 0.1.34: 새 주소 찾기 — ① 주소 목록 파일 ② 지금 주소가 넘겨 주는 주소 ③ 번호 짐작(지금 번호 -2 ~ +8). 200 + 머니툰 로고(money_toon.png) 확인된 주소만, 번호 큰 것. 전체 9초 안, 1분에 한 번
let MT_DISC_AT = 0;
async function mtProbe(origin) {
    try {
        const c = new Client({ useDartHttpClient: true, followRedirects: false });
        const r = await c.get(origin + "/", { "User-Agent": MT_UA, Referer: origin + "/" });
        const code = Number(r.statusCode);
        if (code === 200 && String(r.body || "").includes("money_toon.png")) return { ok: origin };
        const h = r.headers || {};
        const loc = String(h.location || h.Location || "");
        const m = /^https?:\/\/((?:www\.)?mtoon\d+\.asia)(?:[\/?#]|$)/i.exec(loc);
        if (code >= 300 && code < 400 && m) return { moved: "https://" + m[1].toLowerCase() };
    } catch (e) {
        // 안 열림
    }
    return {};
}
// 0.1.40 (2026-11-13): 6시간마다 주소 목록 파일(감시 작업이 매일 고침)에 지금보다 큰 번호가 있고 머니툰 화면으로 열리면 그 주소로 (잘 열리는 동안에도)
function mtNoteSave(msg) {
    try {
        const d = new Date(Date.now() + 9 * 3600000);
        const z = (n) => String(n).padStart(2, "0");
        new SharedPreferences().setString("mt_listed_note", `${z(d.getUTCMonth() + 1)}.${z(d.getUTCDate())} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())} ${msg}`);
    } catch (e) {
        // 그대로
    }
}
function mtNoteText() {
    try {
        const v = String(new SharedPreferences().getString("mt_listed_note", "") || "");
        const lp = String(new SharedPreferences().getString("mt_last_path", "") || "");
        return (v ? ` · 📡 ${mtBase11().replace(/^https?:\/\//, "")} · 🔎 ${v}` : "") + (lp ? ` · 🚀 마지막 목록 ${lp}` : "");
    } catch (e) {
        return "";
    }
}
async function mtFollow() {
    try {
        if (!mtAutoOn()) return;
        const p = new SharedPreferences();
        if (Date.now() - (Number(p.getString("mt_listed_at", "0")) || 0) < 6 * 3600000) return;
        p.setString("mt_listed_at", String(Date.now()));
        await Promise.race([(async () => {
            const l = await mtListed();
            const cur = mtBase11();
            const h = (u) => String(u).replace(/^https?:\/\//, "");
            if (!l) return mtNoteSave("목록 못 받음");
            if (l === cur || mtNum(l) <= mtNum(cur)) return mtNoteSave(`같음 (${h(l)})`);
            const r = await mtProbe(l);
            if (!r.ok) return mtNoteSave(`${h(l)} 가 아직 안 열려 그대로`);
            if (mtManual()) try { p.setString("mt_domain", r.ok); } catch (_) {}
            mtRemember11(r.ok);
            mtNoteSave(`새 주소 ${h(r.ok)} 로 바꿈`);
        })(), new Promise((r) => setTimeout(r, 6000))]);
    } catch (e) {
        // 다음 기회에
    }
}
async function mtDiscover() {
    if (Date.now() - MT_DISC_AT < 60000) return "";
    MT_DISC_AT = Date.now();
    const cur = mtBase11();
    const work = (async () => {
        const listed = await mtListed();
        const n = mtNum(cur) || mtNum(MT_DEFAULT);
        const pool = [];
        if (listed) pool.push(listed);
        for (let i = n - 2; i <= n + 8; i++) if (i > 0) pool.push("https://mtoon" + i + ".asia");
        if (!pool.includes(cur)) pool.push(cur);
        const res = await Promise.all([...new Set(pool)].map((o) => mtProbe(o)));
        const ok = res.map((x) => x.ok).filter(Boolean);
        const moved = [...new Set(res.map((x) => x.moved).filter((x) => x && !ok.includes(x)))];
        for (const r of await Promise.all(moved.map((o) => mtProbe(o)))) if (r.ok) ok.push(r.ok);
        ok.sort((a, b) => mtNum(b) - mtNum(a));
        return ok.find((o) => o !== cur) || "";
    })();
    let timer;
    const out = await Promise.race([work, new Promise((r) => { timer = setTimeout(() => r(""), 9000); })]);
    return out || "";
}

// 다른 주소로 한 번 불러 보기 (웹뷰가 머니툰 로고를 확인해야 성공, 성공하면 mtFirstList 가 그 주소를 기억)
async function mtTryOrigin(origin, run) {
    const keep = MT_TRY;
    MT_TRY = origin;
    try {
        return await run();
    } finally {
        MT_TRY = keep;
    }
}

(function () {
    const P = DefaultExtension.prototype;
    // 목록: 사이트가 안 열리면 주소 목록 파일의 주소로 한 번 더 (망가요미는 목록을 40초까지만 기다려서 첫 시도가 15초 안에 실패했을 때만)
    const guard = (base) => async function () {
        await mtFollow();
        const t0 = Date.now();
        try {
            return await base.apply(this, arguments);
        } catch (e) {
            const m = String((e && e.message) || e || "");
            if (/로고 미확인|허용 범위 밖|빈 응답|호출 실패|fetch 실패|HTTP 5\d\d/.test(m) && Date.now() - t0 < 15000) {
                const found = mtAutoOn() ? await mtDiscover() : "";
                if (found && found !== mtBase11()) {
                    // 직접 넣은 주소가 안 열려서 찾은 주소(머니툰 화면 확인됨) → 설정 칸도 그 주소로 고침
                    if (mtManual()) try { new SharedPreferences().setString("mt_domain", found); } catch (_) {}
                    mtRemember11(found);
                    try {
                        return await mtTryOrigin(found, () => base.apply(this, arguments));
                    } catch (e2) {
                        // 아래 원래 오류로 (찾은 주소는 기억해 둠 — 다음에 그 주소로)
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
                try { new SharedPreferences().setString("mt_domain", origin); } catch (_) {}
                mtRemember11(origin);
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
    // 0.1.43: 0.1.41 에서 줄(객체)에 글자를 그대로 더해 "[object Object]…" 글자가 돼 망가요미가 필터를 숨겼음 → 줄 이름에 붙임
    const line = verLine(key, list.filter((n) => n && n.t)[0]);
    // 0.1.44: 업데이트 내역 글이 길어 끝이 잘림 → 🚀·🔎 를 버전 바로 뒤로 (줄 하나 그대로, 필터 순서 그대로)
    if (key === "mtoon") {
        const extra = mtNoteText();
        const m = /^(📝 (?:🆕 NEW |⚠️ OLD )?\S+)/.exec(line.name);
        line.name = m ? m[1] + extra + line.name.slice(m[1].length) : line.name + extra;
    }
    return [line];
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
                // 내역 받기가 늦어도 목록이 기다리지 않게 최대 2초
                await Promise.race([notesRefresh(new Client()), new Promise((res) => setTimeout(res, 2000))]);
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
        // 2026-11-11: 정렬이 붙인 차례 번호("86 · 시즌2 43화")가 있으면 그 번호 먼저 (가비지타임: 43 을 읽어 "43.43. 86 · …" 로 꼬였음)
        const pos = /^\s*(\d+(?:\.\d+)?) · /.exec(core);
        if (pos) return parseFloat(pos[1]);
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
        // 2026-11-11: 이름 속 "Episode3"·"EP 2" 는 앱이 맨 앞 번호보다 먼저 회차 번호로 읽음(북코 난공블락 로맨스 "122화 Episode3. 수확철" 26개가 3화로 겹침)
        // → 겹칠 때만 "Episode#3" 으로 바꿔 앱이 맨 앞 "122화" 를 읽게 함
        for (const x of list) x.name = String(x.name || "").replace(/\b(folge|episode|episodio|ep\.?)(\s*)(?=\d)/gi, "$1$2#");
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

// ---------- 빠진 회차 번호 (0.1.33: 앱의 "N화 누락됨" 과 같은 방식) ----------
// 앱(lib/utils/extensions/manga_extensions.dart missingChapterCount): 회차 이름에서 읽은 번호(작품 제목 빼고 첫 숫자, 소수는 버림)의
// 가장 작은 번호 ~ 가장 큰 번호 사이 빈 번호 수. 확장도 회차 이름을 다 고친 뒤(맨 바깥에서) 같은 방식으로 세어 설명 맨 위에 적음
function missingNote(chapters, title) {
    const t = String(title || "").trim().toLowerCase();
    const nums = new Set();
    for (const c of chapters || []) {
        let name = String((c && c.name) || "").toLowerCase();
        if (t) name = name.split(t).join(" ");
        const m = /(\d+)(?:\.\d+)?/.exec(name);
        if (m) nums.add(Number(m[1]));
    }
    if (nums.size < 2) return "";
    const arr = [...nums];
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    if (max - min > 50000) return "";
    const miss = [];
    for (let i = min; i <= max; i++) if (!nums.has(i)) miss.push(i);
    if (!miss.length) return "";
    const shown = miss.slice(0, 10).map((n) => `${n}화`).join(", ");
    return `⚠️ 빠진 회차: ${shown}${miss.length > 10 ? ` 외 ${miss.length - 10}개` : ""} (사이트에 없거나 확장이 못 받아 온 회차)`;
}
(function () {
    const base = DefaultExtension.prototype.getDetail;
    if (!base) return;
    DefaultExtension.prototype.getDetail = async function () {
        const d = await base.apply(this, arguments);
        try {
            const note = d ? missingNote(d.chapters, d.name) : "";
            if (note) d.description = note + (d.description ? "\n\n" + d.description : "");
        } catch (e) {
            // 그대로
        }
        return d;
    };
})();

// 0.1.35: 목록 표지 그림이 안 뜨던 것 — 그림이 사이트(Cloudflare)에 있고 브라우저 User-Agent 없는 요청은 403. 확장에 getHeaders 가 없어서 앱이 UA 없이 받았음(웹뷰를 다녀오면 그때만 됨) → 그림 요청에 UA + Referer
DefaultExtension.prototype.getHeaders = function (url) {
    const m = /^https:\/\/(?:www\.)?mtoon\d+\.asia/i.exec(String(url || ""));
    return { "User-Agent": MT_UA, Referer: (m ? m[0] : mtBase11()) + "/" };
};
