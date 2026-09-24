// ==========================================================================
// MiniChat 登录页专用脚本（由 js/app.js 抽取而来）
//
// 说明：登录相关的代码【逐字保留】，只做了两件事：
//   1. 丢弃聊天页的顶层代码（约 4800 行）
//   2. i18n 字典只保留登录页用到的键（原 65KB -> 几 KB）
// 这样登录页只下载登录所需的代码，不再附带整个聊天模块。
// ==========================================================================

// ===================== 版本号 =====================
// ⚠️ 改版本号必须【同时】改三处，否则两者不一致会让所有用户看到假的「有新版本」弹窗：
//      1. 这里 APP_VERSION
//      2. data/vision.json 的 version（checkForUpdate() 拿它和 APP_VERSION 比对）
//      3. sw.js 的 CACHE_NAME（否则老访客拿不到新的 index.html）
var APP_VERSION = '4.8.8';  // ⚠️ 本文件由 js/app.js 裁剪生成，改版本号时两处都要同步

// ===================== 安全 DOM 获取 =====================
function $safe(id) { return document.getElementById(id); }

var loginOverlay = $safe('loginOverlay'), mainInterface = $safe('mainInterface');
var authEmail = $safe('authEmail'), authPassword = $safe('authPassword'), authMessage = $safe('authMessage');
var authTitle = $safe('authTitle'), authSub = $safe('authSub'), btnLogin = $safe('btnLogin');
var termsOverlay = $safe('termsOverlay'), termsClose = $safe('termsClose'), termsAgree = $safe('termsAgree'), termsConfirm = $safe('termsConfirm');
var messageList = $safe('messageList'), chatInput = $safe('chatInput');
var sidebarUserEmail = $safe('sidebarUserEmail'), sidebarUserAvatar = $safe('sidebarUserAvatar');
var sidebarCollapseBtn = $safe('sidebarCollapseBtn'), sidebar = document.querySelector('.sidebar-wrapper');

var btnSend = $safe('btnSend');
var fileInput = $safe('fileInput'), attachBtn = $safe('attachBtn');
var settingsOverlay = $safe('settingsOverlay'), themeToggle = $safe('themeToggle');
var settingsLogout = $safe('settingsLogout'), closeSettingsEl = $safe('closeSettings');
var settingsNav = $safe('settingsNav'), displayNameInput = $safe('displayNameInput');
var saveDisplayNameBtn = $safe('saveDisplayName'), displayNameMessage = $safe('displayNameMessage');
var onlineStatus = $safe('onlineStatus'), onlineBadge = $safe('onlineBadge');
var allMembersModal = $safe('allMembersModal'), allMembersList = $safe('allMembersList');
var allMembersCount = $safe('allMembersCount'), allMembersTitle = $safe('allMembersTitle'), allMembersBtn = $safe('allMembersBtn'), closeAllMembersModal = $safe('closeAllMembersModal');
var memberSearchInput = $safe('memberSearchInput');
var avatarPreview = $safe('avatarPreview');
var avatarUploadBtn = $safe('avatarUploadBtn'), avatarFileInput = $safe('avatarFileInput');
var avatarUploadStatus = $safe('avatarUploadStatus');
var profileAvatar = $safe('profileAvatar'), profileDisplayName = $safe('profileDisplayName');
var profileEmail = $safe('profileEmail'), profileStatus = $safe('profileStatus');
var emojiBtn = $safe('emojiBtn');
var emojiPanel = $safe('emojiPanel'), emojiTabs = $safe('emojiTabs'), emojiGrid = $safe('emojiGrid');
var attachmentArea = $safe('attachmentArea'), mentionDropdown = $safe('mentionDropdown');
var uploadOverlay = $safe('uploadOverlay'), closeUploadBtn = $safe('closeUploadBtn');
var quoteJumpModal = $safe('quoteJumpModal'), closeQuoteJumpBtn = $safe('closeQuoteJumpBtn');
var qjAuthor = $safe('qjAuthor'), qjTime = $safe('qjTime'), qjContent = $safe('qjContent');
var qjCancel = $safe('qjCancel'), qjJump = $safe('qjJump'), qjStatus = $safe('qjStatus');
var contextMenu = $safe('contextMenu'), ctxMention = $safe('ctxMention');
var searchBar = $safe('searchBar'), searchInput = $safe('searchInput'), searchStatus = $safe('searchStatus');
var searchBtn = $safe('searchBtn'), searchPrev = $safe('searchPrev'), searchNext = $safe('searchNext'), searchClose = $safe('searchClose');
var chatTitle = $safe('chatTitle'), allMembersNum = $safe('allMembersNum');
var customModal = $safe('customModal'), customModalOverlay = $safe('customModalOverlay');
var customModalIcon = $safe('customModalIcon'), customModalSpinner = $safe('customModalSpinner');
var customModalTitle = $safe('customModalTitle'), customModalMessage = $safe('customModalMessage');
var customModalCancel = $safe('customModalCancel'), customModalConfirm = $safe('customModalConfirm');

// v3.1.0 新增 DOM 引用
var profileCard = $safe('profileCard');
var profileCardAvatar = $safe('profileCardAvatar');
var profileCardName = $safe('profileCardName');
var profileCardEmail = $safe('profileCardEmail');
var profileCardStatus = $safe('profileCardStatus');
var profileCardJoined = $safe('profileCardJoined');
var profileCardMessages = $safe('profileCardMessages');
var profileCardClose = $safe('profileCardClose');
var ctxProfile = $safe('ctxProfile');
var bottomNav = $safe('bottomNav');
var bottomUnreadBadge = $safe('bottomUnreadBadge');
var bottomChatBtn = $safe('bottomChatBtn');
var bottomMembersBtn = $safe('bottomMembersBtn');
var bottomSettingsBtn = $safe('bottomSettingsBtn');
var shareBtn = $safe('shareBtn');

// ===================== 全局状态 =====================
var currentEmail = '', currentUserId = '', currentDisplayName = '', currentAvatarUrl = '';
var isLoginMode = true, currentUserMap = {}, attachments = [];
var onlineUsers = {}, onlineCount = 0, isSending = false, lastSendTime = 0;
var MIN_SEND_INTERVAL = 500, PAGE_SIZE = 20;
var isLoadingMore = false, hasMoreMessages = true, oldestTimestamp = null;
var unreadCount = 0, isUploadingFile = false;
var currentConversationId = '00000000-0000-0000-0000-000000000000';
var presenceChannel = null;
var profilesRealtimeChannel = null;
var failedAvatars = {};
var avatarCache = {}; // 头像 URL 缓存，避免重复请求导致 NS_BINDING_ABORTED

// v3.1.0 新增状态
var lastReadMessageId = localStorage.getItem('minichat_last_read') || null;
var newMessageCount = 0;             // 未读消息数（脱机/后台时累计）
var allLoadedMessages = [];          // 缓存当前加载的所有消息（供轻量虚拟滚动使用）
var lastTimeLabel = '';              // 最近一个时间标签字符串，避免重复添加
var imageObserver = null;            // 用于图片懒加载的 IntersectionObserver
var SUPABASE_IMG_TRANSFORM = '?width=200&quality=70'; // 缩略图后缀

// ===================== 工具函数（增强） =====================
function getDefaultAvatar(email) { return 'https://ui-avatars.com/api/?name=' + encodeURIComponent(email ? email.split('@')[0] : '用户') + '&background=3b82f6&color=fff&size=128&bold=true'; }

function bustCache(url) {
            if (!url) return '';
            // ui-avatars.com 不需要缓存清除
            if (url.includes('ui-avatars.com')) return url;
            // 如果已经缓存过，直接返回缓存的 URL（避免同一资源被多次请求不同 URL）
            if (avatarCache[url]) return avatarCache[url];
            // 生成带时间戳的 URL 并缓存
            var separator = url.includes('?') ? '&' : '?';
            var cachedUrl = url + separator + '_t=' + Date.now();
            avatarCache[url] = cachedUrl;
            return cachedUrl;
        }

function getAvatarUrl(email) {
            if (!email) return getDefaultAvatar('');
            // 如果标记了失败，但 currentUserMap 中有有效头像，可能是误标记，清除标记
            if (failedAvatars[email]) {
                var info = currentUserMap[email];
                if (info && info.avatar_url && !info.avatar_url.includes('ui-avatars.com')) {
                    delete failedAvatars[email];
                    return bustCache(info.avatar_url);
                }
                return getDefaultAvatar(email);
            }
            var info = currentUserMap[email] || {};
            var ou = Object.values(onlineUsers).find(u => u.email === email);
            var url = ou ? ou.avatar_url : info.avatar_url;
            if (url) return bustCache(url);
            if (!url || url === 'null' || url === 'undefined' || url.includes('ui-avatars.com')) {
                // 如果 URL 是默认头像，不标记失败，因为默认头像总是可用的
                if (url && url.includes('ui-avatars.com')) return url;
                // 否则标记失败并返回默认
                failedAvatars[email] = true;
                if (currentUserMap[email]) {
                    currentUserMap[email].avatar_url = getDefaultAvatar(email);
                }
                return getDefaultAvatar(email);
            }
            return bustCache(url);
        }

function handleAvatarError(img, email) {
            if (!email) {
                img.src = getDefaultAvatar('用户');
                img.onerror = null;
                return;
            }
            // 如果已经标记，直接回退
            if (failedAvatars[email]) {
                img.src = getDefaultAvatar(email);
                img.onerror = null;
                return;
            }
            // 检查当前图片 URL 是否已经是默认头像
            var currentSrc = img.src || '';
            if (currentSrc.includes('ui-avatars.com')) {
                // 已经是默认，不需要处理
                img.onerror = null;
                return;
            }
            // 检查是否有有效头像
            var info = currentUserMap[email];
            if (info && info.avatar_url && !info.avatar_url.includes('ui-avatars.com')) {
                // 尝试重新加载一次（使用当前 src 或存储中的 URL）
                var originalUrl = info.avatar_url;
                // 如果当前 src 不是 originalUrl，尝试用 originalUrl 重试
                if (currentSrc !== originalUrl && !currentSrc.includes('_t=')) {
                    // 可能是旧的时间戳，尝试清除缓存
                    var cleanUrl = originalUrl.split('?')[0]; // 去掉查询参数
                    img.src = bustCache(cleanUrl);
                    img.onerror = function() {
                        // 重试失败，标记
                        failedAvatars[email] = true;
                        if (currentUserMap[email]) {
                            currentUserMap[email].avatar_url = getDefaultAvatar(email);
                        }
                        img.src = getDefaultAvatar(email);
                        img.onerror = null;
                    };
                    return;
                }
                // 如果当前 src 就是 originalUrl 或带时间戳，尝试重新加载（移除时间戳）
                if (currentSrc.includes('_t=')) {
                    var baseUrl = currentSrc.split('_t=')[0];
                    // 重新生成时间戳
                    img.src = bustCache(baseUrl);
                    img.onerror = function() {
                        failedAvatars[email] = true;
                        if (currentUserMap[email]) {
                            currentUserMap[email].avatar_url = getDefaultAvatar(email);
                        }
                        img.src = getDefaultAvatar(email);
                        img.onerror = null;
                    };
                    return;
                }
                // 其他情况，直接标记失败
                failedAvatars[email] = true;
                if (currentUserMap[email]) {
                    currentUserMap[email].avatar_url = getDefaultAvatar(email);
                }
                img.src = getDefaultAvatar(email);
                img.onerror = null;
            } else {
                // 没有有效头像，直接标记失败
                failedAvatars[email] = true;
                if (currentUserMap[email]) {
                    currentUserMap[email].avatar_url = getDefaultAvatar(email);
                }
                img.src = getDefaultAvatar(email);
                img.onerror = null;
            }
        }

function esc(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }
function escJs(s) { return s ? s.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\\"').replace(/\n/g,'\\n').replace(/\r/g,'\\r') : ''; }
// 链接协议白名单：挡掉 javascript: / data: / vbscript: 等可执行协议，避免存储型 XSS
function safeLinkUrl(u) {
    var s = String(u == null ? '' : u).trim();
    if (/^https?:\/\//i.test(s) || /^mailto:/i.test(s)) return s;
    if (/^\/(?!\/)/.test(s) || /^#/.test(s)) return s;
    return '';
}
function getTimeLocale() { var lang = getCurrentLang(); return lang === 'zh' ? 'zh-CN' : 'en-US'; }
function formatTime(iso) { return new Date(iso).toLocaleString(getTimeLocale(),{hour12:false}); }
function formatTimeShort(iso) { return new Date(iso).toLocaleTimeString(getTimeLocale(),{hour:'2-digit',minute:'2-digit'}); }
// v3.1.0 时间线（今天/昨天/更早）
function formatTimeLine(iso) {
    var d = new Date(iso);
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var ms = d.getTime();
    var diff = today - ms;
    var timeStr = formatTimeShort(iso);
    if (diff >= 0 && diff < 24*60*60*1000) return t('today') + ' ' + timeStr;
    if (diff >= 24*60*60*1000 && diff < 48*60*60*1000) return t('yesterday') + ' ' + timeStr;
    if (d.getFullYear() === now.getFullYear()) {
        return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + timeStr;
    }
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + timeStr;
}
function getDayKey(iso) {
    var d = new Date(iso);
    return d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate();
}

// ===================== 自定义弹窗组件 =====================
function closeCustomModal() {
    if (customModal) customModal.classList.remove('active');
    customModalIcon.innerHTML = '';
    customModalIcon.className = 'modal-icon';
    customModalSpinner.style.display = 'none';
    customModalTitle.textContent = '';
    customModalMessage.textContent = '';
    if (customModalCancel) customModalCancel.style.display = '';
    if (customModalConfirm) customModalConfirm.style.display = '';
}

function showMobileActionSheet(title, buttons) {
    var actionSheet = document.getElementById('mobileActionSheet');
    var actionTitle = document.getElementById('mobileActionTitle');
    var actionButtons = document.getElementById('mobileActionButtons');
    var actionOverlay = document.getElementById('mobileActionOverlay');
    var actionCancel = document.getElementById('mobileActionCancel');
    
    if (!actionSheet) return;
    
    actionTitle.textContent = title || '';
    actionButtons.innerHTML = '';
    
    buttons.forEach(function(btn) {
        var button = document.createElement('button');
        button.className = 'mobile-action-btn' + (btn.danger ? ' danger' : '');
        if (btn.icon) {
            button.innerHTML = btn.icon + '<span>' + btn.text + '</span>';
        } else {
            button.textContent = btn.text;
        }
        button.addEventListener('click', function() {
            closeMobileActionSheet();
            if (btn.onClick) setTimeout(btn.onClick, 0);
        });
        actionButtons.appendChild(button);
    });
    
    actionSheet.classList.add('active');
}

function closeMobileActionSheet() {
    var actionSheet = document.getElementById('mobileActionSheet');
    if (actionSheet) actionSheet.classList.remove('active');
}

function showCustomModal(options) {
    closeCustomModal();
    var type = options.type || 'info';
    var iconMap = {
        info: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
        success: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
        error: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        warning: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    };
    if (options.loading) {
        customModalSpinner.style.display = 'flex';
    } else {
        customModalIcon.className = 'modal-icon ' + type;
        customModalIcon.innerHTML = iconMap[type] || iconMap.info;
    }
    if (options.title) customModalTitle.textContent = options.title;
    if (options.message) customModalMessage.innerHTML = options.message;
    if (!options.showCancel && customModalCancel) customModalCancel.style.display = 'none';
    if (!options.showConfirm && customModalConfirm) customModalConfirm.style.display = 'none';
    if (options.confirmText && customModalConfirm) customModalConfirm.textContent = options.confirmText;
    if (options.cancelText && customModalCancel) customModalCancel.textContent = options.cancelText;
    if (customModal) customModal.classList.add('active');
}

function showAlert(message, type) {
    showCustomModal({
        type: type || 'info',
        title: type === 'success' ? t('success') : (type === 'error' ? t('error') : t('info')),
        message: message,
        showCancel: false,
        showConfirm: true,
        confirmText: t('ok')
    });
    if (customModalConfirm) {
        customModalConfirm.onclick = function() {
            closeCustomModal();
        };
    }
}

function showConfirm(message, onConfirm) {
    showCustomModal({
        type: 'warning',
        title: t('confirm'),
        message: message,
        showCancel: true,
        showConfirm: true,
        confirmText: t('confirm'),
        cancelText: t('cancel')
    });
    if (customModalConfirm) {
        customModalConfirm.onclick = function() {
            closeCustomModal();
            if (onConfirm) onConfirm();
        };
    }
}

function showLoading(message) {
    showCustomModal({
        loading: true,
        title: t('loading'),
        message: message || '',
        showCancel: false,
        showConfirm: false
    });
}

function setAuthMessage(msg, type) {
    if (!authMessage) return;
    authMessage.textContent = msg;
    authMessage.className = 'auth-message';
    if (type === 'success') authMessage.classList.add('success');
    if (type === 'error') authMessage.classList.add('error');
}
function autoResizeTextarea() { if (!chatInput) return; chatInput.style.height = 'auto'; chatInput.style.height = Math.min(Math.max(chatInput.scrollHeight,48),150)+'px'; adjustMobileMessagePadding(); }
function insertAtCursor(text) { if (!chatInput) return; chatInput.value += text; chatInput.focus(); chatInput.dispatchEvent(new Event('input',{bubbles:true})); autoResizeTextarea(); }

function adjustMobileMessagePadding() {
    if (!messageList) return;
    if (window.innerWidth > 768) {
        messageList.style.paddingBottom = '';
        return;
    }
    var inputArea = document.querySelector('.chat-main .input-area');
    if (!inputArea) return;
    var h = inputArea.offsetHeight;
    var pb = Math.max(160, h + 90);
    messageList.style.paddingBottom = pb + 'px';
}

// v3.1.0 文件图标与大小格式化
function getFileIcon(mimeType, name) {
    var m = (mimeType || '').toLowerCase();
    var n = (name || '').toLowerCase();
    if (m.startsWith('image/')) return '🖼️';
    if (m.startsWith('video/')) return '🎬';
    if (m.startsWith('audio/')) return '🎵';
    if (m === 'application/pdf' || n.endsWith('.pdf')) return '📄';
    if (m.includes('word') || m.includes('document') || /\.(doc|docx)$/.test(n)) return '📝';
    if (m.includes('excel') || m.includes('spreadsheet') || /\.(xls|xlsx|csv)$/.test(n)) return '📊';
    if (m.includes('presentation') || /\.(ppt|pptx)$/.test(n)) return '🎤';
    if (m.includes('zip') || n.endsWith('.zip') || n.endsWith('.rar') || n.endsWith('.7z')) return '🗜️';
    if (m.startsWith('text/') || n.endsWith('.txt')) return '📃';
    return '📎';
}
function formatFileSize(bytes) {
    if (!bytes || bytes < 0) return '未知大小';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
    if (bytes < 1024*1024*1024) return (bytes/1024/1024).toFixed(1) + ' MB';
    return (bytes/1024/1024/1024).toFixed(1) + ' GB';
}

// v3.1.0 敏感词过滤（前端轻量，服务器可补充）
var SENSITIVE_WORDS = ['fuck', 'shit', 'bitch', 'asshole', '傻逼', '你妈的', '操你', '滚蛋', '智障'];
function containsSensitive(text) {
    if (!text) return false;
    var lower = text.toLowerCase();
    for (var i = 0; i < SENSITIVE_WORDS.length; i++) {
        if (lower.indexOf(SENSITIVE_WORDS[i]) !== -1) return SENSITIVE_WORDS[i];
    }
    return false;
}
// v3.1.1 敏感词拦截：弹出 alert + setAuthMessage 双重提示，并返回 false
function checkSensitive(text) {
    var bad = containsSensitive(text);
    if (bad) {
        var msg = t('sensitiveWordTip').replace('{word}', bad);
        showAlert(msg, 'error');
        setAuthMessage(msg, 'error');
        setTimeout(function(){ setAuthMessage(''); }, 2500);
        return false;
    }
    return true;
}

// ===================== 版本检测 =====================
function checkForUpdate() {
    var currentVersion = APP_VERSION;
    var el = document.getElementById('currentVerDisplay');
    if (el) el.textContent = currentVersion;
    fetch('./data/vision.json?t=' + Date.now() + '&v=' + Math.random(), { cache: 'no-store' })
        .then(function(response) { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); })
        .then(function(data) {
            var remoteVersion = data.version || '';
            if (remoteVersion && remoteVersion !== currentVersion) {
                document.getElementById('newVerDisplay').textContent = remoteVersion;
                var modal = document.getElementById('versionUpdateModal');
                if (modal) modal.classList.add('active');
            } else {
                var statusEl = document.getElementById('updateCheckStatus');
                if (statusEl) { statusEl.textContent = t('alreadyLatest'); statusEl.className = 'update-check-status show success'; setTimeout(function(){ statusEl.textContent = ''; statusEl.className = 'update-check-status'; }, 3000); }
            }
        })
        .catch(function(err) { console.warn('版本检测失败:', err.message); });
}
checkForUpdate();
async function anonymizeUserMessages(email) {
    try {
        var { data: messages, error } = await supabase.from('messages')
            .update({ sender_email: 'deleted_user', sender_name: 'deleted_user' })
            .eq('sender_email', email)
            .select();
        if (error) throw error;
        return { success: true, count: messages ? messages.length : 0 };
    } catch(err) {
        console.error('清理消息失败:', err);
        return { success: false, error: err.message };
    }
}
async function checkAndRestoreMessages(email) {
    try {
        var { count, error } = await supabase.from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('sender_email', 'deleted_user');
        if (error) throw error;
        if (count > 0) {
            showConfirm('检测到 ' + count + ' 条已注销用户的消息。这些消息可能是您之前账户发送的。\n\n是否将这些消息恢复为当前账户发送？', async function() {
                var { data: messages, error: updateError } = await supabase.from('messages')
                    .update({ sender_email: email, sender_name: email.split('@')[0] })
                    .eq('sender_email', 'deleted_user')
                    .select();
                if (updateError) throw updateError;
                showAlert(t('restoredMessages').replace('{count}', messages ? messages.length : 0), 'success');
            });
        }
    } catch(err) {
        console.error('检测历史消息失败:', err);
    }
}
(function enforceLocalCache() {
    var storedVer = localStorage.getItem('minichat_version');
    if (storedVer && storedVer !== APP_VERSION) {
        localStorage.setItem('minichat_version', APP_VERSION);
        if ('caches' in window) caches.keys().then(function(names) { names.forEach(function(name) { if (name.includes('minichat')) caches.delete(name); }); });
        location.reload(true);
    } else if (!storedVer) localStorage.setItem('minichat_version', APP_VERSION);
})();
var refreshBtn = document.getElementById('versionRefresh');
if (refreshBtn) refreshBtn.addEventListener('click', function() {
    if ('caches' in window) caches.keys().then(function(names) { return Promise.all(names.map(function(n) { return caches.delete(n); })); }).then(function(){ location.reload(true); });
    else location.reload(true);
});
var laterBtn = document.getElementById('versionLater');
if (laterBtn) laterBtn.addEventListener('click', function() { var modal = document.getElementById('versionUpdateModal'); if (modal) modal.classList.remove('active'); });

// ===================== Supabase 初始化 =====================
var SUPABASE_URL = 'https://xgugltiuszrpmbxjmqfv.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhndWdsdGl1c3pycG1ieGptcWZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0ODE2MTUsImV4cCI6MjA5ODA1NzYxNX0.nWiJm_7Fh3-6MUdazhW7CwOAi8w2PVMsDbfhUNyUIsM';
if (!supabase || !supabase.auth) window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===================== FloxChat 桥接 =====================
// 安全约定：FloxChat 的共享密钥与用户表只存在于 Edge Function 服务端；
// 浏览器端既不接触密钥，也拿不到 FloxChat 用户数据，更不会注册 FloxChat 账号。
var MINICHAT_EDGE_URL = "https://xgugltiuszrpmbxjmqfv.supabase.co/functions/v1/clever-task";
var MINICHAT_BRIDGE_SECRET = "flox-meow-2024";

// ===================== 人机验证（CAPTCHA）配置 =====================
// 留空 = 不启用。填上 site key 后会自动加载对应提供商的脚本，
// 并在登录 / 注册 / 重置密码时附带 captchaToken。
// 注意：Edge Function 侧用的是 service_role，GoTrue 对 service_role 会跳过 CAPTCHA
//      校验（internal/api/middleware.go 的 requireAdminCredentials 例外），
//      所以 FloxChat 验证码登录这条路径不需要人机验证。
var CAPTCHA_SITE_KEY = '0x4AAAAAAExcrClTSiZHfYTp'; // Cloudflare Turnstile Site Key（公开值，放前端没问题）
// ⚠️ Secret Key 只填在 Supabase → Authentication → Attack Protection，
//    绝不要写进前端、仓库或任何公开位置。

// 统一调用 Edge Function；失败时抛出带 code 的错误，便于区分“账号密码错误”和网络故障
async function callFloxEdge(payload) {
    var resp = await fetch(MINICHAT_EDGE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ secret: MINICHAT_BRIDGE_SECRET }, payload))
    });
    var data = {};
    try { data = await resp.json(); } catch (e) {}
    if (!resp.ok || data.error) {
        var err = new Error(data.error || ('HTTP ' + resp.status));
        err.code = data.code || '';
        throw err;
    }
    return data;
}

// Edge 已签发会话：落地 Supabase 会话并进入聊天
async function applyFloxSession(edgeData, email) {
    if (!edgeData || !edgeData.access_token || !edgeData.refresh_token) throw new Error('边缘函数未返回有效令牌');
    var setRes = await supabase.auth.setSession({ access_token: edgeData.access_token, refresh_token: edgeData.refresh_token });
    if (setRes.error) throw new Error('设置会话失败: ' + setRes.error.message);
    // 验证会话已生效
    var checkRes = await supabase.auth.getSession();
    if (!checkRes.data.session) throw new Error('会话未建立，请重试');
    currentEmail = email;
    currentUserId = edgeData.user_id;
    // 对齐正常登录流程：创建/更新 profile、恢复已注销用户消息
    await ensureProfile(currentUserId, email);
    await checkAndRestoreMessages(email);
    // 显式持久化 minichat_user，确保刷新后可恢复
    localStorage.setItem('minichat_user', JSON.stringify({ email: email, id: edgeData.user_id }));
    afterLoginSuccess();
}

// ===================== 分页（login.html / index.html） =====================
// 不再靠"遮罩切换"在一个页面里切换两套界面，而是拆成两个页面。
// 两边共用同一份 app.js，靠 body[data-page] 判断自己在哪一页。
var IS_LOGIN_PAGE = (document.body && document.body.getAttribute('data-page')) === 'login';
// 登录成功后的去向：登录页 -> 跳聊天页；聊天页 -> 原地进入
function afterLoginSuccess() {
    // 登录页 -> 聊天页（根路径）；聊天页 -> 原地进入
    if (IS_LOGIN_PAGE) {
        // ⚠️ 跳转前必须把登录信息写进 localStorage。
        //    聊天页启动时靠它判断"是否已登录"，而这条写入原本在 enterChat() 里 ——
        //    登录页走的是跳转分支、根本执行不到 enterChat()，
        //    于是聊天页以为没登录又把用户踢回 /login/，来回死循环。
        try {
            if (window.currentEmail) {
                localStorage.setItem('minichat_user', JSON.stringify({ email: window.currentEmail, id: window.currentUserId || '' }));
            }
        } catch (e) {}
        location.replace('/');
    }
    else { enterChat(); }
}

// ===================== 认证 =====================
function switchMode(mode) {
    isLoginMode = (mode === 'login');
    if (authTitle) authTitle.textContent = isLoginMode ? t('welcome') : t('createAccount');
    if (authSub) authSub.textContent = isLoginMode ? t('loginDesc') : t('signupDesc');
    if (btnLogin) btnLogin.textContent = isLoginMode ? t('login') : t('register');
    var tEl = document.querySelector('.auth-toggle');
    if (tEl) tEl.innerHTML = isLoginMode ? t('noAccount') : t('hasAccount');
    setAuthMessage('');
}
function handleAuthToggleClick(e) {
    var target = e.target.closest && e.target.closest('#switchToSignup');
    if (!target) return;
    e.preventDefault();
    switchMode(isLoginMode ? 'signup' : 'login');
}
async function handleAuth() {
    var email = authEmail ? authEmail.value.trim() : '';
    var pwd = authPassword ? authPassword.value.trim() : '';
    if (!email || !pwd) { setAuthMessage('请填写邮箱和密码','error'); return; }
    if (pwd.length < 6) { setAuthMessage('密码至少6位','error'); return; }
    if (!isLoginMode) {
        showTermsModal(function(agreed) {
            if (agreed) doAuth(email, pwd);
        });
        return;
    }
    doAuth(email, pwd);
}
// ===================== 人机验证（CAPTCHA） =====================
var captchaSlots = {};        // slotId -> { widgetId, token }
var captchaLoadPromise = null;

function captchaEnabled() { return !!CAPTCHA_SITE_KEY; }

function loadCaptchaScript() {
    if (captchaLoadPromise) return captchaLoadPromise;
    var url = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    captchaLoadPromise = new Promise(function(resolve, reject) {
        var s = document.createElement('script');
        s.src = url; s.async = true; s.defer = true;
        s.onload = function() { resolve(); };
        s.onerror = function() { reject(new Error('验证码脚本加载失败')); };
        document.head.appendChild(s);
    });
    return captchaLoadPromise;
}

function renderCaptcha(slotId) {
    if (!captchaEnabled()) return;
    var box = document.getElementById(slotId);
    if (!box) return;
    if (captchaSlots[slotId] && captchaSlots[slotId].widgetId !== null && captchaSlots[slotId].widgetId !== undefined) return;
    loadCaptchaScript().then(function() {
        var opts = {
            sitekey: CAPTCHA_SITE_KEY,
            theme: document.body.classList.contains('light-theme') ? 'light' : 'dark',
            callback: function(t) { captchaSlots[slotId].token = t; },
            'expired-callback': function() { captchaSlots[slotId].token = null; },
            'error-callback': function() { captchaSlots[slotId].token = null; captchaSlots[slotId].error = true; }
        };
        var slot = captchaSlots[slotId] = captchaSlots[slotId] || { widgetId: null, token: null, error: false };
        if (window.turnstile) slot.widgetId = window.turnstile.render(box, opts);
    }).catch(function(e) { console.warn('CAPTCHA 初始化失败：', e.message); });
}

function captchaTokenOf(slotId) {
    var slot = captchaSlots[slotId];
    return slot ? slot.token : null;
}

// 每次校验后必须重置：token 是一次性的
function resetCaptcha(slotId) {
    var slot = captchaSlots[slotId];
    if (!slot) return;
    slot.token = null;
    try {
        if (slot.widgetId === null || slot.widgetId === undefined) return;
        if (window.turnstile) window.turnstile.reset(slot.widgetId);
    } catch (e) {}
}

async function doAuth(email, pwd) {
    // 开启 CAPTCHA 后，登录/注册请求必须带 captchaToken，否则 GoTrue 直接拒绝
    if (captchaEnabled() && !captchaTokenOf('captchaBoxLogin')) {
        renderCaptcha('captchaBoxLogin');
        var capSlot = captchaSlots['captchaBoxLogin'];
        setAuthMessage(capSlot && capSlot.error ? '人机验证组件加载失败，请刷新页面重试' : '请先完成下方的人机验证', 'error');
        return;
    }
    if (btnLogin) { btnLogin.disabled = true; btnLogin.style.opacity = '0.6'; }
    setAuthMessage('处理中…','');
    try {
        var r;
        var capOpts = captchaEnabled() ? { captchaToken: captchaTokenOf('captchaBoxLogin') } : null;
        if (isLoginMode) {
            r = await supabase.auth.signInWithPassword(capOpts ? { email, password: pwd, options: capOpts } : { email, password: pwd });
        } else {
            var existsRes = await supabase.from('profiles').select('id').eq('email', email).maybeSingle();
            if (existsRes && existsRes.data) {
                setAuthMessage('该邮箱已注册，请直接登录','error');
                if (btnLogin) { btnLogin.disabled = false; btnLogin.style.opacity = '1'; }
                return;
            }
            r = await supabase.auth.signUp(capOpts ? { email, password: pwd, options: capOpts } : { email, password: pwd });
        }
        if (captchaEnabled()) resetCaptcha('captchaBoxLogin');   // token 一次性，用完立刻重置
        if (r.error) { setAuthMessage(r.error.message.includes('Email not confirmed') ? '请先验证邮箱后再登录' : (r.error.message.includes('already') || r.error.message.includes('exists') || r.error.message.includes('registered') ? '该邮箱已注册，请直接登录' : r.error.message),'error'); if (btnLogin) { btnLogin.disabled = false; btnLogin.style.opacity = '1'; } return; }
        var u = r.data.user;
        if (!u) { setAuthMessage('未获取到用户信息','error'); if (btnLogin) { btnLogin.disabled = false; btnLogin.style.opacity = '1'; } return; }
        currentEmail = u.email; currentUserId = u.id;
        await ensureProfile(u.id, u.email);
        if (isLoginMode) {
            setAuthMessage('登录成功','success');
            if (btnLogin) { btnLogin.disabled = false; btnLogin.style.opacity = '1'; }
            await checkAndRestoreMessages(u.email);
            afterLoginSuccess();
        }
        else { setAuthMessage('注册成功！请查收邮件确认后登录。','success'); if (btnLogin) { btnLogin.disabled = false; btnLogin.style.opacity = '1'; } }
    } catch(e) { console.error(e); setAuthMessage('网络错误，请重试','error'); if (btnLogin) { btnLogin.disabled = false; btnLogin.style.opacity = '1'; } }
}
// ===================== FloxChat 验证码登录交互 =====================
var floxEmailVal = '';
// ---- FloxChat 登录面板：步骤条 / 重发倒计时 / 按钮加载态 ----
var floxResendTimer = null;
function floxSetStep(n) {
    var a = document.getElementById('floxStepA'), b = document.getElementById('floxStepB');
    if (!a || !b) return;
    a.classList.toggle('is-active', n === 1);
    a.classList.toggle('is-done', n === 2);
    b.classList.toggle('is-active', n === 2);
}
function floxSetLoading(btn, on) {
    if (!btn) return;
    btn.classList.toggle('is-loading', !!on);
    btn.disabled = !!on;
}
function floxStartResendCountdown(seconds) {
    var btn = document.getElementById('btnFloxResend');
    if (!btn) return;
    if (floxResendTimer) { clearInterval(floxResendTimer); floxResendTimer = null; }
    var left = seconds || 60;
    var render = function() {
        if (left > 0) { btn.disabled = true; btn.textContent = '重新发送（' + left + 's）'; }
        else { btn.disabled = false; btn.textContent = '重新发送'; clearInterval(floxResendTimer); floxResendTimer = null; }
    };
    render();
    floxResendTimer = setInterval(function() { left--; render(); }, 1000);
}
function switchToFloxLogin() {
    var altLogin = document.getElementById('altLogin');
    if (altLogin) altLogin.style.display = 'none';
    document.querySelector('.login-card .logo-area').style.display = 'none';
    document.querySelector('.login-card .auth-title').style.display = 'none';
    document.querySelector('.login-card .auth-sub').style.display = 'none';
    document.querySelectorAll('.auth-field').forEach(function(el) { el.style.display = 'none'; });
    document.querySelector('.login-card .pwd-wrapper').style.display = 'none';
    document.getElementById('btnLogin').style.display = 'none';
    document.querySelector('.auth-toggle').style.display = 'none';
    document.getElementById('authMessage').style.display = 'none';
    // FloxChat 登录走 Edge Function 的 service_role，GoTrue 会跳过 CAPTCHA，
    // 所以这里不需要人机验证，直接把它藏起来
    var capBoxFlox = document.getElementById('captchaBoxLogin');
    if (capBoxFlox) capBoxFlox.style.display = 'none';
    document.getElementById('floxLogin').style.display = 'block';
    document.getElementById('floxStep1').style.display = 'flex';
    document.getElementById('floxStep2').style.display = 'none';
    document.getElementById('switchFloxChat').style.display = 'none';
    document.getElementById('floxMsg').textContent = '';
    document.getElementById('floxMsg').style.display = '';
    floxSetStep(1);
    var rs = document.getElementById('btnFloxResend');
    if (rs) { rs.disabled = true; rs.textContent = '重新发送'; }
    var codeEl = document.getElementById('floxCode');
    if (codeEl) codeEl.value = '';
}
function switchBackFromFlox() {
    // 回到登录界面时要把 #app 容器放回来（它承载登录界面本身）
    var appShellBack = document.getElementById('app');
    if (appShellBack) appShellBack.style.display = '';
    var altLoginBack = document.getElementById('altLogin');
    if (altLoginBack) altLoginBack.style.display = '';
    document.querySelector('.login-card .logo-area').style.display = '';
    document.querySelector('.login-card .auth-title').style.display = '';
    document.querySelector('.login-card .auth-title').textContent = isLoginMode ? t('welcome') : t('createAccount');
    document.querySelector('.login-card .auth-sub').style.display = '';
    document.querySelectorAll('.auth-field').forEach(function(el) { el.style.display = ''; });
    document.querySelector('.login-card .pwd-wrapper').style.display = '';
    document.getElementById('btnLogin').style.display = '';
    document.querySelector('.auth-toggle').style.display = '';
    document.getElementById('authMessage').style.display = '';
    var capBoxBack = document.getElementById('captchaBoxLogin');
    if (capBoxBack) capBoxBack.style.display = '';
    document.getElementById('floxLogin').style.display = 'none';
    document.getElementById('switchFloxChat').style.display = '';
}
async function handleFloxSendCode() {
    var email = document.getElementById('floxEmail').value.trim();
    if (!email) { document.getElementById('floxMsg').textContent = '请输入邮箱'; return; }
    floxEmailVal = email;
    var sendBtn = document.getElementById('btnFloxSendCode');
    var msgEl0 = document.getElementById('floxMsg');
    msgEl0.textContent = '';
    floxSetLoading(sendBtn, true);
    try {
        var resp = await fetch('https://shebiao.dpdns.org/ces/send-code', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email })
        });
        var data = await resp.json();
        if (data.message === 'Code sent') {
            document.getElementById('floxStep1').style.display = 'none';
            document.getElementById('floxStep2').style.display = 'flex';
            floxSetStep(2);
            floxStartResendCountdown(60);
            msgEl0.textContent = '验证码已发送至 ' + email;
            var codeEl2 = document.getElementById('floxCode');
            if (codeEl2) { codeEl2.value = ''; codeEl2.focus(); }
        } else {
            msgEl0.textContent = '发送失败：' + (data.message || data.error || '请稍后重试');
        }
    } catch(e) {
        msgEl0.textContent = '网络错误，请重试';
    }
    floxSetLoading(sendBtn, false);
}
// 重新发送 = 复用上面的流程
document.getElementById('btnFloxResend').addEventListener('click', function() { handleFloxSendCode(); });
// 回车提交
document.getElementById('floxEmail').addEventListener('keydown', function(e) { if (e.key === 'Enter') handleFloxSendCode(); });
document.getElementById('floxCode').addEventListener('keydown', function(e) { if (e.key === 'Enter') handleFloxVerify(); });
document.getElementById('floxCode').addEventListener('input', function() { this.value = this.value.replace(/\D/g, '').slice(0, 6); });
async function handleFloxVerify() {
    var code = document.getElementById('floxCode').value.trim();
    if (!code) { document.getElementById('floxMsg').textContent = '请输入验证码'; return; }
    var btn = document.getElementById('btnFloxVerify');
    var msgEl = document.getElementById('floxMsg');
    msgEl.textContent = '';
    floxSetLoading(btn, true);
    try {
        // 验证码同样交给 Edge Function 在服务端校验，避免前端伪造邮箱直接换会话
        var data = await callFloxEdge({ action: 'flox_code_login', email: floxEmailVal, code: code });
        msgEl.textContent = '登录中…';
        await applyFloxSession(data, data.email);
    } catch(e) {
        msgEl.textContent = (e.code === 'INVALID_CODE') ? '验证码错误或已过期，请重新获取' : ('网络错误：' + (e.message || '请重试'));
        floxSetLoading(btn, false);
    }
}
function showTermsModal(callback) {
    if (!termsOverlay) { if (callback) callback(false); return; }
    termsOverlay.classList.add('active');
    if (termsAgree) termsAgree.checked = false;
    var onConfirm = function() {
        if (termsAgree && termsAgree.checked) {
            termsOverlay.classList.remove('active');
            if (callback) callback(true);
        }
    };
    var onClose = function() {
        termsOverlay.classList.remove('active');
        if (callback) callback(false);
    };
    if (termsConfirm) {
        termsConfirm.removeEventListener('click', onConfirm);
        termsConfirm.addEventListener('click', onConfirm);
    }
    if (termsClose) {
        termsClose.removeEventListener('click', onClose);
        termsClose.addEventListener('click', onClose);
    }
}
async function ensureProfile(uid, email) {
    var data = (await supabase.from('profiles').select('id').eq('id', uid).maybeSingle()).data;
    if (!data) {
        await supabase.from('profiles').insert({ id: uid, email, last_login: new Date().toISOString(), display_name: email.split('@')[0], avatar_url: getDefaultAvatar(email) });
        await supabase.from('conversation_participants').insert({ conversation_id: '00000000-0000-0000-0000-000000000000', user_id: uid });
    } else {
        await supabase.from('profiles').update({ last_login: new Date().toISOString() }).eq('id', uid);
    }
}

// ===================== 启动画面 =====================
(function() {
    // 动画总时长（CSS 里最后一层在 1.62s 出现，留出一点收尾时间）
    var DURATION = 1800;
    var splash = document.getElementById('splash');
    function hide() {
        if (!splash) return;
        // 先跑完最后一拍再淡出，避免"动画没演完就消失"
        // ⚠️ 关键：启动画面【不能在这里就藏掉】。
        //    已登录时我们要等 getSession() 才有结果，如果这会儿已经把启动画面藏了、
        //    又还没显示主界面，屏幕上就是一片白（亮色主题下 body 背景 #fafafa）——
        //    这正是"白屏"的成因。所以改成：确定去哪个界面时再揭幕。
        function dismissSplash() {
            if (!splash) return;
            splash.classList.add('hidden');
            setTimeout(function(){ splash.remove(); }, 620);
        }

        var revealed = false;
        function showLogin() {
            if (revealed) return;
            revealed = true;
            // 登录界面也要用正确的主题（原来这里不调 loadTheme，
            // 白天打开时登录页是深色、主界面是亮色，前后不一致）
            loadTheme();
            dismissSplash();
            if (loginOverlay) loginOverlay.classList.remove('hidden');
            renderCaptcha('captchaBoxLogin');
        }

        // ---- 登录页：这里就是终点，永远显示登录界面 ----
        // 拆页之后登录页不再需要"会话恢复"这套逻辑，
        // 也不再有"登录界面闪一下"的问题 —— 它本来就该显示登录界面。
        if (IS_LOGIN_PAGE) { showLogin(); return; }

        // ---- 聊天页：必须有会话，否则去登录页 ----
        var user = null;
        try {
            var raw = localStorage.getItem('minichat_user');
            if (raw) user = JSON.parse(raw);
        } catch(e) {}

        // 本地没有登录记录 / SDK 没起来 —— 直接跳登录页（不再原地显示登录遮罩）
        if (!user || !user.email || !window.supabase || !window.supabase.auth) {
            console.log('[MiniChat/boot] 聊天页无本地登录记录 → 跳转 /login/');
            location.replace('/login/');
            return;
        }

        // 登录过：先【不露登录界面】，等会话确认完再决定，
        // 否则会「登录界面闪一下 → 又切到聊天」，观感很差（原来的闪屏就是这么来的）
        window.currentEmail = user.email;
        window.currentUserId = user.id || '';
        var settled = false;
        // 兜底：3 秒还没结果就露登录界面 —— 无论如何都不能留下空白页
        var guard = setTimeout(showLogin, 3000);
        function fallbackToLogin(reason) {
            if (settled) return;
            settled = true;
            clearTimeout(guard);
            if (reason) console.warn('[MiniChat/boot] 会话恢复失败：' + reason + ' → 跳转 /login/');
            // 拆页后不再原地露登录遮罩，直接去登录页
            location.replace('/login/');
        }
        window.supabase.auth.getSession().then(function(data) {
            var session = data && data.data && data.data.session;
            if (session && typeof window.enterChat === 'function') {
                settled = true;
                clearTimeout(guard);
                revealed = true;
                hasMoreMessages = true;
                oldestTimestamp = null;
                isLoadingMore = false;
                unreadCount = 0;
                currentUserMap = {};
                allLoadedMessages = [];
                lastTimeLabel = '';
                lastTimeDivider = 0;
                // 主题在启动画面还盖着的时候先切好，避免进主界面的瞬间深色闪成白色
                loadTheme();
                dismissSplash();
                window.enterChat();
            } else {
                fallbackToLogin('no session');
            }
        }, function(e) { fallbackToLogin(e && e.message); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(hide, DURATION); });
    else setTimeout(hide, DURATION);

    // 自检：揭幕后 1.5 秒检查一次，两个界面都不该同时不可见。
    // 真出现这种情况（历史上就是"白屏"）就强制显示登录界面，绝不把用户留在空白页。
    setTimeout(function() {
        var loginHidden = !loginOverlay || loginOverlay.classList.contains('hidden');
        var appHidden = !mainInterface || mainInterface.classList.contains('hidden');
        console.log('[MiniChat/boot] 状态自检 | 登录界面可见=' + !loginHidden + ' 主界面可见=' + !appHidden +
                    ' 启动画面还在=' + !!document.getElementById('splash'));
        if (loginHidden && appHidden) {
            console.warn('[MiniChat/boot] 两个界面都不可见 → 强制显示登录界面');
            if (loginOverlay) loginOverlay.classList.remove('hidden');
        }
        // 实测计算样式与几何：class 正常不代表真的可见
        // （opacity / visibility 会沿 DOM 树继承，光看 classList 看不出来）
        if (mainInterface) {
            var cs = getComputedStyle(mainInterface);
            var rect = mainInterface.getBoundingClientRect();
            console.log('[MiniChat/boot] 主界面实测 | opacity=' + cs.opacity + ' visibility=' + cs.visibility +
                        ' display=' + cs.display + ' zIndex=' + cs.zIndex + ' animation=' + cs.animationName +
                        ' 尺寸=' + Math.round(rect.width) + 'x' + Math.round(rect.height) +
                        '@' + Math.round(rect.left) + ',' + Math.round(rect.top));
            // 关键：把 body 的直接子元素全部列出来，看看是谁把主界面顶下去了
            var kids = [];
            [].forEach.call(document.body.children, function(el) {
                var r = el.getBoundingClientRect();
                var c = getComputedStyle(el);
                kids.push((el.id ? '#' + el.id : ('<' + el.tagName.toLowerCase() + ' class="' + String(el.className).split(' ')[0] + '">')) +
                          '[disp=' + c.display + ',pos=' + c.position + ',高度=' + Math.round(r.height) +
                          ',top=' + Math.round(r.top) + ',bottom=' + Math.round(r.bottom) + ']');
            });
            console.log('[MiniChat/boot] body 直接子元素 | ' + kids.join('  |  '));
            // 顺便查:上面那些元素的总占位高度
            var occupied = 0;
            [].forEach.call(document.body.children, function(el) {
                if (el === mainInterface) return;
                var c = getComputedStyle(el);
                if (c.display === 'none' || c.position === 'absolute' || c.position === 'fixed') return;
                occupied += el.getBoundingClientRect().height;
            });
            console.log('[MiniChat/boot] 主界面之上的【在流】元素总高 = ' + Math.round(occupied) + 'px');
            var chain = [], p = mainInterface.parentElement;
            while (p && p !== document.documentElement) {
                var pcs = getComputedStyle(p);
                chain.push((p.id ? '#' + p.id : (p.className ? '.' + String(p.className).split(' ')[0] : p.tagName)) +
                           '(' + pcs.display + ',op=' + pcs.opacity + ',vis=' + pcs.visibility + ')');
                p = p.parentElement;
            }
            console.log('[MiniChat/boot] 祖先链 | ' + chain.join(' ← '));
            console.log('[MiniChat/boot] 视口 | ' + window.innerWidth + 'x' + window.innerHeight +
                        ' | body尺寸=' + document.body.clientWidth + 'x' + document.body.clientHeight +
                        ' | html高度=' + getComputedStyle(document.documentElement).height +
                        ' | body高度=' + getComputedStyle(document.body).height);
        }
    }, DURATION + 1500);
})();

// ===================== 主题 =====================
function isNightTime() {
    var hour = new Date().getHours();
    return hour >= 19 || hour < 6;
}
function loadTheme() {
    var saved = localStorage.getItem('minichat_theme') || 'auto';
    if (saved === 'light') {
        document.body.classList.add('light-theme');
    } else if (saved === 'system') {
        var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (!systemDark) document.body.classList.add('light-theme');
    } else if (saved === 'auto') {
        if (!isNightTime()) document.body.classList.add('light-theme');
        else document.body.classList.remove('light-theme');
    } else {
        document.body.classList.remove('light-theme');
    }
}
function setTheme(theme) {
    localStorage.setItem('minichat_theme', theme);
    if (theme === 'light') {
        document.body.classList.add('light-theme');
    } else if (theme === 'system') {
        var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (systemDark) document.body.classList.remove('light-theme');
        else document.body.classList.add('light-theme');
    } else if (theme === 'auto') {
        if (!isNightTime()) document.body.classList.add('light-theme');
        else document.body.classList.remove('light-theme');
    } else {
        document.body.classList.remove('light-theme');
    }
    updateThemeButtons();
}
function updateThemeButtons() {
    var saved = localStorage.getItem('minichat_theme') || 'auto';
    var buttons = document.querySelectorAll('.theme-option');
    buttons.forEach(function(btn) {
        var theme = btn.dataset.theme;
        if (theme === saved) btn.classList.add('active');
        else btn.classList.remove('active');
    });
}
function toggleTheme() {
    var saved = localStorage.getItem('minichat_theme') || 'auto';
    var themes = ['dark', 'light', 'system', 'auto'];
    var current = themes.indexOf(saved);
    var next = (current + 1) % themes.length;
    setTheme(themes[next]);
}
function checkAutoTheme() {
    var saved = localStorage.getItem('minichat_theme') || 'auto';
    if (saved === 'auto') {
        setTheme('auto');
    }
}
setInterval(checkAutoTheme, 60000);

// ===================== 国际化（i18n） =====================

// 只保留登录页用到的键（原字典约 65KB，这里约几 KB）
var i18n = {
  zh: {
    login: "登录",
    register: "注册",
    forgotPassword: "忘记密码？",
    welcome: "欢迎回来",
    loginOrSignup: "登录或注册账户",
    createAccount: "创建账户",
    loginDesc: "登录你的账户",
    signupDesc: "使用邮箱和密码注册",
    noAccount: "还没有账户？<a id=\"switchToSignup\">注册</a>",
    hasAccount: "已有账户？<a id=\"switchToSignup\">登录</a>",
    emailPlaceholder: "电子邮箱",
    passwordPlaceholder: "密码",
    emailLabel: "电子邮箱",
    passwordLabel: "密码",
    chatPlaceholder: "输入消息…（Ctrl+Enter 换行，Enter 发送）",
    globalChat: "全局聊天",
    allMembers: "# 所有成员",
    online: "在线",
    agreeTerms: "我已阅读并同意上述服务协议",
    confirm: "确定",
    settings: "设置",
    profile: "个人资料",
    general: "通用设置",
    account: "账户",
    about: "关于",
    terms: "服务协议",
    noticeBeforeUse: "使用前须知",
    welcomeMiniChat: "欢迎使用 MiniChat",
    noticeDesc1: "在您注册账户前，请仔细阅读 MiniChat 的完整服务协议。注册即表示您已知悉并同意以下内容：",
    quickAgreementTitle: "简要协议",
    quickAgreementNotice: "您应年满 13 周岁；不发送违法、违规或恶意内容；妥善保管账户密码；尊重其他用户合法权益；遵守相关法律法规。",
    fullAgreementLinkTitle: "完整服务协议",
    viewFullAgreement: "查看完整服务协议 →",
    quickAgreement: "简易服务协议",
    quickAgreementDesc: "查看服务协议的简要版本",
    fullAgreement: "具体服务协议",
    fullAgreementDesc: "查看完整的服务协议详情",
    view: "查看",
    avatar: "头像",
    uploadAvatar: "点击上传新头像",
    displayName: "显示昵称",
    displayNameDesc: "其他成员将看到这个名字",
    save: "保存",
    theme: "主题",
    themeMode: "主题模式",
    themeDesc: "选择界面外观模式",
    darkMode: "深色模式",
    lightMode: "浅色模式",
    systemMode: "跟随系统",
    autoMode: "自动",
    language: "语言",
    interfaceLanguage: "界面语言",
    languageDesc: "选择应用界面语言",
    chinese: "中文",
    accountInfo: "账户信息",
    accountEmail: "邮箱",
    emailDesc: "您的登录邮箱",
    resetPassword: "重置密码",
    resetPasswordDesc: "重置您的账户密码",
    accountActions: "账户操作",
    logout: "退出登录",
    logoutDesc: "退出后需重新登录",
    logoutBtn: "退出",
    deleteAccount: "注销账户",
    deleteAccountDesc: "永久删除您的账户和所有数据",
    versionCheck: "版本检测",
    checkUpdate: "手动检查更新",
    checkUpdateDesc: "检查是否有新版本可用",
    checkUpdateBtn: "检测更新",
    version: "版本",
    developer: "开发者",
    license: "许可证",
    githubRepo: "GitHub 仓库",
    feedback: "反馈问题",
    bilibili: "ningqi24的Bilibili账户",
    inputSettings: "输入框设置",
    inputAutoHide: "输入框显示",
    inputAutoHideDesc: "控制输入框的显示方式",
    inputAuto: "自动",
    inputAlwaysShow: "始终显示",
    inputAlwaysHide: "始终隐藏",
    notifications: "通知",
    desktopNotifications: "桌面通知",
    desktopNotificationsDesc: "收到新消息时显示桌面通知",
    soundEnabled: "启用声音",
    soundEnabledDesc: "收到新消息时播放提示音",
    mentionNotifications: "提及通知",
    mentionNotificationsDesc: "被@时发送通知",
    loading: "加载中…",
    searchPlaceholder: "搜索消息…",
    quoteMessage: "引用消息",
    quoteAuthor: "作者",
    quoteTime: "时间",
    quoteContent: "引用内容",
    cancel: "取消",
    ok: "确定",
    success: "成功",
    error: "错误",
    info: "提示",
    jumpToOriginal: "跳转到原文",
    mention: "@提及",
    viewProfile: "查看资料",
    mobileChat: "聊天",
    mobileMembers: "成员",
    mobileSettings: "设置",
    newVersionAvailable: "发现新版本",
    currentVersion: "当前版本",
    newestVersion: "最新版本",
    updateAvailable: "有更新可用",
    remindLater: "稍后提醒",
    refreshNow: "立即刷新",
    selectingFile: "正在选择文件...",
    selectFileHint: "请从系统对话框中选择图片或音频",
    today: "今天",
    yesterday: "昨天",
    upload: "上传",
    nickname: "昵称",
    credits: "致谢",
    creditThis: "本项目",
    creditInspired: "设计灵感来源",
    creditBased: "本项目基于其构建",
    partners: "合作",
    partnerFloxDesc: "MiniChat 的 FloxChat 验证码登录能力由 FloxChat 提供；FloxChat 侧也通过桥接扩展接入了 MiniChat 群聊。",
    partnerAuthor: "作者 · 摄表",
    svcSupabase: "数据库 · 账号 · 文件存储 · 边缘函数",
    svcTurnstile: "人机验证",
    svcJsdelivr: "CDN：加载 Supabase SDK",
    svcEsmsh: "CDN：Edge Function 依赖",
    svcUiavatar: "默认头像生成",
    svcGhpages: "静态站点托管",
    svcEmojihub: "Emoji 数据",
    svcTurbowarp: "FloxChat 运行环境",
    svcLucide: "图标",
    alreadyLatest: "当前已是最新版本",
    restoredMessages: "已恢复 {count} 条消息。",
    sensitiveWordTip: "消息包含敏感词（\"{word}\"），请修改后重试"
  },
  en: {
    login: "Login",
    register: "Register",
    forgotPassword: "Forgot Password?",
    welcome: "Welcome back",
    loginOrSignup: "登录或注册账户",
    createAccount: "Create Account",
    loginDesc: "Login to your account",
    signupDesc: "Sign up with email and password",
    noAccount: "Don't have an account? <a id=\"switchToSignup\">Register</a>",
    hasAccount: "Already have an account? <a id=\"switchToSignup\">Login</a>",
    emailPlaceholder: "Email",
    passwordPlaceholder: "Password",
    emailLabel: "Email",
    passwordLabel: "Password",
    chatPlaceholder: "Enter message… (Ctrl+Enter newline, Enter send)",
    globalChat: "Global Chat",
    allMembers: "# All Members",
    online: "Online",
    agreeTerms: "I have read and agree to the above terms of service",
    confirm: "Confirm",
    settings: "Settings",
    profile: "Profile",
    general: "General",
    account: "Account",
    about: "About",
    terms: "Terms of Service",
    noticeBeforeUse: "Notice Before Use",
    welcomeMiniChat: "Welcome to MiniChat",
    noticeDesc1: "Before creating an account, please read the full MiniChat Service Agreement. By registering, you acknowledge and agree to the following:",
    quickAgreementTitle: "Quick Agreement",
    quickAgreementNotice: "You must be at least 13 years old; do not send illegal, non-compliant, or malicious content; keep your account credentials secure; respect the legitimate rights of other users; and comply with applicable laws and regulations.",
    fullAgreementLinkTitle: "Full Service Agreement",
    viewFullAgreement: "View Full Service Agreement →",
    quickAgreement: "Quick Service Agreement",
    quickAgreementDesc: "View a simplified version of the Service Agreement",
    fullAgreement: "Full Service Agreement",
    fullAgreementDesc: "View the complete Service Agreement details",
    view: "View",
    avatar: "Avatar",
    uploadAvatar: "Click to upload new avatar",
    displayName: "Display Name",
    displayNameDesc: "Other members will see this name",
    save: "Save",
    theme: "Theme",
    themeMode: "Theme Mode",
    themeDesc: "Choose interface appearance mode",
    darkMode: "Dark Mode",
    lightMode: "Light Mode",
    systemMode: "Follow System",
    autoMode: "Auto",
    language: "Language",
    interfaceLanguage: "Interface Language",
    languageDesc: "Choose app interface language",
    chinese: "中文",
    accountInfo: "Account Info",
    accountEmail: "Email",
    emailDesc: "Your login email",
    resetPassword: "Reset Password",
    resetPasswordDesc: "Reset your account password",
    accountActions: "Account Actions",
    logout: "Logout",
    logoutDesc: "You will need to login again",
    logoutBtn: "Logout",
    deleteAccount: "Delete Account",
    deleteAccountDesc: "Permanently delete your account and all data",
    versionCheck: "Version Check",
    checkUpdate: "Check for Updates",
    checkUpdateDesc: "Check if a new version is available",
    checkUpdateBtn: "Check Updates",
    version: "Version",
    developer: "Developer",
    license: "License",
    githubRepo: "GitHub Repository",
    feedback: "Feedback",
    bilibili: "ningqi24's Bilibili",
    inputSettings: "Input Settings",
    inputAutoHide: "Input Display",
    inputAutoHideDesc: "Control input area display",
    inputAuto: "Auto",
    inputAlwaysShow: "Always Show",
    inputAlwaysHide: "Always Hide",
    notifications: "Notifications",
    desktopNotifications: "Desktop Notifications",
    desktopNotificationsDesc: "Show desktop notifications for new messages",
    soundEnabled: "Sound Enabled",
    soundEnabledDesc: "Play sound for new messages",
    mentionNotifications: "Mention Notifications",
    mentionNotificationsDesc: "Notify when mentioned",
    loading: "Loading…",
    searchPlaceholder: "Search messages…",
    quoteMessage: "Quote Message",
    quoteAuthor: "Author",
    quoteTime: "Time",
    quoteContent: "Quote content",
    cancel: "Cancel",
    ok: "OK",
    success: "Success",
    error: "Error",
    info: "Info",
    jumpToOriginal: "Jump to original",
    mention: "@Mention",
    viewProfile: "View Profile",
    mobileChat: "Chat",
    mobileMembers: "Members",
    mobileSettings: "Settings",
    newVersionAvailable: "New version available",
    currentVersion: "Current Version",
    newestVersion: "Latest Version",
    updateAvailable: "Update available",
    remindLater: "Remind me later",
    refreshNow: "Refresh now",
    selectingFile: "Selecting file...",
    selectFileHint: "Please select images or audio from the system dialog",
    today: "Today",
    yesterday: "Yesterday",
    upload: "Upload",
    nickname: "Nickname",
    credits: "Credits",
    creditThis: "This project",
    creditInspired: "Design inspiration",
    creditBased: "Built upon it",
    partners: "Partners",
    partnerFloxDesc: "The FloxChat verification-code login is provided by FloxChat; FloxChat also bridges the MiniChat group chat into its own client.",
    partnerAuthor: "Author · Shebiao",
    svcSupabase: "Database · Auth · Storage · Edge Functions",
    svcTurnstile: "Human verification",
    svcJsdelivr: "CDN: loads the Supabase SDK",
    svcEsmsh: "CDN: Edge Function dependencies",
    svcUiavatar: "Default avatar generation",
    svcGhpages: "Static site hosting",
    svcEmojihub: "Emoji data",
    svcTurbowarp: "FloxChat runtime",
    svcLucide: "Icons",
    alreadyLatest: "Already the latest version",
    restoredMessages: "Restored {count} messages.",
    sensitiveWordTip: "Message contains sensitive word (\"{word}\"), please modify and retry"
  }
};

function getCurrentLang() {
    var saved = localStorage.getItem('minichat_lang') || 'system';
    if (saved === 'system') {
        var navLang = navigator.language || navigator.userLanguage || 'zh';
        return navLang.startsWith('zh') ? 'zh' : 'en';
    }
    return saved;
}
function t(key) {
    var lang = getCurrentLang();
    return i18n[lang] && i18n[lang][key] ? i18n[lang][key] : key;
}
function loadLanguage() {
    var lang = getCurrentLang();
    document.querySelectorAll("[data-i18n]").forEach(function(el) {
        var k = el.getAttribute("data-i18n");
        if (k && i18n[lang] && i18n[lang][k]) el.textContent = i18n[lang][k];
    });
    document.querySelectorAll("[data-i18n-html]").forEach(function(el) {
        var k = el.getAttribute("data-i18n-html");
        if (k && i18n[lang] && i18n[lang][k]) el.innerHTML = i18n[lang][k];
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function(el) {
        var k = el.getAttribute("data-i18n-placeholder");
        if (k && i18n[lang] && i18n[lang][k]) el.setAttribute("placeholder", i18n[lang][k]);
    });
}
loadLanguage();

// ---- 登录页专属绑定（原来这些在聊天页的 setupGlobalEventListeners 里）----
// 注意：这几个元素变量原本声明在 app.js 的聊天区段（5576 行附近），
// 抽取登录代码时没有带过来，所以这里必须用 $safe() 自己取。
// 直接写裸变量名会在 if 判断时抛 ReferenceError（未声明变量），
// 那样整页脚本会挂掉 —— 登录功能直接不可用。
if (btnLogin) btnLogin.addEventListener('click', handleAuth);
var _authToggle = document.querySelector('.auth-toggle');
if (_authToggle) _authToggle.addEventListener('click', handleAuthToggleClick);
var _togglePwd = document.getElementById('togglePwd');
if (_togglePwd) _togglePwd.addEventListener('click', function() {
    if (!authPassword) return;
    var t2 = authPassword.getAttribute('type') === 'password' ? 'text' : 'password';
    authPassword.setAttribute('type', t2);
    this.classList.toggle("is-visible", t2 === "text");
    this.setAttribute("aria-pressed", t2 === "text" ? "true" : "false");
    this.setAttribute("aria-label", t2 === "text" ? "隐藏密码" : "显示密码");
});
var _switchToSignup = document.getElementById('switchToSignup');
if (_switchToSignup) _switchToSignup.addEventListener('click', function(e) {
    e.preventDefault();
    switchMode(isLoginMode ? 'signup' : 'login');
});
// 下面两个是「使用 FloxChat 登录」入口与「返回邮箱登录」，
// 原本绑定在 app.js 的 setupGlobalEventListeners 里（5591-5594 行，聊天区段），
// 抽取登录代码时没带过来 —— 结果就是点「使用 FloxChat 登录」完全没反应。
var _switchFlox = document.getElementById('switchFloxChat');
if (_switchFlox) _switchFlox.addEventListener('click', switchToFloxLogin);
var _floxBack = document.getElementById('floxBack');
if (_floxBack) _floxBack.addEventListener('click', switchBackFromFlox);
