const mangayomiSources = [{"id":870214020,"name":"머니툰 웹뷰 연결시험","lang":"ko","baseUrl":"https://mtoon165.asia","apiUrl":"","iconUrl":"","typeSource":"single","itemType":0,"isNsfw":true,"hasCloudflare":false,"version":"0.0.5","dateFormat":"","dateFormatLocale":"","pkgPath":"mtoon_webview_probe.js"}];
let MT_WV_PENDING = null;
const MT_COVERS = {};
function mtListScript(){return '('+function(){
    if(window.__mtListStarted)return;window.__mtListStarted=true;
    const host=String(location.hostname||'').toLowerCase(),pathName=String(location.pathname||'').slice(0,60);
    const site=/^(?:www\.)?mtoon\d+\.asia$/.test(host)&&location.protocol==='https:';
    let done=false;const send=x=>{if(done)return;done=true;x.host=host;x.path=site?pathName:'';x.protocol=String(location.protocol||'');window.flutter_inappwebview.callHandler('setResponse',JSON.stringify(x));};
    if(!site){send({stage:'허용 범위 밖 웹뷰 주소'});return;}
    const mark=Array.from(document.images).some(x=>String(x.getAttribute('src')||'').includes('money_toon.png'));
    if(!mark){send({stage:'머니툰 로고 미확인'});return;}
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);
    const path='/more.php?wt_fin='+encodeURIComponent('연재중')+'&w=8&c=0';
    fetch(path,{method:'POST',credentials:'same-origin',headers:{'X-Requested-With':'XMLHttpRequest'},signal:controller.signal}).then(async r=>{
        const responseUrl=new URL(r.url||path,location.origin);
        if(responseUrl.origin!==location.origin){send({stage:'목록 응답 출처 변경',status:r.status});return;}
        if(!r.ok){send({stage:'목록 HTTP 오류',status:r.status});return;}
        let data;try{data=JSON.parse(await r.text());}catch(_){send({stage:'목록 JSON 아님',status:r.status});return;}
        if(!Array.isArray(data)){send({stage:'목록 배열 아님',status:r.status});return;}
        const rows=data.slice(0,30).filter(x=>x&&typeof x==='object').map(x=>{
            let image='';try{if(x.wt_thumb){const u=new URL(String(x.wt_thumb),location.origin+'/');if(/^https?:$/.test(u.protocol))image=u.href;}}catch(_){}
            let dom='';for(const a of document.querySelectorAll('a[href]')){try{const u=new URL(a.href,location.href);if(u.pathname==='/list.php'&&u.searchParams.get('i')===String(x.wt_idx)){const im=a.querySelector('img')||(a.parentElement&&a.parentElement.querySelector('img'));if(im){dom=im.currentSrc||im.src||'';break;}}}catch(_){}}
            return {id:String(x.wt_idx||''),name:String(x.wt_title||''),imageUrl:image,raw:String(x.wt_thumb||'').split(/[?#]/)[0].slice(0,400),dom:String(dom).split(/[?#]/)[0].slice(0,400)};
        });
        await Promise.all(rows.slice(0,3).map(async row=>{if(!row.imageUrl){row.coverState='주소 없음';return;}const u=new URL(row.imageUrl);if(u.origin!==location.origin){row.coverState='다른 출처: HTTP 검사 생략';return;}const c=new AbortController(),t=setTimeout(()=>c.abort(),5000);try{const response=await fetch(u.href,{credentials:'same-origin',redirect:'error',signal:c.signal});row.coverState='HTTP '+response.status+' | '+String(response.headers.get('content-type')||'형식 없음');if(response.body)await response.body.cancel();}catch(e){row.coverState=e&&e.name==='AbortError'?'표지 HTTP 5초 초과':'표지 HTTP 요청 실패';}finally{clearTimeout(t);}}));
        send({stage:'ok',origin:location.origin,status:r.status,count:data.length,rows:rows});
    }).catch(e=>send({stage:e&&e.name==='AbortError'?'목록 요청 8초 초과':'목록 fetch 실패'})).finally(()=>clearTimeout(timer));
}.toString()+')();';}
async function mtFirstList(){
    if(typeof evaluateJavascriptViaWebview!=='function')throw new Error('WV 0.0.5: 웹뷰 함수 없음');
    let timer,value;try{
        value=await Promise.race([evaluateJavascriptViaWebview('https://mtoon165.asia/',{},[mtListScript()],20),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('WV 0.0.5: 웹뷰 전체 24초 초과')),24000);})]);
    }catch(e){if(e&&String(e.message||'').startsWith('WV 0.0.5:'))throw e;throw new Error('WV 0.0.5: 웹뷰 호출 실패');}
    finally{if(timer&&typeof clearTimeout==='function')clearTimeout(timer);}
    if(value==null||value==='')throw new Error('WV 0.0.5: 웹뷰 빈 응답');
    let data=value;for(let i=0;i<2&&typeof data==='string';i++){try{data=JSON.parse(data);}catch(_){throw new Error('WV 0.0.5: 반환 JSON 해석 실패');}}
    if(!data||data.stage!=='ok'){const address=data?String(data.protocol||'')+'//'+String(data.host||'').replace(/[^a-zA-Z0-9.:-]/g,'').slice(0,80)+String(data.path||'').slice(0,60):'';throw new Error('WV 0.0.5: '+String(data&&data.stage||'예상 밖 반환').slice(0,40)+' | '+address+(data&&data.status?' HTTP '+Number(data.status):''));}
    if(!/^https:\/\/(?:www\.)?mtoon\d+\.asia$/.test(String(data.origin||'')))throw new Error('WV 0.0.5: 반환 출처 검증 실패');
    if(!Array.isArray(data.rows))throw new Error('WV 0.0.5: 반환 목록 없음');
    const list=data.rows.filter(x=>x&&/^\d+$/.test(String(x.id))&&x.name).map(x=>({name:String(x.name),imageUrl:String(x.imageUrl||''),link:data.origin+'/list.php?i='+x.id}));
    if(!list.length)throw new Error('WV 0.0.5: 유효한 작품 0개 (원본 '+Number(data.count||0)+'개)');
    data.rows.forEach(x=>{if(!x||!/^\d+$/.test(String(x.id)))return;const c={name:String(x.name||''),image:String(x.imageUrl||'').replace(/[?#].*$/,''),raw:x.raw||'',dom:x.dom||'',state:x.coverState||'미검사 (첫 3개만 검사)'};MT_COVERS[String(x.id)]=c;try{new SharedPreferences().setString('mt_cover05_'+x.id,JSON.stringify(c));}catch(_){}});
    return {list:list,hasNextPage:false};
}
class DefaultExtension extends MProvider{
    getBaseUrl(){return 'https://mtoon165.asia';}
    async getPopular(page){if(Number(page)>1)return {list:[],hasNextPage:false};if(!MT_WV_PENDING)MT_WV_PENDING=mtFirstList().finally(()=>{MT_WV_PENDING=null;});return await MT_WV_PENDING;}
    async getLatestUpdates(page){return this.getPopular(page);}
    async search(query,page,filters){throw new Error('첫 목록 시험 전용입니다. 인기 탭을 열어 주세요.');}
    async getDetail(url){const m=/[?&]i=(\d+)/.exec(String(url)),id=m?m[1]:'';let c=MT_COVERS[id];if(!c){try{c=JSON.parse(new SharedPreferences().get('mt_cover05_'+id)||'null');}catch(_){}}if(!c)throw new Error('표지시험 0.0.5: 진단 정보 없음. 인기 목록을 새로 불러온 뒤 첫 작품을 열어 주세요.');return {name:c.name,imageUrl:c.image,description:'표지시험 0.0.5\n결과: '+c.state+'\n원래 값: '+c.raw+'\n조합 주소: '+c.image+'\n사이트 이미지 후보: '+(c.dom||'찾지 못함')+'\n진단 전용이며 회차는 아직 연결하지 않았습니다.',chapters:[]};}
    async getPageList(url){return [];}
}
