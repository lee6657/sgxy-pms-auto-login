// ==UserScript==
// @name         基建系统自动登录
// @namespace    https://docs.scriptcat.org/
// @version      4.1.5
// @description  自动填写账号密码、OCR识别验证码、自动点击登录，并提供悬浮配置入口
// @author       You
// @match        https://www.sgxy-pms.sgcc.com.cn:20443/webauth/login.html
// @updateURL    https://raw.githubusercontent.com/lee6657/sgxy-pms-auto-login/main/sgxy-pms-auto-login.meta.js
// @downloadURL  https://raw.githubusercontent.com/lee6657/sgxy-pms-auto-login/main/sgxy-pms-auto-login.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEYS = Object.freeze({
        username: 'sgxy_pms_username',
        password: 'sgxy_pms_password',
        model: 'sgxy_pms_ocr_model',
        apiKey: 'sgxy_pms_ocr_api_key',
        apiUrl: 'sgxy_pms_ocr_api_url'
    });

    const DEFAULT_MODEL = 'qwen3-vl-flash';
    const DEFAULT_API_URL = 'https://api.zetatechs.com/v1/chat/completions';
    const OCR_RETRY_DELAY_MS = 10000;
    const FORM_SCAN_INTERVAL_MS = 300;
    const LOGIN_CLICK_DELAY_MS = 300;
    const CAPTCHA_ERROR_CONFIRM_DELAY_MS = 3000;
    const CAPTCHA_ERROR_PATTERN = /(验证码错误|验证码不正确|验证码有误|请输入正确的验证码)/;

    let isProcessing = false;
    let hasSubmitted = false;
    let settingsHost = null;
    let settingsPrompted = false;
    let floatingButtonHost = null;
    let floatingButton = null;
    let nextOcrAttemptAt = 0;
    let observedCaptchaImage = null;
    let captchaImageVersion = 0;
    let lastLoginClickAt = 0;
    let lastSubmittedCaptcha = '';
    let captchaErrorVisibleAtSubmit = false;

    function getConfig() {
        return {
            username: String(GM_getValue(STORAGE_KEYS.username, '') || '').trim(),
            password: String(GM_getValue(STORAGE_KEYS.password, '') || ''),
            model: String(GM_getValue(STORAGE_KEYS.model, DEFAULT_MODEL) || DEFAULT_MODEL).trim(),
            apiKey: String(GM_getValue(STORAGE_KEYS.apiKey, '') || '').trim(),
            apiUrl: String(GM_getValue(STORAGE_KEYS.apiUrl, DEFAULT_API_URL) || DEFAULT_API_URL).trim()
        };
    }

    function hasCompleteConfig(config) {
        return Boolean(config.username && config.password && config.model && config.apiKey && config.apiUrl);
    }

    function hasCaptchaErrorText() {
        return CAPTCHA_ERROR_PATTERN.test(document.body?.innerText || '');
    }

    function normalizeApiUrl(value) {
        const trimmed = String(value || '').trim().replace(/\/+$/, '');
        if (!/^https?:\/\//i.test(trimmed)) {
            throw new Error('中转站地址必须以 http:// 或 https:// 开头。');
        }
        if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
        if (/\/v1$/i.test(trimmed)) return `${trimmed}/chat/completions`;
        return `${trimmed}/v1/chat/completions`;
    }

    function refreshFloatingButton() {
        if (!floatingButton) return;
        const configured = hasCompleteConfig(getConfig());
        floatingButton.textContent = configured ? '⚙ 自动登录' : '⚙ 请先设置';
        floatingButton.dataset.configured = String(configured);
    }

    function closeSettingsDialog() {
        if (settingsHost) settingsHost.remove();
        settingsHost = null;
    }

    function showSettingsDialog() {
        if (settingsHost || !document.documentElement) return;

        const current = getConfig();
        const host = document.createElement('div');
        const shadow = host.attachShadow({ mode: 'closed' });
        settingsHost = host;

        shadow.innerHTML = `
            <style>
                .overlay {
                    position: fixed;
                    inset: 0;
                    z-index: 2147483647;
                    display: grid;
                    place-items: center;
                    background: rgba(15, 23, 42, .56);
                    font-family: system-ui, -apple-system, "Microsoft YaHei", sans-serif;
                }
                .panel {
                    width: min(460px, calc(100vw - 32px));
                    box-sizing: border-box;
                    padding: 24px;
                    border-radius: 16px;
                    background: #fff;
                    color: #0f172a;
                    box-shadow: 0 20px 60px rgba(15, 23, 42, .28);
                }
                h2 { margin: 0 0 8px; font-size: 20px; }
                .hint { margin: 0 0 18px; color: #64748b; font-size: 13px; line-height: 1.6; }
                label { display: block; margin-top: 12px; font-size: 13px; font-weight: 600; }
                input {
                    width: 100%;
                    box-sizing: border-box;
                    margin-top: 6px;
                    padding: 10px 12px;
                    border: 1px solid #cbd5e1;
                    border-radius: 8px;
                    font-size: 14px;
                    outline: none;
                }
                input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, .12); }
                .field-hint { margin: 5px 0 0; color: #64748b; font-size: 12px; line-height: 1.5; }
                .status { min-height: 20px; margin-top: 12px; color: #dc2626; font-size: 13px; }
                .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
                button {
                    padding: 9px 14px;
                    border: 0;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 14px;
                }
                .secondary { background: #e2e8f0; color: #334155; }
                .danger { margin-right: auto; background: #fee2e2; color: #b91c1c; }
                .primary { background: #2563eb; color: #fff; }
            </style>
            <div class="overlay">
                <form class="panel">
                    <h2>基建系统自动登录设置</h2>
                    <p class="hint">设置只保存在脚本猫本地存储中，不会写入公开更新文件。可从右上角悬浮按钮或脚本猫菜单再次打开。</p>
                    <label>登录账号<input name="username" type="text" autocomplete="off"></label>
                    <label>登录密码<input name="password" type="password" autocomplete="new-password"></label>
                    <label>OCR 模型<input name="model" type="text" list="model-options" autocomplete="off"></label>
                    <datalist id="model-options">
                        <option value="qwen3-vl-flash"></option>
                        <option value="qwen-vl-max"></option>
                        <option value="qwen-vl-plus"></option>
                        <option value="gpt-4o-mini"></option>
                        <option value="gpt-4.1-mini"></option>
                    </datalist>
                    <label>OCR API Key<input name="apiKey" type="password" autocomplete="off"></label>
                    <label>中转站地址<input name="apiUrl" type="url" autocomplete="off"></label>
                    <p class="field-hint">可填写域名、以 /v1 结尾的地址，或完整的 /v1/chat/completions 地址。</p>
                    <div class="status"></div>
                    <div class="actions">
                        <button class="danger" type="button" data-action="clear">清空配置</button>
                        <button class="secondary" type="button" data-action="cancel">取消</button>
                        <button class="primary" type="submit">保存</button>
                    </div>
                </form>
            </div>
        `;

        const form = shadow.querySelector('form');
        const usernameInput = shadow.querySelector("input[name='username']");
        const passwordInput = shadow.querySelector("input[name='password']");
        const modelInput = shadow.querySelector("input[name='model']");
        const apiKeyInput = shadow.querySelector("input[name='apiKey']");
        const apiUrlInput = shadow.querySelector("input[name='apiUrl']");
        const status = shadow.querySelector('.status');

        usernameInput.value = current.username;
        passwordInput.value = current.password;
        modelInput.value = current.model;
        apiKeyInput.value = current.apiKey;
        apiUrlInput.value = current.apiUrl;

        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const username = usernameInput.value.trim();
            const password = passwordInput.value;
            const model = modelInput.value.trim();
            const apiKey = apiKeyInput.value.trim();
            let apiUrl;

            if (!username || !password || !model || !apiKey || !apiUrlInput.value.trim()) {
                status.textContent = '账号、密码、模型、API Key 和中转站地址都必须填写。';
                return;
            }

            try {
                apiUrl = normalizeApiUrl(apiUrlInput.value);
            } catch (error) {
                status.textContent = error.message;
                return;
            }

            GM_setValue(STORAGE_KEYS.username, username);
            GM_setValue(STORAGE_KEYS.password, password);
            GM_setValue(STORAGE_KEYS.model, model);
            GM_setValue(STORAGE_KEYS.apiKey, apiKey);
            GM_setValue(STORAGE_KEYS.apiUrl, apiUrl);
            hasSubmitted = false;
            nextOcrAttemptAt = 0;
            lastLoginClickAt = 0;
            lastSubmittedCaptcha = '';
            captchaErrorVisibleAtSubmit = false;
            settingsPrompted = true;
            closeSettingsDialog();
            refreshFloatingButton();
            setTimeout(runAutoLogin, 0);
            console.log('[基建自动登录] 设置已保存，仅存储在本机脚本猫中。');
        });

        shadow.querySelector("[data-action='cancel']").addEventListener('click', closeSettingsDialog);
        shadow.querySelector("[data-action='clear']").addEventListener('click', () => {
            GM_deleteValue(STORAGE_KEYS.username);
            GM_deleteValue(STORAGE_KEYS.password);
            GM_deleteValue(STORAGE_KEYS.model);
            GM_deleteValue(STORAGE_KEYS.apiKey);
            GM_deleteValue(STORAGE_KEYS.apiUrl);
            usernameInput.value = '';
            passwordInput.value = '';
            modelInput.value = DEFAULT_MODEL;
            apiKeyInput.value = '';
            apiUrlInput.value = DEFAULT_API_URL;
            status.textContent = '本地配置已清空。';
            hasSubmitted = false;
            nextOcrAttemptAt = 0;
            lastLoginClickAt = 0;
            lastSubmittedCaptcha = '';
            captchaErrorVisibleAtSubmit = false;
            refreshFloatingButton();
        });

        document.documentElement.appendChild(host);
        usernameInput.focus();
    }

    function createFloatingSettingsButton() {
        if (floatingButtonHost || !document.documentElement) return;

        const host = document.createElement('div');
        const shadow = host.attachShadow({ mode: 'closed' });
        floatingButtonHost = host;

        shadow.innerHTML = `
            <style>
                button {
                    position: fixed;
                    top: 16px;
                    right: 16px;
                    z-index: 2147483646;
                    padding: 9px 14px;
                    border: 1px solid rgba(255, 255, 255, .35);
                    border-radius: 999px;
                    background: linear-gradient(135deg, #2563eb, #1d4ed8);
                    color: #fff;
                    box-shadow: 0 8px 24px rgba(37, 99, 235, .3);
                    cursor: pointer;
                    font: 600 13px/1.2 system-ui, -apple-system, "Microsoft YaHei", sans-serif;
                    transition: transform .15s ease, box-shadow .15s ease, background .15s ease;
                }
                button:hover { transform: translateY(-1px); box-shadow: 0 10px 28px rgba(37, 99, 235, .38); }
                button:active { transform: translateY(0); }
                button[data-configured='false'] { background: linear-gradient(135deg, #f59e0b, #d97706); }
            </style>
            <button type="button" title="打开基建系统自动登录设置">⚙ 自动登录</button>
        `;

        floatingButton = shadow.querySelector('button');
        floatingButton.addEventListener('click', showSettingsDialog);
        document.documentElement.appendChild(host);
        refreshFloatingButton();
    }

    GM_registerMenuCommand('打开自动登录设置', showSettingsDialog);
    createFloatingSettingsButton();

    function fillInput(element, value) {
        if (!element) return;
        element.focus();

        const prototype = Object.getPrototypeOf(element);
        const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (valueSetter) {
            valueSetter.call(element, value);
        } else {
            element.value = value;
        }

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function findLoginButton() {
        const candidates = Array.from(document.querySelectorAll(
            "button, input[type='submit'], input[type='button'], [role='button']"
        ));

        const visibleLoginButton = candidates.find((element) => {
            const text = (
                element.innerText ||
                element.value ||
                element.getAttribute('aria-label') ||
                element.getAttribute('title') ||
                ''
            ).trim();
            const style = window.getComputedStyle(element);
            const isVisible = style.display !== 'none' && style.visibility !== 'hidden';
            const isEnabled = !element.disabled && element.getAttribute('aria-disabled') !== 'true';
            return isVisible && isEnabled && /(登录|登\s*录|login)/i.test(text);
        });

        return visibleLoginButton || document.querySelector(
            "button[type='submit']:not([disabled]), input[type='submit']:not([disabled])"
        );
    }

    async function solveCaptcha(imgElement, config) {
        const canvas = document.createElement('canvas');
        canvas.width = imgElement.naturalWidth || imgElement.width;
        canvas.height = imgElement.naturalHeight || imgElement.height;
        const ctx = canvas.getContext('2d');
        ctx.filter = 'contrast(200%) brightness(120%)';
        ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL('image/jpeg').split(',')[1];

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: config.apiUrl,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`
                },
                data: JSON.stringify({
                    model: config.model,
                    messages: [{
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: '这是含有横线干扰的验证码，请提取其中的4个字符（数字或字母）。直接返回结果，不要任何标点或空格。'
                            },
                            {
                                type: 'image_url',
                                image_url: { url: `data:image/jpeg;base64,${base64}` }
                            }
                        ]
                    }],
                    max_tokens: 5
                }),
                onload: (response) => {
                    try {
                        if (response.status < 200 || response.status >= 300) {
                            throw new Error(`OCR 请求失败，状态码 ${response.status}`);
                        }
                        const data = JSON.parse(response.responseText);
                        const content = data?.choices?.[0]?.message?.content || '';
                        resolve(String(content).trim().replace(/[^a-zA-Z0-9]/g, ''));
                    } catch (error) {
                        reject(error);
                    }
                },
                onerror: () => reject(new Error('OCR 网络请求失败')),
                ontimeout: () => reject(new Error('OCR 网络请求超时')),
                timeout: 20000
            });
        });
    }

    async function runAutoLogin() {
        const config = getConfig();
        if (!hasCompleteConfig(config)) {
            if (!settingsPrompted) {
                settingsPrompted = true;
                showSettingsDialog();
            }
            return;
        }

        const userField = document.querySelector(
            "input[name='userName'], input[name='username'], input[autocomplete='username']"
        );
        const passField = document.querySelector(
            "input[name='password'], input[type='password'][autocomplete='current-password'], input[type='password']"
        );
        const captchaField = document.querySelector(
            "input[placeholder*='验证码'], input[name*='captcha'], input[name*='verify']"
        );
        const captchaImg = document.querySelector(
            "img.img-box, img[class*='captcha'], img[alt*='验证码']"
        );

        if (!userField || !passField || !captchaField || !captchaImg) return;

        if (observedCaptchaImage !== captchaImg) {
            observedCaptchaImage = captchaImg;
            captchaImageVersion += 1;
            captchaImg.addEventListener('load', () => {
                captchaImageVersion += 1;
                nextOcrAttemptAt = 0;
                hasSubmitted = false;
                lastLoginClickAt = 0;
                lastSubmittedCaptcha = '';
                captchaErrorVisibleAtSubmit = false;
                setTimeout(runAutoLogin, 0);
            });
        }

        const captchaError = hasCaptchaErrorText();
        if (hasSubmitted && !captchaError && captchaErrorVisibleAtSubmit) {
            captchaErrorVisibleAtSubmit = false;
        }

        if (hasSubmitted && captchaError) {
            const responseDelayElapsed = Date.now() - lastLoginClickAt >= CAPTCHA_ERROR_CONFIRM_DELAY_MS;
            const captchaStillMatches = Boolean(
                lastSubmittedCaptcha &&
                captchaField.value.trim().toLowerCase() === lastSubmittedCaptcha.toLowerCase()
            );

            // 忽略提交前就存在的旧错误提示，并给登录请求留出响应时间。
            if (captchaErrorVisibleAtSubmit || !responseDelayElapsed || !captchaStillMatches) return;

            console.log('[基建自动登录] 验证码错误，刷新后重试。');
            hasSubmitted = false;
            lastLoginClickAt = 0;
            lastSubmittedCaptcha = '';
            captchaErrorVisibleAtSubmit = false;
            fillInput(captchaField, '');
            nextOcrAttemptAt = Date.now() + 1000;
            captchaImg.click();
            return;
        }

        if (
            isProcessing ||
            hasSubmitted ||
            Date.now() < nextOcrAttemptAt ||
            !captchaImg.complete ||
            !captchaImg.naturalWidth
        ) return;
        isProcessing = true;

        try {
            if (!userField.value) fillInput(userField, config.username);
            if (!passField.value) fillInput(passField, config.password);

            const captchaVersionAtOcrStart = captchaImageVersion;
            const captchaSourceAtOcrStart = captchaImg.currentSrc || captchaImg.src;
            const code = await solveCaptcha(captchaImg, config);
            if (code.length !== 4) {
                nextOcrAttemptAt = Date.now() + OCR_RETRY_DELAY_MS;
                throw new Error(`验证码识别结果长度异常: ${code || '空结果'}`);
            }

            const captchaImageChanged = () => (
                captchaImageVersion !== captchaVersionAtOcrStart ||
                (captchaImg.currentSrc || captchaImg.src) !== captchaSourceAtOcrStart
            );

            if (captchaImageChanged()) {
                fillInput(captchaField, '');
                nextOcrAttemptAt = 0;
                console.log('[基建自动登录] 验证码图片在识别期间已刷新，丢弃旧识别结果。');
                return;
            }

            nextOcrAttemptAt = 0;
            fillInput(captchaField, code);
            await new Promise((resolve) => setTimeout(resolve, LOGIN_CLICK_DELAY_MS));

            if (captchaImageChanged()) {
                fillInput(captchaField, '');
                nextOcrAttemptAt = 0;
                console.log('[基建自动登录] 验证码图片在登录前已刷新，取消本次登录并重新识别。');
                return;
            }

            if (captchaField.value.trim().toLowerCase() !== code.toLowerCase()) {
                throw new Error('验证码在等待期间发生变化，已取消自动点击登录');
            }

            const loginButton = findLoginButton();
            if (!loginButton) throw new Error('未找到登录按钮');

            captchaErrorVisibleAtSubmit = hasCaptchaErrorText();
            lastSubmittedCaptcha = code;
            lastLoginClickAt = Date.now();
            hasSubmitted = true;
            console.log('[基建自动登录] 正在自动点击登录按钮。');
            loginButton.click();
        } catch (error) {
            nextOcrAttemptAt = Math.max(nextOcrAttemptAt, Date.now() + OCR_RETRY_DELAY_MS);
            console.error('[基建自动登录] 执行失败:', error);
        } finally {
            isProcessing = false;
        }
    }

    runAutoLogin();
    setInterval(runAutoLogin, FORM_SCAN_INTERVAL_MS);
})();
