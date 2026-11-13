const mangayomiSources = [
    {
        "id": 1543270643,
        "name": "토끼 소설",
        "lang": "ko",
        "baseUrl": "https://toki36.com",
        "apiUrl": "",
        "iconUrl": "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/icon/eu.kanade.tachiyomi.extension.ko.newxtoon.png",
        "typeSource": "single",
        "itemType": 2,
        "isNsfw": false,
        "hasCloudflare": true,
        "version": "0.1.5",
        "dateFormat": "",
        "dateFormatLocale": "",
        "pkgPath": "tokinovel.js"
    }
];

// 토끼 소설(뉴토끼 sbxh9.com 소설, 2026-11-10 정식 0.1.0) — 다른 망가요미 저장소(dc-manhwa) Toki 소설 1.0.7 바탕 시험판(0.0.1, 휴대폰 확인)을 그대로 옮김.
// 북코 소설과 작품은 거의 같지만(표본 100%) 일부 작품은 새 회차가 더 빠름(표본 20개 중 7개).
const USER_AGENT="Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",SITES={toki:["toki_url","https://toki35.com","domain_number","https://toki<n>.com"],sbxh:["sbxh_url","https://sbxh9.com","sbxh_domain_number","https://sbxh<n>.com"],newtoki:["newtoki_url","https://newtoki1.org","newtoki_domain_number","https://newtoki<n>.org"]},SITE_LABELS={toki:"Toki",sbxh:"SBXH",newtoki:"Newtoki"},siteAddress=e=>{const t=String(e).trim().replace(/\/+$/,"");if(!/^https?:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/i.test(t))throw new Error("http:// 또는 https://로 시작하는 사이트 주소를 입력해 주세요.");const r=/:(\d+)$/.exec(t)?.[1];if(r&&(Number(r)<1||Number(r)>65535))throw new Error("올바른 포트 번호를 입력해 주세요.");return t},siteUrl=e=>{const[t,r,n,i]=SITES[e],s=new SharedPreferences;let o=String(s.get(t)||"").trim();if(!o){const e=String(s.get(n)||"").trim();o=/^\d+$/.test(e)?i.replace("<n>",e):r}return siteAddress(o)},sitePreferences=()=>Object.entries(SITES).map(([e,[t,r]])=>({key:t,editTextPreference:{title:`${SITE_LABELS[e]} 사이트 주소`,summary:`전체 사이트 주소를 입력합니다. 비우면 기본 주소(${r})로 돌아갑니다.`,value:r,dialogTitle:"사이트 주소",dialogMessage:`예: ${r}/`}})),PAGE_SIZE=40,UPDATES_PER_PAGE=50,EPISODE_PAGES=200,SORTS=[["new","최신순"],["fresh","신작순"],["hot","북마크순"],["views","조회순"],["rating","평점순"],["episodes","화수순"]],GENRES=["판타지","무협","19금","현대","로맨스","로맨스 판타지","BL","라노벨","기타"],PLATFORMS=[["user","직접 업로드"],["novelpia","노벨피아"],["booktoki","북토끼"],["munpia","문피아"],["joara","조아라"],["kakaopage","카카오페이지"],["series","네이버 시리즈"],["ridi","리디북스"],["etc","기타"]],escapeHtml=e=>String(e).replace(/[&<>"]/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[e])),decodeEntities=e=>String(e).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(e,t)=>{const r=t.toLowerCase();return"#"===r[0]?String.fromCodePoint(parseInt("x"===r[1]?r.slice(2):r.slice(1),"x"===r[1]?16:10)):{amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" "}[r]}),plainText=e=>decodeEntities(String(e).replace(/<!--[\s\S]*?-->/g,"").replace(/<[^>]+>/g,"")).replace(/\s+/g," ").trim(),unique=e=>[...new Set(e)];class DefaultExtension extends MProvider{get supportsLatest(){return!0}get cdn(){return"sbxh_cdn"===((new SharedPreferences).get("site")||"sbxh")}get site(){const e=(new SharedPreferences).get("site");return Object.keys(SITES).includes(e)?e:"sbxh"}siteUrl(e){return siteUrl(e)}get baseUrl(){return this.cdn?"https://sbxh9.b-cdn.net":this.siteUrl(this.site)}get readerUrl(){return this.cdn?this.siteUrl("sbxh"):this.baseUrl}getHeaders(e){const t=(e||this.baseUrl).replace(/\/+$/,"");return{"User-Agent":USER_AGENT,Referer:t+"/"}}getSourcePreferences(){return[{key:"site",listPreference:{title:"사이트",summary:"작품을 가져올 사이트 (CDN 선택 시 본문은 SBXH 사이트에서 읽습니다)",valueIndex:0,entries:["sbxh","newtoki","toki","sbxh-cdn"],entryValues:["sbxh","newtoki","toki","sbxh_cdn"]}}].concat(sitePreferences())}get client(){return this._client||(this._client=new Client({timeout:25,connectTimeout:5}))}async fetch(e,t=!1){const r=this.getHeaders();t&&(r.Accept="application/json");const n=await this.client.get(this.baseUrl+e,r);if(n.statusCode<200||n.statusCode>=300)throw new Error(`사이트 요청에 실패했습니다 (HTTP ${n.statusCode}). WebView에서 사이트를 확인해 주세요.`);const i=n.body||"";if(/cf-chl-|cf-turnstile|<title>Just a moment/i.test(i))throw new Error("WebView에서 사이트 인증을 완료한 후 다시 시도해 주세요.");if(!t)return i;try{return JSON.parse(i)}catch(e){throw new Error("사이트 응답을 읽지 못했습니다. 선택한 사이트가 소설 목록을 제공하지 않을 수 있습니다.")}}path(e){const t=String(e).trim().replace(/^https?:\/\/[^/]+/i,"").split(/[?#]/)[0],r=/^\/novel\/(\d+)(?:\/(\d+))?\/?$/.exec(t);if(!r)throw new Error("올바른 소설 주소가 아닙니다.");return r[2]?`/novel/${r[1]}/${r[2]}`:`/novel/${r[1]}`}query(e){return Object.entries(e).filter(([,e])=>""!==e&&null!=e).map(([e,t])=>encodeURIComponent(e)+"="+encodeURIComponent(t)).join("&")}value(e,t,r=""){const n=(e||[]).find(e=>e?.type===t);return n?n.values?n.values[n.state]?.value??r:n.state??r:r}group(e,t,r){const n=(e||[]).find(e=>e?.type===t);return Array.isArray(n?.state)?n.state.filter(e=>e.state===r).map(e=>e.value):[]}typed(e,t){return String(this.value(e,t,"")).split(",").map(e=>e.trim()).filter(Boolean)}work(e){return{name:String(e.title||e.novelTitle||"").trim(),link:`/novel/${e.id||e.novelId}`,imageUrl:"string"==typeof e.thumbnailUrl&&/^https?:\/\//.test(e.thumbnailUrl)?e.thumbnailUrl:"",author:String(e.author||"").trim(),genre:String(e.genre||"").split(",").map(e=>e.trim()).filter(Boolean)}}listParams(e,t,r,n){const i=this.group(r,"genre",1).concat(this.group(r,"genre",2).map(e=>"-"+e),this.typed(r,"genre_text"));return{q:String(t||"").trim(),g:unique(i).join(","),p:unique(this.group(r,"platform",1).concat(this.group(r,"platform",2).map(e=>"-"+e))).join(","),t:unique(this.typed(r,"tag_text")).join(","),sort:"popular"===n?"views":this.value(r,"sort","new"),status:"completed"===this.value(r,"mode","list")?"completed":"",page:String(e),pageSize:String(40)}}async listing(e,t,r,n){if(!Number.isSafeInteger(e)||e<1)throw new Error("올바른 목록 페이지가 아닙니다.");const i=await this.fetch("/api/novel-list?"+this.query(this.listParams(e,t,r,n)),!0),s=Array.isArray(i?.novels)?i.novels:null;if(!s)throw new Error("소설 목록을 찾을 수 없습니다. 선택한 사이트가 소설을 제공하지 않을 수 있습니다.");const o=new Set,a=[];for(const e of s)/^\d+$/.test(String(e?.id))&&e.title&&!o.has(e.id)&&(o.add(e.id),a.push(this.work(e)));return{list:a,hasNextPage:s.length>=40}}allCards(e){const t=[];for(const r of e.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g))try{const e=JSON.parse(r[1]);"string"==typeof e[1]&&t.push(e[1])}catch(e){}const r=t.join(""),n=r.indexOf('"allCards":[');if(n<0)throw new Error("업데이트 목록을 찾을 수 없습니다. 사이트 구조가 바뀌었을 수 있습니다.");let i=0,s=!1;for(let e=n+11;e<r.length;e++){const t=r[e];if(s)"\\"===t?e++:'"'===t&&(s=!1);else if('"'===t)s=!0;else if("["===t||"{"===t)i++;else if(("]"===t||"}"===t)&&0===--i){return JSON.parse(r.slice(n+11,e+1)).filter(e=>/^\d+$/.test(String(e?.novelId))&&e.novelTitle)}}throw new Error("업데이트 목록을 읽지 못했습니다.")}async updates(e,t){if(!Number.isSafeInteger(e)||e<1)throw new Error("올바른 목록 페이지가 아닙니다.");const r=String(t||"").trim().toLowerCase(),n=new Set,i=[];for(const e of this.allCards(await this.fetch("/novel/updates")))n.has(e.novelId)||r&&!String(e.novelTitle).toLowerCase().includes(r)||(n.add(e.novelId),i.push(e));const s=50*(e-1);return{list:i.slice(s,s+50).map(e=>this.work(e)),hasNextPage:i.length>s+50}}getPopular(e){return this.listing(e,"",[],"popular")}getLatestUpdates(e){return this.updates(e,"")}search(e,t,r){return"updates"===this.value(r,"mode","list")?this.updates(t,e):this.listing(t,e,r||[],"search")}getFilterList(){const e=(e,t,r)=>({type_name:"SelectFilter",type:e,name:t,state:0,values:r.map(([e,t])=>({type_name:"SelectOption",name:t,value:e}))}),t=(e,t,r)=>({type_name:"GroupFilter",type:e,name:t,state:r.map(([e,t])=>({type_name:"TriState",value:e,name:t,state:0}))}),r=(e,t)=>({type_name:"TextFilter",type:e,name:t,state:""});return[{type_name:"HeaderFilter",name:"업데이트 목록은 검색어로 제목만 걸러내고 다른 필터를 적용하지 않습니다"},e("mode","목록",[["list","작품 목록"],["updates","업데이트"],["completed","완결"]]),e("sort","정렬",SORTS),t("genre","장르",GENRES.map(e=>[e,e])),r("genre_text","장르 직접 입력 (쉼표로 구분, 앞에 - 는 제외)"),t("platform","플랫폼",PLATFORMS),r("tag_text","태그 직접 입력 (쉼표로 구분)")]}date(e){const t=/^(\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?$/.exec(String(e||"").trim());if(!t)return null;const r=Date.parse(`20${t[1]}-${t[2].padStart(2,"0")}-${t[3].padStart(2,"0")}T00:00:00+09:00`);return Number.isFinite(r)?String(r):null}async chapters(e,t){const r=new Map,n=new Set;let i="999999999:999999999999";for(let t=0;t<200;t++){const s=await this.fetch(`/api/novel/${e}/episodes/window?`+this.query({direction:"older",cursor:i}),!0);if(!s?.ok||!Array.isArray(s.items))throw new Error(t?"회차 목록 일부를 불러오지 못했습니다. 다시 시도해 주세요.":"회차 목록을 찾을 수 없습니다.");for(const t of s.items){if(!/^\d+$/.test(String(t?.id)))continue;const i=`/novel/${e}/${t.id}`;if(n.has(i))continue;if(n.add(i),t.isNotReady)continue;let s=[String(t.episodeLabel||(null!=t.number?`${t.number}화`:"")).trim(),String(t.title||"").trim()].filter(Boolean).join(" ")||`회차 ${t.id}`;!(t.isPaid||t.gateMode&&"none"!==t.gateMode)||t.isUnlocked||t.showFree||(s=`🔒 [${Number(t.cost)>0?t.cost+"P":"유료"}] ${s}`),Number.isFinite(Number(t.number))&&Number(t.number)>0&&(s=`${Number(t.number)} - ${s}`),r.set(i,{name:s,url:i,dateUpload:this.date(t.publishedAtLabel),scanlator:null})}if(!s.hasOlder||!s.olderCursor||s.olderCursor===i||!s.items.length)break;if(i=String(s.olderCursor),199===t)throw new Error("회차 목록이 200페이지를 초과하여 전체를 불러올 수 없습니다.")}if(!n.size)throw new Error("회차 목록이 비어 있습니다.");if(t>n.size)throw new Error(`회차 일부만 불러왔습니다 (${n.size}/${t}). 다시 시도해 주세요.`);return[...r.values()]}async getDetail(e){const t=this.path(e),r=t.split("/")[2];if(3!==t.split("/").length)throw new Error("회차 주소가 아닌 작품 주소를 입력해 주세요.");const n=await this.fetch(t),i=/<section class="novel-detail">([\s\S]*?)<\/section>/.exec(n)?.[1],s=plainText(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(i||"")?.[1]||"");if(!i||!s)throw new Error("작품 정보를 찾을 수 없습니다. WebView에서 주소를 확인해 주세요.");const o=/<div class="nd-thumb[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(i)?.[1]||"",a=/<img[^>]+src="([^"]+)"/.exec(o)?.[1]||"",l=Number((/에피소드 \(([\d,<!\- >]*)화\)/.exec(n)?.[1]||"").replace(/\D/g,""))||0;return{name:s,link:t,imageUrl:/^https?:\/\//.test(decodeEntities(a))?decodeEntities(a):"",author:[...i.matchAll(/field=author[^>]*>([\s\S]*?)<\/a>/g)].map(e=>plainText(e[1])).filter(Boolean).join(", "),description:decodeEntities((/<p class="nd-desc">([\s\S]*?)<\/p>/.exec(i)?.[1]||"").replace(/<br\s*\/?>/gi,"\n").replace(/<[^>]+>/g,"")).replace(/[ \t]+/g," ").trim(),genre:unique([...i.matchAll(/class="hero-v2-tag"[^>]*>([\s\S]*?)<\/a>/g)].map(e=>plainText(e[1])).filter(Boolean)),status:/nv-badge--done/.test(o)?1:0,chapters:await this.chapters(r,l)}}render(e,t){const r=t.map(e=>e.image?`<p><img src="${escapeHtml(e.image)}"></p>`:`<p>${escapeHtml(e.text)}</p>`);return(e?`<h2>${escapeHtml(e)}</h2>\n`:"")+r.join("\n")}async getHtmlContent(e,t){const r=this.path(t);if(4!==r.split("/").length)throw new Error("회차 주소가 아닙니다.");const n=this.readerUrl,i=await sendMessage("evaluateJavascriptViaWebview",JSON.stringify([n+r,this.getHeaders(n),[`(${tokiNovelReader.toString()})()`],60]));if(!i)throw new Error("회차 본문을 불러오지 못했습니다 (시간 초과). WebView에서 사이트를 연 후 다시 시도해 주세요.");let s;try{s=JSON.parse(i)}catch(e){throw new Error("WebView에서 올바른 본문 응답을 받지 못했습니다.")}if(s?.error)throw new Error(s.error);const o=Array.isArray(s?.paragraphs)?s.paragraphs.filter(e=>e&&(e.image||String(e.text||"").trim())):[];if(!o.length)throw new Error("회차 본문이 비어 있습니다.");return this.render(String(s.title||e||"").trim(),o)}async cleanHtmlContent(e){return e}}function tokiNovelReader(){if(window.__dcTokiNovel)return;window.__dcTokiNovel=!0;let e=!1,t=0,r=0;const n=[],i=Element.prototype.attachShadow;function s(t){e||(e=!0,window.flutter_inappwebview.callHandler("setResponse",JSON.stringify(t)))}Element.prototype.attachShadow=function(e){const t=i.call(this,e);return n.push(t),t};const o=setInterval(()=>{if(e)return void clearInterval(o);t++;const i=[...document.querySelectorAll("article.novel-viewer *")].map(e=>e.__novelShadow).filter(Boolean),a=n.concat(i).find(e=>e.querySelector("p, figure, .novel-epub-rendered")),l="string"==typeof window.__novelTTSText?window.__novelTTSText.trim():"";if(a||l){const e=a?function(e){const t=[];for(const r of e.children)if("P"===r.tagName){const e=(r.textContent||"").trim();e&&t.push({text:e})}else if("FIGURE"===r.tagName){const e=r.querySelector("img")?.src;e&&t.push({image:e})}else if(r.classList?.contains("novel-epub-rendered")){let e="";const n=()=>{e.trim()&&t.push({text:e.trim()}),e=""},i=r=>{if(3===r.nodeType)return void(e+=r.textContent||"");if(1!==r.nodeType||/^(SCRIPT|STYLE|NOSCRIPT)$/.test(r.tagName))return;if("IMG"===r.tagName)return n(),void(r.src&&t.push({image:r.src}));if("BR"===r.tagName)return void(e+="\n");const s=/^(P|DIV|SECTION|ARTICLE|H[1-6]|LI|BLOCKQUOTE|FIGURE|TR)$/.test(r.tagName);s&&n();for(const e of r.childNodes)i(e);s&&n()};i(r),n()}return t}(a):[],t=e.length?e:l.split(/\n{2,}/).map(e=>e.trim()).filter(Boolean).map(e=>({text:e}));if(t.length)return void s({title:(document.querySelector("h1.ne-h1")?.textContent||"").trim(),paragraphs:t})}const c=document.querySelector("article.novel-viewer")?.innerText||"";if(/퍼즐 조각을 맞춰주세요|봇 확인/.test(c))s({error:"사이트가 봇 확인(퍼즐)을 요구합니다. WebView에서 이 회차를 열어 확인을 마친 뒤 다시 시도해 주세요."});else if(r=/일시적 오류|다시 시도|로그인|이용 권한|포인트/.test(c)?r+1:0,r>=12||t>=220){const e=c.replace(/\s+/g," ").trim().slice(0,80);s({error:r?`사이트가 본문을 내주지 않았습니다: ${e}`:"회차 본문을 불러오지 못했습니다. WebView에서 사이트를 연 후 다시 시도해 주세요."})}},250)}

// ---------- 0.1.1: 주소 하나로 + 주소 자동 찾기 (2026-11-11, 사용자 "저 3곳이 같은 곳이라 주소를 같이 써도 될 것 같은데") ----------
// 뉴토끼는 이름을 바꿔 가며 옮겨 다님 — 공식 안내 페이지(뉴토주소.com) 변경 기록: newtoki463~469 → sbxh2~9 → toki25~36(지금), newtoki1.org(구버전 주소).
// toki·sbxh·newtoki 를 따로 고르던 설정을 "사이트 주소" 한 칸 + "주소 자동 찾기" 로 합침. 어느 이름의 주소든 받음.
// 사이트가 안 열리면(연결 실패·5xx·451·응답이 사이트가 아님) 주소 목록(domains.json) → 지금 주소가 넘겨 준 주소 → 안내 페이지의 주소 → 같은 이름 번호 +1~+3 중
// 첫 화면 200 + "뉴토끼" 글자가 확인된 주소로 바꾸고 다시 받음. 검색창에 주소를 붙여 넣으면 확인 후 그 주소로(작품 주소면 그 작품).
(function (P) {
    const DEF = "https://toki36.com"; // 2026-11-12 sbxh9 끊김(인증서 안 맞음), toki36 열림(사용자 확인)
    const LIST = "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/main/domains.json";
    const GUIDE = "https://xn--vg1b79zgsf1sj.com/"; // 뉴토주소.com
    const HOST = /^https:\/\/(?:toki|sbxh|newtoki)\d+\.(?:com|org|net)$/;
    const RANK = { newtoki: 1, sbxh: 2, toki: 3 }; // 안내 페이지 변경 기록 차례
    const LEGACY = { toki: ["toki_url", "https://toki35.com"], sbxh: ["sbxh_url", "https://sbxh9.com"], newtoki: ["newtoki_url", "https://newtoki1.org"] };
    const pref = (k) => { try { const v = new SharedPreferences().get(k); return v == null ? "" : String(v); } catch (_) { return ""; } };
    const save = (k, v) => { try { new SharedPreferences().setString(k, String(v)); } catch (_) {} };
    const norm = (u) => {
        let v = String(u || "").trim().replace(/\/+$/, "").toLowerCase();
        if (!v) return "";
        if (!/^https?:\/\//.test(v)) v = "https://" + v;
        v = v.replace(/^http:/, "https:").replace("://www.", "://").replace(/^(https:\/\/[^/?#]+).*$/, "$1");
        return HOST.test(v) ? v : "";
    };
    const fam = (u) => (/\/\/([a-z]+)\d+\./.exec(u) || [])[1] || "";
    const num = (u) => Number((/\/\/[a-z]+(\d+)\./.exec(u) || [])[1] || 0);
    const newer = (a, b) => (RANK[fam(a)] || 0) !== (RANK[fam(b)] || 0) ? (RANK[fam(a)] || 0) > (RANK[fam(b)] || 0) : num(a) > num(b);
    const autoOn = () => pref("toki_auto_on") !== "false";
    const manual = () => {
        const m = norm(pref("toki_domain"));
        if (m) return m;
        // 0.1.0 에서 사이트별 칸에 직접 넣어 둔 주소가 있으면 그대로 이어 씀
        const site = LEGACY[pref("site")] ? pref("site") : "sbxh";
        const old = norm(pref(LEGACY[site][0]));
        return old && old !== LEGACY[site][1] ? old : "";
    };
    let TRY = "";
    Object.defineProperty(P, "baseUrl", {
        configurable: true,
        get() {
            if (TRY) return TRY;
            const m = manual();
            const a = norm(pref("toki_auto_domain"));
            if (m) {
                if (autoOn() && a && newer(a, m)) { save("toki_domain", a); return a; }
                return m;
            }
            return autoOn() && a ? a : DEF;
        },
    });
    Object.defineProperty(P, "readerUrl", { configurable: true, get() { return this.baseUrl; } });
    Object.defineProperty(P, "cdn", { configurable: true, get() { return false; } });
    P.getSourcePreferences = function () {
        return [
            { key: "toki_domain", editTextPreference: { title: "사이트 주소", summary: "비워 두면 자동으로 찾은 주소(기본 toki36.com). toki·sbxh·newtoki 는 같은 뉴토끼라 어느 주소든 됨. 더 새 주소가 확인되면 자동으로 바뀜", value: "", dialogTitle: "사이트 주소", dialogMessage: "예: https://toki36.com (https:// 없어도 됨)" } },
            { key: "toki_auto_on", switchPreferenceCompat: { title: "주소 자동 찾기", summary: "사이트가 안 열리면 주소 목록·안내 페이지(뉴토주소.com)·번호 주소 중 뉴토끼 화면이 확인된 주소로 바꿈. 기본 켬", value: true } },
        ];
    };
    async function probe(u) {
        try {
            const c = new Client({ useDartHttpClient: true, followRedirects: false, timeout: 6, connectTimeout: 4 });
            const r = await c.get(u + "/", { "User-Agent": webUa() || USER_AGENT, Referer: u + "/" });
            const code = Number(r.statusCode);
            const body = String(r.body || "");
            if (code === 200 && /뉴토끼|newtoki/i.test(body) && /\/novel|\/webtoon|\/comic/.test(body)) return { ok: u };
            const h = r.headers || {};
            const loc = norm(String(h.location || h.Location || ""));
            if (code >= 300 && code < 400 && loc && loc !== u) return { moved: loc };
        } catch (_) {
            // 안 열림
        }
        return {};
    }
    async function listed() {
        try {
            const r = await new Client({ timeout: 6, connectTimeout: 4 }).get(LIST, {});
            return norm((((JSON.parse(String(r.body || "{}")).domains || {}).tokinovel || {}).baseUrl) || "");
        } catch (_) {
            return "";
        }
    }
    async function guided() {
        try {
            const r = await new Client({ timeout: 6, connectTimeout: 4 }).get(GUIDE, { "User-Agent": USER_AGENT });
            const out = [];
            for (const m of String(r.body || "").matchAll(/(?:toki|sbxh|newtoki)\d+\.(?:com|org|net)/gi)) { const u = norm(m[0]); if (u && !out.includes(u)) out.push(u); }
            return out.slice(0, 4); // 맨 위가 지금 주소(그다음 구버전·지난 주소)
        } catch (_) {
            return [];
        }
    }
    let DISC_AT = 0;
    async function discover(cur) {
        if (Date.now() - DISC_AT < 60000) return "";
        DISC_AT = Date.now();
        const work = (async () => {
            const [l, g] = await Promise.all([listed(), guided()]);
            const order = [];
            const add = (u) => { if (u && u !== cur && !order.includes(u)) order.push(u); };
            add(l);
            g.forEach(add);
            const f = fam(cur), n = num(cur);
            if (f && n) for (let i = 1; i <= 3; i++) add(`https://${f}${n + i}.${(/\.(\w+)$/.exec(cur) || [])[1] || "com"}`);
            const res = await Promise.all([cur, ...order].map(probe));
            const moved = res.map((x) => x.moved).filter((x) => x && x !== cur && !order.includes(x));
            for (const r of await Promise.all(moved.map(probe))) if (r.ok) return r.ok;
            for (let i = 1; i < res.length; i++) if (res[i].ok) return res[i].ok;
            return "";
        })();
        return await Promise.race([work, new Promise((r) => setTimeout(() => r(""), 9000))]);
    }
    const NET = /HTTP (?:5\d\d|451)|응답을 읽지 못했|Connection|Socket|Failed host|host lookup|timed out|Timeout|handshake|Network|refused|reset|연결/i;
    // 0.1.3 (2026-11-13, 사용자 "애니요미 목록 잘뜸 망가요미 인증 실패"): Cloudflare 통과 쿠키는 웹뷰 User-Agent 에 묶임 →
    // 고정 UA(Chrome/126) 로 보내면 웹뷰에서 인증해도 계속 확인 화면. UA 는 앱(웹뷰 UA)에 맡기고, 그래도 확인 화면이면 숨은 웹뷰로 통과(최대 15초).
    const CF = /cf-chl-|cf-turnstile|<title>Just a moment/i;
    // 0.1.4: 휴대폰 웹뷰의 진짜 User-Agent 를 저장해 목록·본문·표지·주소 확인 모두 같은 값으로 (서로 다른 값이면 통과 쿠키가 왔다 갔다 → 됐다 안 됐다)
    const webUa = () => pref("toki_web_ua");
    const uaHdr = () => (webUa() ? { "User-Agent": webUa() } : {});
    let NO_UA = false;
    P.getHeaders = function (e) {
        const t = (e || this.baseUrl).replace(/\/+$/, "");
        const h = { Referer: t + "/" };
        if (!NO_UA || webUa()) h["User-Agent"] = webUa() || USER_AGENT;
        return h;
    };
    const G = P.getHtmlContent;
    P.getHtmlContent = async function (a, b) {
        NO_UA = true; // 본문 웹뷰에 고정 UA 를 넣지 않음 (웹뷰 자기 값 그대로)
        try {
            return await G.call(this, a, b);
        } finally {
            NO_UA = false;
        }
    };
    const good = (t, json) => !!t && !CF.test(t) && (json ? /^\s*[\[{]/.test(t) : /\/novel/.test(t));
    async function viaWeb(url, json, wait) {
        const mark = json ? "J" : "H";
        const script = "(function(){var done=false,J='" + mark + "'==='J';function send(h){if(done)return;done=true;window.flutter_inappwebview.callHandler('setResponse',navigator.userAgent+'\\n'+h);}" +
            "function ok(t){return !!t&&!/cf-chl-|cf-turnstile|<title>Just a moment/i.test(t)&&(J?/^\\s*[\\[{]/.test(t):t.indexOf('/novel')>=0);}" +
            "function f(){var t=J&&document.body?document.body.innerText:document.documentElement.outerHTML;if(ok(t)){send(t);return true;}return false;}" +
            "if(f())return;var n=0;var tm=setInterval(function(){if(done||f()){clearInterval(tm);return;}n++;" +
            "if(n%5===0&&window.fetch){fetch(location.href,{credentials:'include'}).then(function(r){return r.text();}).then(function(t){if(ok(t)){clearInterval(tm);send(t);}}).catch(function(){});}},300);})();";
        try {
            const call = typeof evaluateJavascriptViaWebview === "function"
                ? evaluateJavascriptViaWebview(url, {}, [script])
                : sendMessage("evaluateJavascriptViaWebview", JSON.stringify([url, {}, [script], Math.ceil(wait / 1000)]));
            const r = await Promise.race([call, new Promise((res) => setTimeout(() => res("__TO__"), wait))]);
            if (!r || r === "__TO__") return "";
            const v = String(r);
            const i = v.indexOf("\n");
            const ua = i > 0 ? v.slice(0, i).trim() : "";
            if (/^Mozilla\//.test(ua)) save("toki_web_ua", ua);
            return i > 0 ? v.slice(i + 1) : v;
        } catch (_) {
            return "";
        }
    }
    const diag = (stage, code, url, body) => ` [${stage} · HTTP ${code} · ${String(url).replace(/^https?:\/\//, "").split("?")[0].slice(0, 40)} · ${String(body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 50)}]`;
    const F = async function (path, json) {
        const url = this.baseUrl + path;
        const h = Object.assign({ Referer: this.baseUrl + "/" }, uaHdr());
        if (json) h.Accept = "application/json";
        let r;
        try {
            r = await this.client.get(url, h);
        } catch (e) {
            // 변형 앱(UA 를 안 넣어 주는 앱)은 연결이 끊길 수 있음 → 고정 UA 로 한 번 더
            r = await this.client.get(url, Object.assign({ "User-Agent": webUa() || USER_AGENT }, h));
        }
        let code = Number(r.statusCode);
        let body = String(r.body || "");
        if (CF.test(body) || ((code === 403 || code === 503) && !good(body, json))) {
            const start = Date.now();
            const web = await viaWeb(url, json, 15000);
            if (good(web, json)) body = web;
            else {
                // 그 사이 통과 쿠키가 저장됐을 수 있음 → 한 번 더
                if (Date.now() - start < 25000) {
                    const again = await this.client.get(url, h);
                    code = Number(again.statusCode);
                    body = String(again.body || "");
                }
                if (!good(body, json)) throw new Error("사이트 보안 확인(Cloudflare)을 통과하지 못했어요. 오른쪽 위 지구본(웹뷰)으로 사이트를 열어 확인을 마친 뒤 닫고 다시 불러와 주세요." + diag(json ? "목록·회차" : "작품 화면", code, url, body));
            }
            code = 200;
        }
        if (code < 200 || code >= 300) throw new Error(`사이트 요청에 실패했어요 (HTTP ${code}).` + diag(json ? "목록·회차" : "작품 화면", code, url, body));
        if (!json) return body;
        try {
            return JSON.parse(body);
        } catch (e) {
            throw new Error("사이트 응답을 읽지 못했어요." + diag("목록·회차", code, url, body));
        }
    };
    // 옛 주소는 오류 없이 텔레그램 안내 글(t.me/s/toki1234)로 넘겨 줌 → 받은 화면에 소설 링크가 없으면 사이트가 아님
    const notSite = (v) => typeof v === "string" && !/\/novel/.test(v);
    P.fetch = async function (path, json) {
        try {
            const v = await F.call(this, path, json);
            if (notSite(v)) throw new Error("응답을 읽지 못했어요 (사이트 화면이 아님)");
            return v;
        } catch (e) {
            const m = String((e && e.message) || e);
            if (TRY || !autoOn() || !NET.test(m)) throw e;
            const cur = this.baseUrl;
            const found = await discover(cur);
            if (!found) throw new Error(`${m} — 주소가 바뀐 것 같아요. 뉴토주소.com 에서 지금 주소를 확인해 검색창에 붙여 넣거나 설정의 사이트 주소에 넣어 주세요.`);
            save("toki_auto_domain", found);
            if (manual()) save("toki_domain", found); // 직접 넣은 주소가 안 열려서 찾은 주소(뉴토끼 화면 확인됨)로 칸도 고침
            const v = await F.call(this, path, json);
            if (notSite(v)) throw new Error(`새 주소(${found})에서도 사이트 화면을 받지 못했어요.`);
            return v;
        }
    };
    const S = P.search;
    P.search = async function (query, page, filters) {
        const q = String(query || "").trim();
        const m = /^(?:https?:\/\/)?(?:www\.)?((?:toki|sbxh|newtoki)\d+\.(?:com|org|net))(\/[^\s]*)?$/i.exec(q);
        if (!m) return await S.call(this, query, page, filters);
        const u = norm(m[1]);
        const r = await probe(u);
        const ok = r.ok || (r.moved && (await probe(r.moved)).ok);
        if (!ok) throw new Error(`붙여 넣은 주소(${u})에서 뉴토끼 화면을 확인하지 못했어요. 브라우저에서 열리는지 확인해 주세요.`);
        save("toki_domain", ok);
        save("toki_auto_domain", ok);
        const id = (/^\/novel\/(\d+)/.exec(m[2] || "") || [])[1];
        if (id) {
            const d = await this.getDetail(`/novel/${id}`);
            return { list: [{ name: d.name || `작품 열기 (${id})`, imageUrl: d.imageUrl || "", link: `/novel/${id}` }], hasNextPage: false };
        }
        return await this.getPopular(page || 1);
    };
})(DefaultExtension.prototype);

// ---------- 0.1.5: 필터 맨 위 📝 버전 줄 · 📡 지금 주소, 맨 끝 빈 줄 (2026-11-13, 다른 웹툰 확장과 같게 — 업데이트가 됐는지 화면에서 확인) ----------
(function (P) {
    const NOTES_URL = "https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/main/changelog.json";
    const VER_URLS = ["https://raw.githubusercontent.com/insid0909-max/aniyomi-manga-extensions/gh-pages/mangayomi/novel_index.json"];
    const sp = () => { try { return new SharedPreferences(); } catch (_) { return null; } };
    const get = (k) => { const p = sp(); try { const v = p && p.get(k); return v == null ? "" : String(v); } catch (_) { return ""; } };
    const set = (k, v) => { const p = sp(); try { p && p.setString(k, String(v)); } catch (_) {} };
    const cmp = (a, b) => {
        const x = String(a || "").split(".").map((n) => parseInt(n, 10) || 0);
        const y = String(b || "").split(".").map((n) => parseInt(n, 10) || 0);
        for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
        return 0;
    };
    async function refresh() {
        if (Date.now() - (Number(get("toki_notes_at")) || 0) < 60 * 60000) return;
        set("toki_notes_at", Date.now());
        const c = new Client({ timeout: 6, connectTimeout: 4 });
        const file = String(mangayomiSources[0].pkgPath || "").split("/").pop();
        await Promise.all([
            (async () => {
                try {
                    const r = await c.get(NOTES_URL + "?t=" + Math.floor(Date.now() / 600000), {});
                    const b = String(r.body || "");
                    if (Number(r.statusCode) === 200 && b.trim().startsWith("{")) set("toki_notes", JSON.stringify((JSON.parse(b).items || {}).tokinovel || []));
                } catch (_) {}
            })(),
            (async () => {
                for (const u of VER_URLS) {
                    try {
                        const arr = JSON.parse(String((await c.get(u + "?t=" + Math.floor(Date.now() / 600000), {})).body || "[]"));
                        const hit = (Array.isArray(arr) ? arr : []).find((x) => x && String(x.sourceCodeUrl || "").endsWith("/" + file));
                        if (hit && hit.version) return set("toki_ver_latest", hit.version);
                    } catch (_) {}
                }
            })(),
        ]);
    }
    for (const name of ["getPopular", "getLatestUpdates"]) {
        const f = P[name];
        P[name] = async function (page) {
            if (Number(page) === 1) await Promise.race([refresh(), new Promise((r) => setTimeout(r, 4000))]);
            return await f.apply(this, arguments);
        };
    }
    const GF = P.getFilterList;
    P.getFilterList = function () {
        const mine = String(mangayomiSources[0].version || "");
        const latest = get("toki_ver_latest");
        let note = null;
        try { note = (JSON.parse(get("toki_notes") || "[]") || [])[0]; } catch (_) {}
        const last = note && note.t ? ` · ${String(note.d || "").substring(5).replace("-", ".")} ${String(note.t).replace(/^망가요미:\s*/, "")}` : "";
        let ver = `📝 ${mine}${last}`;
        if (latest && cmp(latest, mine) > 0) ver = `📝 ⚠️ OLD ${mine} → 새 버전 ${latest} 있음, 확장 화면에서 업데이트`;
        else if (latest) ver = `📝 🆕 NEW ${mine}${last}`;
        let addr = "";
        try { addr = String(this.baseUrl || "").replace(/^https?:\/\//, ""); } catch (_) {}
        const head = [{ type_name: "HeaderFilter", name: ver }];
        if (addr) head.push({ type_name: "HeaderFilter", name: `📡 지금 주소 ${addr}` });
        return head.concat(GF.apply(this, arguments) || [], [1, 2, 3].map(() => ({ type_name: "HeaderFilter", name: "　" })));
    };
})(DefaultExtension.prototype);
