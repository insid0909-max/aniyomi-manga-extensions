const mangayomiSources = [{"id":870214020,"name":"머니툰 웹뷰 연결시험","lang":"ko","baseUrl":"https://mtoon165.asia","apiUrl":"","iconUrl":"","typeSource":"single","itemType":0,"isNsfw":true,"hasCloudflare":false,"version":"0.0.1","dateFormat":"","dateFormatLocale":"","pkgPath":"mtoon_webview_probe.js"}];
let MT_PROBE_PENDING = null;
async function mtWebviewProbe() {
    if (typeof evaluateJavascriptViaWebview !== "function") return "웹뷰 함수 없음";
    const marker = "MT_WV_PROBE_1";
    const script = '(function(){if(window.__mtProbeSent)return;if(window.flutter_inappwebview&&typeof window.flutter_inappwebview.callHandler==="function"){window.__mtProbeSent=true;window.flutter_inappwebview.callHandler("setResponse","MT_WV_PROBE_1");}})();';
    let timer;
    try {
        const value = await Promise.race([
            evaluateJavascriptViaWebview("https://mtoon165.asia/", {}, [script], 8),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("MT_PROBE_TIMEOUT")), 12000); })
        ]);
        if (value === marker) return "성공: 웹뷰 실행·문자열 반환 확인";
        if (typeof value === "string") {
            try { if (JSON.parse(value) === marker) return "성공: 웹뷰 실행·문자열 반환 확인"; } catch (_) {}
        }
        if (value === "" || value == null) return "빈 응답: 페이지 실행 또는 결과 반환 미확인";
        return "예상 밖 반환값: " + typeof value;
    } catch (e) {
        if (e && e.message === "MT_PROBE_TIMEOUT") return "12초 시간 초과: 완료 여부 미확인";
        return "호출 실패: " + String(e && e.name || "Error").replace(/[^A-Za-z0-9_]/g, "").slice(0, 32);
    } finally {
        if (timer && typeof clearTimeout === "function") clearTimeout(timer);
    }
}
class DefaultExtension extends MProvider {
    getBaseUrl() { return "https://mtoon165.asia"; }
    async getPopular(page) {
        if (!MT_PROBE_PENDING) MT_PROBE_PENDING = mtWebviewProbe().finally(() => { MT_PROBE_PENDING = null; });
        const result = await MT_PROBE_PENDING;
        throw new Error("[웹뷰 연결시험 0.0.1] " + result + " — 시험 결과 표시이며 작품 목록은 제공하지 않습니다.");
    }
    async getLatestUpdates(page) { return this.getPopular(page); }
    async search(query, page, filters) { return this.getPopular(page); }
    async getDetail(url) { throw new Error("연결 시험 전용입니다. 인기 탭을 열어 주세요."); }
    async getPageList(url) { return []; }
}
