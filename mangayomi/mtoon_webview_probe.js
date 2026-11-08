const mangayomiSources = [{"id":870214020,"name":"머니툰 웹뷰 연결시험","lang":"ko","baseUrl":"https://mtoon165.asia","apiUrl":"","iconUrl":"","typeSource":"single","itemType":0,"isNsfw":true,"hasCloudflare":false,"version":"0.0.3","dateFormat":"","dateFormatLocale":"","pkgPath":"mtoon_webview_probe.js"}];
let MT_WV_PENDING = null;
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
            return {id:String(x.wt_idx||''),name:String(x.wt_title||''),imageUrl:image};
        });
        send({stage:'ok',origin:location.origin,status:r.status,count:data.length,rows:rows});
    }).catch(e=>send({stage:e&&e.name==='AbortError'?'목록 요청 8초 초과':'목록 fetch 실패'})).finally(()=>clearTimeout(timer));
}.toString()+')();';}
async function mtFirstList(){
    if(typeof evaluateJavascriptViaWebview!=='function')throw new Error('WV 0.0.3: 웹뷰 함수 없음');
    let timer,value;try{
        value=await Promise.race([evaluateJavascriptViaWebview('https://mtoon165.asia/',{},[mtListScript()],12),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('WV 0.0.3: 웹뷰 전체 16초 초과')),16000);})]);
    }catch(e){if(e&&String(e.message||'').startsWith('WV 0.0.3:'))throw e;throw new Error('WV 0.0.3: 웹뷰 호출 실패');}
    finally{if(timer&&typeof clearTimeout==='function')clearTimeout(timer);}
    if(value==null||value==='')throw new Error('WV 0.0.3: 웹뷰 빈 응답');
    let data=value;for(let i=0;i<2&&typeof data==='string';i++){try{data=JSON.parse(data);}catch(_){throw new Error('WV 0.0.3: 반환 JSON 해석 실패');}}
    if(!data||data.stage!=='ok'){const address=data?String(data.protocol||'')+'//'+String(data.host||'').replace(/[^a-zA-Z0-9.:-]/g,'').slice(0,80)+String(data.path||'').slice(0,60):'';throw new Error('WV 0.0.3: '+String(data&&data.stage||'예상 밖 반환').slice(0,40)+' | '+address+(data&&data.status?' HTTP '+Number(data.status):''));}
    if(!/^https:\/\/(?:www\.)?mtoon\d+\.asia$/.test(String(data.origin||'')))throw new Error('WV 0.0.3: 반환 출처 검증 실패');
    if(!Array.isArray(data.rows))throw new Error('WV 0.0.3: 반환 목록 없음');
    const list=data.rows.filter(x=>x&&/^\d+$/.test(String(x.id))&&x.name).map(x=>({name:String(x.name),imageUrl:String(x.imageUrl||''),link:data.origin+'/list.php?i='+x.id}));
    if(!list.length)throw new Error('WV 0.0.3: 유효한 작품 0개 (원본 '+Number(data.count||0)+'개)');
    return {list:list,hasNextPage:false};
}
class DefaultExtension extends MProvider{
    getBaseUrl(){return 'https://mtoon165.asia';}
    async getPopular(page){if(Number(page)>1)return {list:[],hasNextPage:false};if(!MT_WV_PENDING)MT_WV_PENDING=mtFirstList().finally(()=>{MT_WV_PENDING=null;});return await MT_WV_PENDING;}
    async getLatestUpdates(page){return this.getPopular(page);}
    async search(query,page,filters){throw new Error('첫 목록 시험 전용입니다. 인기 탭을 열어 주세요.');}
    async getDetail(url){throw new Error('목록 시험 성공 후 작품 상세·회차를 연결할 예정입니다.');}
    async getPageList(url){return [];}
}
