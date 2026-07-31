# 基建系统自动登录

适用于以下登录页的 ScriptCat 用户脚本：

`https://www.sgxy-pms.sgcc.com.cn:20443/webauth/login.html`

## 安装

在浏览器中打开下面的地址，由 ScriptCat 接管安装：

https://raw.githubusercontent.com/lee6657/sgxy-pms-auto-login/main/sgxy-pms-auto-login.user.js

## 使用

1. 首次打开目标登录页时，填写账号、密码和 OCR API Key。
2. 设置只保存在本机 ScriptCat 存储中，不会上传到 GitHub。
3. 后续可从 ScriptCat 的脚本菜单中选择“设置账号、密码和 OCR API Key”修改配置。
4. 脚本会根据 `@updateURL` 自动检查新版本。

## 安全说明

仓库中不包含账号、密码或 API Key。不要把包含个人配置的旧脚本或备份上传到公开仓库。
