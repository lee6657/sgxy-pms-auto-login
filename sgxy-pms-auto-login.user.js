// ==UserScript==
// @name         基建系统自动登录
// @namespace    https://docs.scriptcat.org/
// @version      4.0.0
// @description  自动填写账号密码、OCR识别验证码、自动点击登录，并支持验证码错误重试
// @author       You
// @match        https://www.sgxy-pms.sgcc.com.cn:20443/webauth/login.html
// @updateURL    https://raw.githubusercontent.com/lee6657/sgxy-pms-auto-login/main/sgxy-pms-auto-login.meta.js
// @downloadURL  https://raw.githubusercontent.com/lee6657/sgxy-pms-auto-login/main/sgxy-pms-auto-login.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @connect      api.zetatechs.com
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEYS = Object.freeze({
        username: 'sgxy_pms_username',
        password: 'sgxy_pms_password',
        apiKey: 'sgxy_pms_ocr_api_key'
    });

    let isProcessing = false;
    let hasSubmitted = false;
    let settingsHost = null;
    let settingsPrompted = false;

    function getConfig() {
        return {
            username: String(GM_getValue(STORAGE_KEYS.username, '') || '').trim(),
            password: String(GM_getValue(STORAGE_KEYS.password, '') || ''),
            apiKey: String(GM_getValue(STORAGE_KEYS.apiKey, '') || '').trim()
        };
    }

    function hasCompleteConfig(config) {
        return Boolean(config.username && config.password && config.apiKey);
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
                    width: min(420px, calc(100vw - 32px));
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
                    <p class="hint">设置只保存在脚本猫本地存储中，不会写入公开更新文件。可从脚本猫菜单再次打开。</p>
                    <label>登录账号<input name="username" type="text" autocomplete="off"></label>
                    <label>登录密码<input name="password" type="password" autocomplete="new-password"></label>
                    <label>OCR API Key<input name="apiKey" type="password" autocomplete="off"></label>
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
        const apiKeyInput = shadow.querySelector("input[name='apiKey']");
        const status = shadow.querySelector('.status');

        usernameInput.value = current.username;
        passwordInput.value = current.password;
        apiKeyInput.value = current.apiKey;

        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const username = usernameInput.value.trim();
            const password = passwordInput.value;
            const apiKey = apiKeyInput.value.trim();

            if (!username || !password || !apiKey) {
                status.textContent = '账号、密码和 API Key 都必须填写。';
                return;
            }

            GM_setValue(STORAGE_KEYS.username, username);
            GM_setValue(STORAGE_KEYS.password, password);
            GM_setValue(STORAGE_KEYS.apiKey, apiKey);
            hasSubmitted = false;
            settingsPrompted = true;
            closeSettingsDialog();
            console.log('[基建自动登录] 设置已保存，仅存储在本机脚本猫中。');
        });

        shadow.querySelector("[data-action='cancel']").addEventListener('click', closeSettingsDialog);
        shadow.querySelector("[data-action='clear']").addEventListener('click', () => {
            GM_deleteValue(STORAGE_KEYS.username);
            GM_deleteValue(STORAGE_KEYS.password);
            GM_deleteValue(STORAGE_KEYS.apiKey);
            usernameInput.value = '';
            passwordInput.value = '';
            apiKeyInput.value = '';
            status.textContent = '本地配置已清空。';
            hasSubmitted = false;
        });

        document.documentElement.appendChild(host);
        usernameInput.focus();
    }

    GM_registerMenuCommand('设置账号、密码和 OCR API Key', showSettingsDialog);

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

    async function solveCaptcha(imgElement, apiKey) {
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
                url: 'https://api.zetatechs.com/v1/chat/completions',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                data: JSON.stringify({
                    model: 'qwen3-vl-flash',
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

    setInterval(async () => {
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

        const pageText = document.body?.innerText || '';
        const captchaError = /(验证码错误|验证码不正确|验证码有误|请输入正确的验证码)/.test(pageText);
        if (hasSubmitted && captchaError) {
            console.log('[基建自动登录] 验证码错误，刷新后重试。');
            hasSubmitted = false;
            fillInput(captchaField, '');
            captchaImg.click();
            return;
        }

        if (isProcessing || hasSubmitted || !captchaImg.complete || !captchaImg.naturalWidth) return;
        isProcessing = true;

        try {
            if (!userField.value) fillInput(userField, config.username);
            if (!passField.value) fillInput(passField, config.password);

            const code = await solveCaptcha(captchaImg, config.apiKey);
            if (code.length !== 4) {
                captchaImg.click();
                throw new Error(`验证码识别结果长度异常: ${code || '空结果'}`);
            }

            fillInput(captchaField, code);
            await new Promise((resolve) => setTimeout(resolve, 300));

            const loginButton = findLoginButton();
            if (!loginButton) throw new Error('未找到登录按钮');

            hasSubmitted = true;
            console.log('[基建自动登录] 正在自动点击登录按钮。');
            loginButton.click();
        } catch (error) {
            console.error('[基建自动登录] 执行失败:', error);
        } finally {
            isProcessing = false;
        }
    }, 1000);
})();
