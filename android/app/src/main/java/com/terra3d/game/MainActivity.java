package com.terra3d.game;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Terra 3D: игра (папка web/) открывается во встроенном WebView прямо из APK.
 * Файлы отдаются с адреса https://appassets.androidplatform.net/ — так у игры нормальный
 * https-адрес: работают localStorage, crypto и запросы к серверу.
 *
 * Вход через Google: игра вызывает TerraNative.openExternal(url) → открывается браузер (Custom Tab),
 * после входа сервер возвращает игрока ссылкой terra3d://auth?..., её ловит эта Activity
 * и передаёт в игру через window.onNativeAuth(...).
 */
public class MainActivity extends Activity {
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + ASSET_HOST + "/index.html";
    private static final String AUTH_SCHEME = "terra3d";
    private static final String AUTH_HOST = "auth";
    private static final int SPACE_COLOR = 0xFF02040D;

    private WebView webView;
    private boolean pageReady = false;
    private String pendingAuthLink = null;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        webView = new WebView(this);
        webView.setBackgroundColor(SPACE_COLOR);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(true);
        // TerraBuild/<номер сборки> — по нему сервер и игра понимают, что пора предложить обновление
        s.setUserAgentString(s.getUserAgentString() + " Terra3DApp/1 TerraBuild/" + buildNumber());

        webView.addJavascriptInterface(new Bridge(), "TerraNative");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new AppClient());
        setContentView(webView);

        handleIntent(getIntent());
        webView.loadUrl(START_URL);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    /** Ловим возврат из браузера после входа через Google: terra3d://auth?code=...&state=... */
    private void handleIntent(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data != null && AUTH_SCHEME.equals(data.getScheme()) && AUTH_HOST.equals(data.getHost())) {
            pendingAuthLink = data.toString();
            deliverAuth();
        }
    }

    private void deliverAuth() {
        if (!pageReady || pendingAuthLink == null || webView == null) return;
        String link = pendingAuthLink;
        pendingAuthLink = null;
        webView.evaluateJavascript("window.onNativeAuth && window.onNativeAuth(" + jsString(link) + ")", null);
    }

    /** Безопасно превращает строку в литерал JavaScript. */
    static String jsString(String s) {
        StringBuilder b = new StringBuilder(s.length() + 2).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '<': b.append("\\u003c"); break;
                case '\u2028': b.append("\\u2028"); break;
                case '\u2029': b.append("\\u2029"); break;
                default:
                    if (c < 0x20) b.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    /** Номер сборки (versionCode) — совпадает с номером релиза v1.0.N на GitHub. */
    @SuppressWarnings("deprecation")
    private long buildNumber() {
        try {
            PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    /** Открывает страницу во внешнем браузере (в Chrome — как Custom Tab поверх игры). */
    private void openExternal(String url) {
        Uri uri = Uri.parse(url);
        if (!"https".equals(uri.getScheme())) return;
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        // Те же extras, что ставит библиотека Custom Tabs: Chrome откроет вкладку поверх игры.
        Bundle extras = new Bundle();
        extras.putBinder("android.support.customtabs.extra.SESSION", null);
        intent.putExtras(extras);
        intent.putExtra("android.support.customtabs.extra.TOOLBAR_COLOR", SPACE_COLOR);
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (ActivityNotFoundException ignored) {
                // браузера нет — игра покажет ошибку входа
            }
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.evaluateJavascript("window.__terraPause && window.__terraPause()", null);
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            webView.evaluateJavascript("window.__terraResume && window.__terraResume()", null);
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView == null || !pageReady) {
            moveTaskToBack(true);
            return;
        }
        webView.evaluateJavascript("(window.__terraBack && window.__terraBack()) ? '1' : '0'", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (!"\"1\"".equals(value)) moveTaskToBack(true);
            }
        });
    }

    /** Методы, доступные игре как window.TerraNative.* */
    private class Bridge {
        @JavascriptInterface
        public void openExternal(final String url) {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    MainActivity.this.openExternal(url);
                }
            });
        }

        @JavascriptInterface
        public String version() {
            return "1";
        }
    }

    private class AppClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!ASSET_HOST.equals(url.getHost())) return null; // запросы к серверу игры идут как обычно
            String path = url.getPath();
            if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
            String asset = path.substring(1);
            if (asset.contains("..")) return notFound();
            try {
                InputStream in = getAssets().open(asset);
                Map<String, String> headers = new HashMap<String, String>();
                headers.put("Cache-Control", "no-cache");
                String mime = mimeFor(asset);
                String encoding = mime.startsWith("text/") || mime.endsWith("javascript") || mime.endsWith("json") ? "UTF-8" : null;
                return new WebResourceResponse(mime, encoding, 200, "OK", headers, in);
            } catch (IOException e) {
                return notFound();
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (ASSET_HOST.equals(url.getHost())) return false;
            openExternal(url.toString()); // внешние ссылки — в браузер
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            pageReady = false;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            pageReady = true;
            deliverAuth();
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // Процесс WebView упал (нехватка памяти и т.п.) — перезапускаем экран, прогресс сохранён.
            if (webView == view) webView = null;
            if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
            view.destroy();
            recreate();
            return true;
        }
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
    }

    private static String mimeFor(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".html") || n.endsWith(".htm")) return "text/html";
        if (n.endsWith(".js")) return "application/javascript";
        if (n.endsWith(".css")) return "text/css";
        if (n.endsWith(".json")) return "application/json";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".ico")) return "image/x-icon";
        if (n.endsWith(".mp3")) return "audio/mpeg";
        if (n.endsWith(".ogg")) return "audio/ogg";
        if (n.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }
}
