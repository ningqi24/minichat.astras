// ==========================================================================
// 登录页专属绑定
//
// 这些绑定原本住在 js/app.js 的 setupGlobalEventListeners()（聊天区段）里，
// 但绑的是登录页上的元素。裁剪出 js/login.js 时会丢掉，所以在这里显式维护，
// 由 tools/build-login.mjs 追加到生成结果末尾。
//
// ⚠️ 手工维护清单 —— 新增登录页元素时，别忘了在这里补绑定。
//    跑 `node tools/check-login.mjs` 会核对"登录页上每个可交互元素是否都有监听器"。
// ==========================================================================

// ---- 主按钮 ----
if (btnLogin) btnLogin.addEventListener('click', handleAuth);

// ---- 「注册 / 登录」切换 ----
var _switchToSignup = document.getElementById('switchToSignup');
if (_switchToSignup) _switchToSignup.addEventListener('click', function(e) {
    e.preventDefault();
    switchMode(isLoginMode ? 'signup' : 'login');
});

// ---- 密码显示 / 隐藏（含图标切换）----
// 注意：app.js 里这段用的是 this.innerHTML 换 SVG；这里改用 CSS 类切换，
//       因为登录页的按钮里本来就放了 .icon-eye / .icon-eye-off 两个 SVG。
var _togglePwd = document.getElementById('togglePwd');
if (_togglePwd) _togglePwd.addEventListener('click', function() {
    if (!authPassword) return;
    var t2 = authPassword.getAttribute('type') === 'password' ? 'text' : 'password';
    authPassword.setAttribute('type', t2);
    this.classList.toggle('is-visible', t2 === 'text');
    this.setAttribute('aria-pressed', t2 === 'text' ? 'true' : 'false');
    this.setAttribute('aria-label', t2 === 'text' ? '隐藏密码' : '显示密码');
});

// ---- FloxChat 面板：入口 / 返回 / 发送验证码 / 验证登录 ----
// ⚠️ 这四个都在 app.js 的 setupGlobalEventListeners() 里（约 5678-5685 行）。
//    漏掉前面两个的症状是"点入口没反应"；漏掉后面两个的症状更隐蔽 ——
//    面板能打开、能输入邮箱，但「发送验证码」和「验证并登录」点了毫无反应。
//    这四项是靠 tools/check-login.mjs 的监听器覆盖检查发现的。
var _switchFlox = document.getElementById('switchFloxChat');
if (_switchFlox) _switchFlox.addEventListener('click', switchToFloxLogin);
var _floxBack = document.getElementById('floxBack');
if (_floxBack) _floxBack.addEventListener('click', switchBackFromFlox);
var _btnFloxSend = document.getElementById('btnFloxSendCode');
if (_btnFloxSend) _btnFloxSend.addEventListener('click', handleFloxSendCode);
var _btnFloxVerify = document.getElementById('btnFloxVerify');
if (_btnFloxVerify) _btnFloxVerify.addEventListener('click', handleFloxVerify);

// ---- 通用弹窗（showAlert / showConfirm 用，登录页也会用到）----
// app.js 里这段在 bindCustomModal()（约 5731 行），同样不在裁剪范围内。
// 注意：确认按钮【不】在这里绑 —— showConfirm/showCustomModal 会给它赋 onclick，
//      再挂一个 addEventListener 会导致回调执行两次。
var _customModalCancel = document.getElementById('customModalCancel');
if (_customModalCancel) _customModalCancel.addEventListener('click', closeCustomModal);
var _customModalOverlay = document.getElementById('customModalOverlay');
if (_customModalOverlay) _customModalOverlay.addEventListener('click', closeCustomModal);

// ---- 主题 / 语言切换 ----
var _themeOptions = document.querySelectorAll('.theme-option');
if (_themeOptions && _themeOptions.length) {
    _themeOptions.forEach(function(btn) {
        btn.addEventListener('click', function() { setTheme(this.getAttribute('data-theme')); });
    });
}
