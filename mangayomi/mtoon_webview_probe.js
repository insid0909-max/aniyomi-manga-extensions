const mangayomiSources = [{"id":870214020,"name":"머니툰 웹뷰 연결시험","lang":"ko","baseUrl":"https://mtoon165.asia","apiUrl":"","iconUrl":"","typeSource":"single","itemType":0,"isNsfw":true,"hasCloudflare":false,"version":"0.0.9","dateFormat":"","dateFormatLocale":"","pkgPath":"mtoon_webview_probe.js"}];
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
            return {id:String(x.wt_idx||''),name:String(x.wt_title||''),imageUrl:image,raw:String(x.wt_thumb||'').split(/[?#]/)[0].slice(0,400),dom:String(dom).split(/[?#]/)[0].slice(0,400)};
        });

        send({stage:'ok',origin:location.origin,status:r.status,count:data.length,rows:rows});
    }).catch(e=>send({stage:e&&e.name==='AbortError'?'목록 요청 8초 초과':'목록 fetch 실패'})).finally(()=>clearTimeout(timer));
}.toString()+')('+JSON.stringify(page)+','+JSON.stringify(query)+','+JSON.stringify(options||null)+');';}
async function mtFirstList(page,query,options){
    if(typeof evaluateJavascriptViaWebview!=='function')throw new Error('WV 0.0.9: 웹뷰 함수 없음');
    let timer,value;try{
        value=await Promise.race([evaluateJavascriptViaWebview('https://mtoon165.asia/',{},[mtListScript(page,query,options)],20),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('WV 0.0.9: 웹뷰 전체 24초 초과')),24000);})]);
    }catch(e){if(e&&String(e.message||'').startsWith('WV 0.0.9:'))throw e;throw new Error('WV 0.0.9: 웹뷰 호출 실패');}
    finally{if(timer&&typeof clearTimeout==='function')clearTimeout(timer);}
    if(value==null||value==='')throw new Error('WV 0.0.9: 웹뷰 빈 응답');
    let data=value;for(let i=0;i<2&&typeof data==='string';i++){try{data=JSON.parse(data);}catch(_){throw new Error('WV 0.0.9: 반환 JSON 해석 실패');}}
    if(!data||data.stage!=='ok'){const address=data?String(data.protocol||'')+'//'+String(data.host||'').replace(/[^a-zA-Z0-9.:-]/g,'').slice(0,80)+String(data.path||'').slice(0,60):'';throw new Error('WV 0.0.9: '+String(data&&data.stage||'예상 밖 반환').slice(0,40)+' | '+address+(data&&data.status?' HTTP '+Number(data.status):''));}
    if(!/^https:\/\/(?:www\.)?mtoon\d+\.asia$/.test(String(data.origin||'')))throw new Error('WV 0.0.9: 반환 출처 검증 실패');
    if(!Array.isArray(data.rows))throw new Error('WV 0.0.9: 반환 목록 없음');
    const list=data.rows.filter(x=>x&&/^\d+$/.test(String(x.id))&&x.name).map(x=>({name:String(x.name),imageUrl:String(x.imageUrl||''),link:data.origin+'/list.php?i='+x.id}));
    if(!list.length&&Number(data.count)>0)throw new Error('WV 0.0.9: 목록 항목 해석 실패 (원본 '+Number(data.count)+'개)');
    data.rows.forEach(x=>{if(!x||!/^\d+$/.test(String(x.id)))return;const c={name:String(x.name||''),image:String(x.imageUrl||''),raw:x.raw||'',dom:x.dom||'',state:x.coverState||'미검사 (첫 3개만 검사)'};MT_COVERS[String(x.id)]=c;try{new SharedPreferences().setString('mt_cover07_'+x.id,JSON.stringify(c));}catch(_){}});
    return {list:list,hasNextPage:Number(data.count)>=30};
}
class DefaultExtension extends MProvider{
    getBaseUrl(){return 'https://mtoon165.asia';}
    async getPopular(page){return await mtPaged08(page,'');}
    async getLatestUpdates(page){return this.getPopular(page);}
    getFilterList(){const select=(type,name,rows)=>({type_name:'SelectFilter',type:type,param:type,name:name,state:0,values:rows.map(x=>({type_name:'SelectOption',name:x[0],value:x[1]}))});return [{type_name:'HeaderFilter',name:'제목 입력 시 검색 우선 · 장르 선택 시 요일 대신 장르 적용'},select('state','연재 상태',MT_STATES09),select('day','요일',MT_DAYS09),select('genre','장르',MT_GENRES09)];}
    async search(query,page,filters){return await mtPaged08(page,String(query||'').trim(),mtFilter09(filters));}
    async getDetail(url){return await mtRead07(url,'detail');}
    async getPageList(url){return await mtRead07(url,'pages');}
}

function mtReaderScript07(mode,id){return '('+function(mode,id){
    if(window.__mtRead07)return;window.__mtRead07=true;let done=false,tries=0;
    const send=x=>{if(done)return;done=true;window.flutter_inappwebview.callHandler('setResponse',JSON.stringify(x));};
    const abs=v=>{try{const u=new URL(v,location.href);return /^https?:$/.test(u.protocol)?u.href:'';}catch(_){return '';}};
    const image=el=>el?abs(el.getAttribute('data-src')||el.getAttribute('data-original')||el.getAttribute('src')||''):'';
    const run=()=>{
        if(done)return;tries++;
        if(location.protocol!=='https:'||!/^(?:www\.)?mtoon\d+\.asia$/.test(location.hostname)){send({error:'허용 범위 밖 페이지'});return;}
        const here=new URL(location.href),key=mode==='detail'?'i':'wi';
        if(here.searchParams.get(key)!==id){send({error:'작품 또는 회차 주소 변경'});return;}
        if(mode==='detail'){
            const title=document.querySelector('h1.list_page_title'),links=Array.from(document.querySelectorAll('.list_data .l_d_t a[href]'));
            const seen=new Set(),chapters=[];for(const a of links){const link=abs(a.getAttribute('href'));if(!link)continue;const u=new URL(link);if(u.origin!==location.origin||u.pathname!=='/detail.php'||!/^\d+$/.test(u.searchParams.get('wi')||'')||seen.has(link))continue;seen.add(link);const name=String(a.textContent||'').replace(/\s+/g,' ').trim();if(name)chapters.push({name:name,url:link});}
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
    if(!m||(mode==='detail'?(m[1]!=='list'||m[2]!=='i'):(m[1]!=='detail'||m[2]!=='wi')))throw new Error('WV 0.0.9: 작품/회차 주소 형식 오류');
    if(typeof evaluateJavascriptViaWebview!=='function')throw new Error('WV 0.0.9: 웹뷰 함수 없음');
    let timer,value;try{value=await Promise.race([evaluateJavascriptViaWebview(text,{},[mtReaderScript07(mode,m[3])],20),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('WV 0.0.9: 작품/회차 웹뷰 24초 초과')),24000);})]);}finally{if(timer&&typeof clearTimeout==='function')clearTimeout(timer);}
    for(let n=0;n<2&&typeof value==='string';n++){try{value=JSON.parse(value);}catch(_){throw new Error('WV 0.0.9: 작품/회차 JSON 해석 실패');}}
    if(!value||value.error)throw new Error('WV 0.0.9: '+String(value&&value.error||'빈 응답'));
    if(mode==='detail'){if(!value.detail||!Array.isArray(value.detail.chapters)||!value.detail.chapters.length)throw new Error('WV 0.0.9: 유효한 회차 없음');return value.detail;}
    if(!Array.isArray(value.pages)||!value.pages.length)throw new Error('WV 0.0.9: 본문 이미지 없음');return value.pages;
}

async function mtPaged08(page,query,options){const n=Number(page==null?1:page);if(!Number.isSafeInteger(n)||n<1||n>100000)throw new Error('WV 0.0.9: 잘못된 페이지 번호');const key=JSON.stringify([n,query,options||null]);if(!MT_WV_PENDING[key])MT_WV_PENDING[key]=mtFirstList(n,query,options).finally(()=>{delete MT_WV_PENDING[key];});return await MT_WV_PENDING[key];}

const MT_STATES09 = [["연재", "연재중"], ["완결", "완결"]];
const MT_DAYS09 = [["UP (최근 업데이트)", "8"], ["월", "1"], ["화", "2"], ["수", "3"], ["목", "4"], ["금", "5"], ["토", "6"], ["일", "0"], ["열흘", "7"], ["오늘 요일", "today"]];
const MT_GENRES09 = [["전체 (요일로 보기)", ""], ["판타지", "판타지"], ["액션", "액션"], ["개그", "개그"], ["미스터리", "미스터리"], ["로맨스", "로맨스"], ["드라마", "드라마"], ["무협", "무협"], ["스포츠", "스포츠"], ["일상", "일상"], ["학원", "학원"], ["성인", "성인"], ["BL", "BL"], ["SF", "SF"], ["시대극", "시대극"], ["기타", "기타"]];

function mtFilter09(filters){
    const rows=Array.isArray(filters)?filters:[];
    const pick=(key,name,values)=>{const f=rows.find(x=>x&&(x.type===key||x.param===key||x.name===name)),i=f?Number(f.state):0;return values[Number.isInteger(i)&&i>=0&&i<values.length?i:0][1];};
    const day=pick('day','요일',MT_DAYS09);return {state:pick('state','연재 상태',MT_STATES09),day:day==='today'?String(new Date(Date.now()+9*3600000).getUTCDay()):day,genre:pick('genre','장르',MT_GENRES09)};
}
