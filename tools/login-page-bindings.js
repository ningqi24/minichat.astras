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
// ⚠️ 必须用【事件委托】绑在 .auth-toggle 容器上，不能绑 #switchToSignup 这个 <a> 本身。
//    原因：switchMode() 每次都会把容器的 innerHTML 整体换掉
//      （见 app.js：tEl.innerHTML = isLoginMode ? t('noAccount') : t('hasAccount')），
//    里面那个 <a id="switchToSignup"> 每次都是【新元素】，直接绑的话第一次点击之后监听器就没了。
//    表现就是用户报的："注册"能点，切过去之后"登录"点了没反应。
//    app.js 里用的 handleAuthToggleClick 本来就是委托写法，这里跟着保持一致。
var _authToggle = document.querySelector('.auth-toggle');
if (_authToggle) _authToggle.addEventListener('click', handleAuthToggleClick);

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

// ---- 第三方账号登录：微软 / GitHub ----
// 具体的 OAuth 配置在 Supabase Dashboard，代码这边只负责发起跳转。
var _oauthMs = document.getElementById('oauthMicrosoft');
if (_oauthMs) _oauthMs.addEventListener('click', function () { signInWithProvider('azure'); });
var _oauthGh = document.getElementById('oauthGitHub');
if (_oauthGh) _oauthGh.addEventListener('click', function () { signInWithProvider('github'); });
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
