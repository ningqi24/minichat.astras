// ===================== 版本号 =====================
// ⚠️ 改版本号必须【同时】改三处，否则两者不一致会让所有用户看到假的「有新版本」弹窗：
//      1. 这里 APP_VERSION
//      2. data/vision.json 的 version（checkForUpdate() 拿它和 APP_VERSION 比对）
//      3. sw.js 的 CACHE_NAME（否则老访客拿不到新的 index.html）
var APP_VERSION = '4.7.0';

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
    if (IS_LOGIN_PAGE) { location.replace('./index.html'); }
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
            console.log('[MiniChat/boot] 聊天页无本地登录记录 → 跳转 login.html');
            location.replace('./login.html');
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
            if (reason) console.warn('[MiniChat/boot] 会话恢复失败：' + reason + ' → 跳转 login.html');
            // 拆页后不再原地露登录遮罩，直接去登录页
            location.replace('./login.html');
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
var i18n = {
    zh: {
        login: '登录',
        register: '注册',
        email: '邮箱地址',
        password: '密码',
        confirmPassword: '确认密码',
        forgotPassword: '忘记密码？',
        or: '或',
        welcome: '欢迎回来',
        loginOrSignup: '登录或注册账户',
        createAccount: '创建账户',
        loginDesc: '登录你的账户',
        signupDesc: '使用邮箱和密码注册',
        noAccount: '还没有账户？<a id="switchToSignup">注册</a>',
        hasAccount: '已有账户？<a id="switchToSignup">登录</a>',
        emailPlaceholder: '电子邮箱',
        passwordPlaceholder: '密码',
        emailLabel: '电子邮箱',
        passwordLabel: '密码',
        newUser: '新用户？',
        chatPlaceholder: '输入消息…（Ctrl+Enter 换行，Enter 发送）',
        globalChat: '全局聊天',
        allMembers: '# 所有成员',
        online: '在线',
        offline: '离线',
        retract: '撤回',
        retracted: '已撤回',
        onlineCount: '{count} 人在线',
        onlineUsersTitle: '在线用户 ({count})',
        allMembersTitle: '所有成员 ({count})',
        allMembersTitleWithOnline: '所有成员 ({count} · {online} 在线)',
        noMembersFound: '暂无成员',
        atFirstResult: '已到达第一个结果',
        atLastResult: '已到达最后一个结果',
        agreeTerms: '我已阅读并同意上述服务协议',
        confirm: '确认',
        joinedAt: '注册时间',
        settings: '设置',
        profile: '个人资料',
        general: '通用设置',
        account: '账户',
        about: '关于',
        terms: '服务协议',
        noticeBeforeUse: '使用前须知',
        welcomeMiniChat: '欢迎使用 MiniChat',
        noticeDesc1: '在您注册账户前，请仔细阅读 MiniChat 的完整服务协议。注册即表示您已知悉并同意以下内容：',
        quickAgreementTitle: '简要协议',
        quickAgreementNotice: '您应年满 13 周岁；不发送违法、违规或恶意内容；妥善保管账户密码；尊重其他用户合法权益；遵守相关法律法规。',
        fullAgreementLinkTitle: '完整服务协议',
        viewFullAgreement: '查看完整服务协议 →',
        quickAgreement: '简易服务协议',
        quickAgreementDesc: '查看服务协议的简要版本',
        fullAgreement: '具体服务协议',
        fullAgreementDesc: '查看完整的服务协议详情',
        userAgreement: '用户协议',
        userAgreementDesc: '使用本服务需遵守的条款',
        privacyPolicy: '隐私政策',
        privacyPolicyDesc: '我们如何保护您的隐私',
        thirdPartySharing: '第三方信息共享清单',
        thirdPartySharingDesc: '与第三方共享的信息',
        dataCollection: '个人信息收集清单',
        dataCollectionDesc: '我们收集的个人信息',
        appPermissions: '应用权限',
        appPermissionsDesc: '应用所需的权限说明',
        userAgreementContent: '欢迎使用 MiniChat 服务。使用本服务即表示您同意遵守以下条款：',
        userAgreementItem1: '您必须年满13周岁才能使用本服务',
        userAgreementItem2: '您不得利用本服务发送违法、违规或恶意内容',
        userAgreementItem3: '您应对自己的账户安全负责',
        userAgreementItem4: '我们保留随时修改本协议的权利',
        privacyPolicyContent: '我们重视您的隐私保护，采取以下措施：',
        privacyPolicyItem1: '所有数据传输采用端到端加密',
        privacyPolicyItem2: '我们不会向第三方出售您的个人信息',
        privacyPolicyItem3: '您可以随时删除自己的账户和数据',
        privacyPolicyItem4: '定期进行安全审计和漏洞检测',
        thirdPartySharingContent: '本服务可能与以下第三方共享必要信息：',
        thirdPartySharingItem1: 'Supabase：用于数据存储和用户认证',
        thirdPartySharingItem2: '无其他第三方数据共享',
        dataCollectionContent: '我们仅收集必要的信息以提供服务：',
        dataCollectionItem1: '邮箱地址：用于账户注册和认证',
        dataCollectionItem2: '显示名称：用于在聊天中标识您',
        dataCollectionItem3: '头像：用于个性化展示',
        dataCollectionItem4: '消息内容：用于提供聊天功能',
        dataCollectionItem5: '登录时间和IP：用于安全审计',
        appPermissionsContent: '本应用所需的权限说明：',
        appPermissionsItem1: '网络权限：用于发送和接收消息',
        appPermissionsItem2: '存储权限：用于上传头像和文件',
        appPermissionsItem3: '通知权限：用于接收新消息通知',
        view: '查看',
        avatar: '头像',
        uploadAvatar: '点击上传新头像',
        displayName: '显示昵称',
        displayNameDesc: '其他成员将看到这个名字',
        save: '保存',
        theme: '主题',
        themeMode: '主题模式',
        themeDesc: '选择界面外观模式',
        darkMode: '深色模式',
        lightMode: '浅色模式',
        systemMode: '跟随系统',
        autoMode: '自动',
        language: '语言',
        interfaceLanguage: '界面语言',
        languageDesc: '选择应用界面语言',
        chinese: '中文',
        english: 'English',
        systemLang: '跟随系统',
        accountInfo: '账户信息',
        accountEmail: '邮箱',
        emailDesc: '您的登录邮箱',
        resetPassword: '重置密码',
        resetPasswordDesc: '重置您的账户密码',
        accountActions: '账户操作',
        accountActionsDesc: '退出登录或注销账户',
        moreActions: '更多操作',
        share: '分享',
        logout: '退出登录',
        logoutDesc: '退出后需重新登录',
        logoutBtn: '退出',
        logoutConfirm: '确定要退出登录吗？',
        deleteAccount: '注销账户',
        deleteAccountDesc: '永久删除您的账户和所有数据',
        versionCheck: '版本检测',
        checkUpdate: '手动检查更新',
        checkUpdateDesc: '检查是否有新版本可用',
        checkUpdateBtn: '检测更新',
        version: '版本',
        developer: '开发者',
        license: '许可证',
        githubRepo: 'GitHub 仓库',
        feedback: '反馈问题',
        bilibili: 'ningqi24的Bilibili账户',
        lock: '锁定',
        unlock: '解锁',
        inputSettings: '输入框设置',
        inputAutoHide: '输入框显示',
        inputAutoHideDesc: '控制输入框的显示方式',
        inputAuto: '自动',
        inputAlwaysShow: '始终显示',
        inputAlwaysHide: '始终隐藏',
        notifications: '通知设置',
        desktopNotifications: '桌面通知',
        desktopNotificationsDesc: '收到新消息时显示桌面通知',
        soundEnabled: '通知声音',
        soundEnabledDesc: '收到新消息时播放提示音',
        mentionNotifications: '@提醒',
        mentionNotificationsDesc: '被@时发送通知',
        deletedUser: '已注销用户',
        closeSettings: '关闭设置',
        send: '发送',
        attach: '添加附件',
        emoji: '表情',
        newMessage: '新消息',
        markAllRead: '标记全部已读',
        search: '搜索消息',
        loading: '加载中…',
        noMessages: '暂无消息，发送第一条吧',
        enterMessage: '输入消息开始聊天',
        areYouSure: '确定要继续吗？',
        deleteConfirm: '再次确认：您确定要注销账户吗？此操作不可撤销。',
        refreshConfirm: '确定要刷新界面吗？',
        loadMessagesFailed: '加载消息失败，请刷新重试',
        refresh: '刷新',
        chatPlaceholder: '输入消息…（Ctrl+Enter 换行，Enter 发送）',
        searchPlaceholder: '搜索消息…',
        noMessages: '暂无消息，发送第一条吧',
        notLoggedIn: '未登录',
        quoteMessage: '引用消息',
        quoteAuthor: '作者',
        quoteTime: '时间',
        quoteContent: '引用内容',
        cancel: '取消',
        confirm: '确定',
        ok: '确定',
        success: '成功',
        error: '错误',
        info: '提示',
        jumpToOriginal: '跳转到原文',
        mention: '@他',
        viewProfile: '查看资料',
        mobileChat: '聊天',
        mobileMembers: '成员',
        mobileOnline: '在线',
        mobileSettings: '设置',
        passwordResetSent: '密码重置邮件已发送，请检查您的邮箱。',
        passwordResetFailed: '发送邮件失败：',
        deleteFailed: '注销失败：',
        latestVersion: '当前已是最新版本',
        newVersionAvailable: '发现新版本',
        currentVersion: '当前版本',
        newestVersion: '最新版本',
        updateAvailable: '检测到新版本，建议立即刷新以获取最新功能和修复',
        remindLater: '稍后提醒',
        refreshNow: '立即刷新',
        selectingFile: '正在选择文件...',
        selectFileHint: '请从系统对话框中选择图片或音频',
        today: '今天',
        yesterday: '昨天',
        updateNow: '立即更新',
        cancel: '取消',
        yes: '是',
        no: '否',
        preview: '预览',
        upload: '上传',
        uploadStatus: '上传状态',
        nickname: '昵称',
        nicknameMessage: '昵称消息',
        showProfile: '查看资料',
        copyMessage: '复制消息',
        quoteMessage: '引用消息',
        jumpToMessage: '跳转到消息',
        recallMessage: '撤回消息',
        messageRecalled: '消息已撤回',
        messageDeleted: '消息已删除',
        cannotRecall: '无法撤回此消息',
        recallConfirm: '确定撤回？',
        recallFailed: '撤回失败',
        mention: '@提及',
        reply: '回复',
        thread: '话题',
        channel: '频道',
        notification: '通知',
        permission: '权限',
        blocked: '已屏蔽',
        muted: '已静音',
        unmuted: '取消静音',
        block: '屏蔽',
        unblock: '取消屏蔽',
        report: '举报',
        reportMessage: '举报消息',
        reportUser: '举报用户',
        reportReason: '举报原因',
        submitReport: '提交举报',
        reportSuccess: '举报已提交',
        reportFailed: '举报失败',
        messageTooLong: '消息过长',
        messageEmpty: '消息不能为空',
        imageTooLarge: '图片过大',
        fileTooLarge: '文件过大',
        unsupportedFile: '不支持的文件类型',
        uploadFailed: '上传失败',
        uploadSuccess: '上传成功',
        downloading: '下载中…',
        downloadFailed: '下载失败',
        downloadSuccess: '下载成功',
        connecting: '连接中…',
        disconnected: '已断开连接',
        reconnecting: '正在重新连接…',
        connected: '已连接',
        offline: '离线',
        away: '离开',
        busy: '忙碌',
        invisible: '隐身',
        status: '状态',
        changeStatus: '更改状态',
        clearHistory: '清除历史',
        clearHistoryConfirm: '确定要清除所有聊天历史吗？',
        clearHistorySuccess: '历史记录已清除',
        clearHistoryFailed: '清除失败',
        exportHistory: '导出历史',
        exportHistorySuccess: '历史记录已导出',
        exportHistoryFailed: '导出失败',
        importHistory: '导入历史',
        importHistorySuccess: '历史记录已导入',
        importHistoryFailed: '导入失败',
        dataMigrated: '数据已迁移',
        migrationFailed: '迁移失败',
        welcomeMessage: '欢迎加入 MiniChat！',
        joinMessage: '加入了聊天',
        leaveMessage: '离开了聊天',
        join: '加入',
        leave: '离开',
        createChannel: '创建频道',
        channelName: '频道名称',
        channelDescription: '频道描述',
        create: '创建',
        editChannel: '编辑频道',
        deleteChannel: '删除频道',
        channelDeleted: '频道已删除',
        channelCreated: '频道已创建',
        channelUpdated: '频道已更新',
        channelMembers: '频道成员',
        addMember: '添加成员',
        removeMember: '移除成员',
        memberAdded: '成员已添加',
        memberRemoved: '成员已移除',
        channelSettings: '频道设置',
        channelPermissions: '频道权限',
        readOnly: '只读',
        public: '公开',
        private: '私有',
        passwordProtected: '密码保护',
        channelPassword: '频道密码',
        setPassword: '设置密码',
        enterPassword: '输入密码',
        incorrectPassword: '密码错误',
        passwordRequired: '需要密码',
        twoFactorAuth: '双因素认证',
        enable2FA: '启用双因素认证',
        disable2FA: '禁用双因素认证',
        verifyCode: '验证代码',
        enterCode: '输入验证码',
        codeInvalid: '验证码无效',
        codeExpired: '验证码已过期',
        codeSent: '验证码已发送',
        verifyEmail: '验证邮箱',
        emailVerified: '邮箱已验证',
        verifyEmailSent: '验证邮件已发送',
        emailNotVerified: '邮箱未验证',
        upgradeAccount: '升级账户',
        downgradeAccount: '降级账户',
        premiumFeatures: '高级功能',
        subscription: '订阅',
        subscribed: '已订阅',
        notSubscribed: '未订阅',
        subscribeNow: '立即订阅',
        cancelSubscription: '取消订阅',
        paymentFailed: '支付失败',
        paymentSuccess: '支付成功',
        invoice: '发票',
        billingHistory: '账单历史',
        paymentMethod: '支付方式',
        addPaymentMethod: '添加支付方式',
        removePaymentMethod: '移除支付方式',
        paymentMethodAdded: '支付方式已添加',
        paymentMethodRemoved: '支付方式已移除',
        notifications: '通知',
        emailNotifications: '邮件通知',
        pushNotifications: '推送通知',
        desktopNotifications: '桌面通知',
        notificationSettings: '通知设置',
        mentionNotifications: '提及通知',
        replyNotifications: '回复通知',
        messageNotifications: '消息通知',
        muteNotifications: '静音通知',
        soundEnabled: '启用声音',
        soundDisabled: '禁用声音',
        soundSettings: '声音设置',
        themeSettings: '主题设置',
        appearance: '外观',
        accessibility: '无障碍',
        highContrast: '高对比度',
        reducedMotion: '减少动画',
        fontScale: '字体大小',
        zoom: '缩放',
        resetZoom: '重置缩放',
        keyboardShortcuts: '键盘快捷键',
        shortcuts: '快捷键',
        help: '帮助',
        documentation: '文档',
        faq: '常见问题',
        support: '支持',
        contactUs: '联系我们',
        privacyPolicy: '隐私政策',
        termsOfService: '服务条款',
        cookiePolicy: 'Cookie 政策',
        aboutMiniChat: '关于 MiniChat',
        changelog: '更新日志',
        releaseNotes: '发行说明',
        contributing: '贡献',
        donate: '捐赠',
        sponsors: '赞助商',
        credits: '致谢',
        creditThis: '本项目',
        creditInspired: '设计灵感来源',
        creditBased: '本项目基于其构建',
        partners: '合作',
        partnerFloxDesc: 'MiniChat 的 FloxChat 验证码登录能力由 FloxChat 提供；FloxChat 侧也通过桥接扩展接入了 MiniChat 群聊。',
        partnerAuthor: '作者 · 摄表',
        svcSupabase: '数据库 · 账号 · 文件存储 · 边缘函数',
        svcTurnstile: '人机验证',
        svcJsdelivr: 'CDN：加载 Supabase SDK',
        svcEsmsh: 'CDN：Edge Function 依赖',
        svcUiavatar: '默认头像生成',
        svcGhpages: '静态站点托管',
        svcEmojihub: 'Emoji 数据',
        svcTurbowarp: 'FloxChat 运行环境',
        svcLucide: '图标',
        licenseInfo: '许可证信息',
        sourceCode: '源代码',
        github: 'GitHub',
        twitter: 'Twitter',
        discord: 'Discord',
        telegram: 'Telegram',
        reddit: 'Reddit',
        youtube: 'YouTube',
        blog: '博客',
        newsletter: '订阅新闻',
        subscribeNewsletter: '订阅',
        unsubscribeNewsletter: '取消订阅',
        newsletterSubscribed: '已订阅新闻',
        newsletterUnsubscribed: '已取消订阅',
        searchResults: '搜索结果',
        noResults: '没有找到结果',
        searchMessages: '搜索消息',
        searchUsers: '搜索用户',
        searchChannels: '搜索频道',
        searchFiles: '搜索文件',
        advancedSearch: '高级搜索',
        filterByDate: '按日期筛选',
        filterByUser: '按用户筛选',
        filterByType: '按类型筛选',
        clearFilters: '清除筛选',
        loadMore: '加载更多',
        showAll: '显示全部',
        hide: '隐藏',
        show: '显示',
        expand: '展开',
        collapse: '折叠',
        pinnedMessages: '置顶消息',
        pinMessage: '置顶消息',
        unpinMessage: '取消置顶',
        messagePinned: '消息已置顶',
        messageUnpinned: '消息已取消置顶',
        starredMessages: '星标消息',
        starMessage: '星标消息',
        unstarMessage: '取消星标',
        messageStarred: '消息已星标',
        messageUnstarred: '消息已取消星标',
        scheduledMessages: '定时消息',
        scheduleMessage: '定时发送',
        messageScheduled: '消息已定时',
        messageSent: '消息已发送',
        messageDelivered: '消息已送达',
        messageRead: '消息已读',
        typing: '正在输入…',
        recording: '正在录音…',
        sendVoice: '发送语音',
        cancelVoice: '取消录音',
        voiceMessage: '语音消息',
        play: '播放',
        pause: '暂停',
        stop: '停止',
        volume: '音量',
        speed: '播放速度',
        download: '下载',
        uploadFile: '上传文件',
        selectFile: '选择文件',
        dropFiles: '拖放文件到此处',
        fileUploaded: '文件已上传',
        imagePreview: '图片预览',
        videoPreview: '视频预览',
        audioPreview: '音频预览',
        documentPreview: '文档预览',
        linkPreview: '链接预览',
        generateLinkPreview: '生成链接预览',
        linkPreviewFailed: '链接预览生成失败',
        embedVideo: '嵌入视频',
        embedAudio: '嵌入音频',
        embedImage: '嵌入图片',
        embedDocument: '嵌入文档',
        embedCode: '嵌入代码',
        embedLink: '嵌入链接',
        formatBold: '粗体',
        formatItalic: '斜体',
        formatStrikethrough: '删除线',
        formatCode: '代码',
        formatQuote: '引用',
        formatLink: '链接',
        formatList: '列表',
        formatOrderedList: '有序列表',
        formatTaskList: '任务列表',
        formatHeading: '标题',
        formatParagraph: '段落',
        formatAlignLeft: '左对齐',
        formatAlignCenter: '居中',
        formatAlignRight: '右对齐',
        formatAlignJustify: '两端对齐',
        formatIndent: '增加缩进',
        formatOutdent: '减少缩进',
        formatUndo: '撤销',
        formatRedo: '重做',
        formatClear: '清除格式',
        formatHelp: '格式帮助',
        markdown: 'Markdown',
        richText: '富文本',
        plainText: '纯文本',
        editMessage: '编辑消息',
        saveEdit: '保存编辑',
        cancelEdit: '取消编辑',
        messageEdited: '消息已编辑',
        editFailed: '编辑失败',
        deleteMessage: '删除消息',
        deleteConfirmMsg: '确定要删除此消息吗？',
        deleteForEveryone: '删除所有人的消息',
        deleteForMe: '仅删除我的消息',
        messageDeletedForEveryone: '消息已为所有人删除',
        messageDeletedForMe: '消息已为我删除',
        reactions: '表情反应',
        addReaction: '添加反应',
        removeReaction: '移除反应',
        reactionAdded: '反应已添加',
        reactionRemoved: '反应已移除',
        polls: '投票',
        createPoll: '创建投票',
        pollQuestion: '投票问题',
        pollOptions: '投票选项',
        addOption: '添加选项',
        removeOption: '移除选项',
        pollDuration: '投票时长',
        pollMultiple: '允许多选',
        pollAnonymous: '匿名投票',
        pollCreated: '投票已创建',
        vote: '投票',
        voteSuccess: '投票成功',
        voteFailed: '投票失败',
        pollEnded: '投票已结束',
        pollResults: '投票结果',
        pollWinner: '获胜者',
        threads: '话题',
        createThread: '创建话题',
        threadCreated: '话题已创建',
        threadReply: '回复话题',
        threadReplySuccess: '回复成功',
        threadReplyFailed: '回复失败',
        threadDeleted: '话题已删除',
        threadLocked: '话题已锁定',
        threadUnlocked: '话题已解锁',
        threadPinned: '话题已置顶',
        threadUnpinned: '话题已取消置顶',
        threadArchived: '话题已归档',
        threadUnarchived: '话题已取消归档',
        threadMuted: '话题已静音',
        threadUnmuted: '话题已取消静音',
        viewThread: '查看话题',
        closeThread: '关闭话题',
        leaveThread: '离开话题',
        followThread: '关注话题',
        unfollowThread: '取消关注',
        threadNotifications: '话题通知',
        pinnedThreads: '置顶话题',
        archivedThreads: '归档话题',
        mutedThreads: '静音话题',
        searchThreads: '搜索话题',
        threadStats: '话题统计',
        threadMessages: '话题消息',
        threadParticipants: '话题参与者',
        threadActivity: '话题活动',
        threadCreatedBy: '话题创建者',
        threadCreatedAt: '创建时间',
        threadLastReply: '最后回复',
        threadTags: '话题标签',
        addTag: '添加标签',
        removeTag: '移除标签',
        tagAdded: '标签已添加',
        tagRemoved: '标签已移除',
        tags: '标签',
        searchTags: '搜索标签',
        trendingTags: '热门标签',
        subscribedTags: '订阅标签',
        subscribeTag: '订阅标签',
        unsubscribeTag: '取消订阅',
        tagNotifications: '标签通知',
        mentions: '提及',
        searchMentions: '搜索提及',
        mentionedMessages: '被提及的消息',
        mentionedBy: '被提及者',
        mentionSettings: '提及设置',
        highlightMentions: '高亮提及',
        notifyMentions: '通知提及',
        replyMentions: '回复提及',
        ignoreMentions: '忽略提及',
        userProfile: '用户资料',
        viewProfile: '查看资料',
        editProfile: '编辑资料',
        profileUpdated: '资料已更新',
        profileUpdateFailed: '资料更新失败',
        userStats: '用户统计',
        messagesCount: '消息数',
        joinedAt: '加入时间',
        lastActive: '最后活跃',
        roles: '角色',
        roleAdmin: '管理员',
        roleModerator: '版主',
        roleUser: '普通用户',
        roleGuest: '访客',
        permissions: '权限',
        grantPermission: '授予权限',
        revokePermission: '撤销权限',
        permissionGranted: '权限已授予',
        permissionRevoked: '权限已撤销',
        moderation: '审核',
        reportQueue: '举报队列',
        pendingReports: '待处理举报',
        resolvedReports: '已解决举报',
        resolveReport: '解决举报',
        reportResolved: '举报已解决',
        banUser: '封禁用户',
        unbanUser: '解封用户',
        userBanned: '用户已封禁',
        userUnbanned: '用户已解封',
        muteUser: '禁言用户',
        unmuteUser: '取消禁言',
        userMuted: '用户已禁言',
        userUnmuted: '用户已取消禁言',
        warnUser: '警告用户',
        userWarned: '用户已警告',
        deleteUserMessages: '删除用户消息',
        messagesDeleted: '消息已删除',
        purgeUserMessages: '清除用户消息',
        messagesPurged: '消息已清除',
        logs: '日志',
        viewLogs: '查看日志',
        downloadLogs: '下载日志',
        clearLogs: '清除日志',
        logsCleared: '日志已清除',
        systemLogs: '系统日志',
        userLogs: '用户日志',
        adminLogs: '管理员日志',
        auditLogs: '审计日志',
        serverStatus: '服务器状态',
        onlineUsers: '在线用户',
        totalUsers: '总用户数',
        activeUsers: '活跃用户',
        serverLoad: '服务器负载',
        uptime: '运行时间',
        versionInfo: '版本信息',
        updateAvailable: '有更新可用',
        updateNowBtn: '立即更新',
        updateLater: '稍后更新',
        updating: '更新中…',
        updateComplete: '更新完成',
        updateFailed: '更新失败',
        restartRequired: '需要重启',
        restartNow: '立即重启',
        restartLater: '稍后重启',
        maintenance: '维护中',
        scheduledMaintenance: '计划维护',
        maintenanceStart: '维护开始时间',
        maintenanceEnd: '维护结束时间',
        maintenanceMessage: '维护期间服务可能暂时不可用',
        backup: '备份',
        createBackup: '创建备份',
        backupCreated: '备份已创建',
        backupFailed: '备份失败',
        restoreBackup: '恢复备份',
        backupRestored: '备份已恢复',
        restoreFailed: '恢复失败',
        backupSettings: '备份设置',
        autoBackup: '自动备份',
        backupFrequency: '备份频率',
        backupRetention: '备份保留时间',
        deleteBackup: '删除备份',
        backupDeleted: '备份已删除',
        importExport: '导入/导出',
        importData: '导入数据',
        exportData: '导出数据',
        dataImported: '数据已导入',
        dataExported: '数据已导出',
        importFailed: '导入失败',
        exportFailed: '导出失败',
        database: '数据库',
        databaseStatus: '数据库状态',
        databaseSize: '数据库大小',
        optimizeDatabase: '优化数据库',
        databaseOptimized: '数据库已优化',
        optimizeFailed: '优化失败',
        cache: '缓存',
        clearCache: '清除缓存',
        cacheCleared: '缓存已清除',
        cacheStats: '缓存统计',
        memoryUsage: '内存使用',
        cpuUsage: 'CPU使用',
        diskUsage: '磁盘使用',
        networkUsage: '网络使用',
        apiStats: 'API统计',
        requests: '请求数',
        errors: '错误数',
        latency: '延迟',
        uptimePercentage: '正常运行时间百分比',
        performance: '性能',
        performanceMode: '性能模式',
        enablePerformanceMode: '启用性能模式',
        disablePerformanceMode: '禁用性能模式',
        performanceOptimizations: '性能优化',
        lazyLoading: '懒加载',
        enableLazyLoading: '启用懒加载',
        disableLazyLoading: '禁用懒加载',
        imageCompression: '图片压缩',
        enableImageCompression: '启用图片压缩',
        disableImageCompression: '禁用图片压缩',
        webSocket: 'WebSocket',
        reconnectInterval: '重连间隔',
        maxReconnectAttempts: '最大重连次数',
        connectionTimeout: '连接超时',
        security: '安全',
        twoFactorAuthSettings: '双因素认证设置',
        enableTwoFactorAuth: '启用双因素认证',
        disableTwoFactorAuth: '禁用双因素认证',
        recoveryCodes: '恢复代码',
        generateRecoveryCodes: '生成恢复代码',
        recoveryCodesGenerated: '恢复代码已生成',
        verifyRecoveryCode: '验证恢复代码',
        recoveryCodeVerified: '恢复代码已验证',
        sessions: '会话',
        activeSessions: '活跃会话',
        endSession: '结束会话',
        sessionEnded: '会话已结束',
        endAllSessions: '结束所有会话',
        allSessionsEnded: '所有会话已结束',
        trustedDevices: '可信设备',
        addTrustedDevice: '添加可信设备',
        removeTrustedDevice: '移除可信设备',
        deviceAdded: '设备已添加',
        deviceRemoved: '设备已移除',
        loginHistory: '登录历史',
        recentLogins: '最近登录',
        failedLogins: '失败登录',
        suspiciousActivity: '可疑活动',
        securityAlerts: '安全警报',
        alertSettings: '警报设置',
        alertEmail: '邮件警报',
        alertPush: '推送警报',
        alertBrowser: '浏览器警报',
        alertSMS: '短信警报',
        privacy: '隐私',
        privacySettings: '隐私设置',
        onlineStatus: '在线状态',
        showOnlineStatus: '显示在线状态',
        hideOnlineStatus: '隐藏在线状态',
        profileVisibility: '资料可见性',
        publicProfile: '公开资料',
        privateProfile: '私有资料',
        friendsOnlyProfile: '仅好友可见',
        messageReadReceipts: '已读回执',
        enableReadReceipts: '启用已读回执',
        disableReadReceipts: '禁用已读回执',
        typingIndicator: '正在输入指示器',
        enableTypingIndicator: '启用正在输入指示器',
        disableTypingIndicator: '禁用正在输入指示器',
        voiceRecordingIndicator: '录音指示器',
        enableVoiceRecordingIndicator: '启用录音指示器',
        disableVoiceRecordingIndicator: '禁用录音指示器',
        dataCollection: '数据收集',
        enableDataCollection: '启用数据收集',
        disableDataCollection: '禁用数据收集',
        analytics: '分析',
        enableAnalytics: '启用分析',
        disableAnalytics: '禁用分析',
        cookies: 'Cookie',
        cookieSettings: 'Cookie设置',
        essentialCookies: '必要Cookie',
        functionalCookies: '功能Cookie',
        analyticsCookies: '分析Cookie',
        advertisingCookies: '广告Cookie',
        acceptAllCookies: '接受所有Cookie',
        rejectAllCookies: '拒绝所有Cookie',
        saveCookiePreferences: '保存Cookie偏好',
        cookiePreferencesSaved: 'Cookie偏好已保存',
        consent: '同意',
        consentRequired: '需要同意',
        consentGiven: '已同意',
        consentRevoked: '已撤销同意',
        termsAndConditions: '条款和条件',
        privacyPolicyLink: '隐私政策',
        termsOfServiceLink: '服务条款',
        acceptTerms: '接受条款',
        rejectTerms: '拒绝条款',
        termsAccepted: '条款已接受',
        termsRejected: '条款已拒绝',
        welcomeTour: '欢迎向导',
        startTour: '开始向导',
        skipTour: '跳过向导',
        nextStep: '下一步',
        prevStep: '上一步',
        finishTour: '完成向导',
        tourCompleted: '向导已完成',
        tourSkipped: '向导已跳过',
        helpCenter: '帮助中心',
        gettingStarted: '入门指南',
        advancedFeatures: '高级功能',
        troubleshooting: '故障排除',
        commonIssues: '常见问题',
        contactSupport: '联系支持',
        submitTicket: '提交工单',
        ticketSubmitted: '工单已提交',
        ticketStatus: '工单状态',
        ticketResolved: '工单已解决',
        knowledgeBase: '知识库',
        articles: '文章',
        categories: '分类',
        searchKnowledgeBase: '搜索知识库',
        articleViewed: '文章已查看',
        articleHelpful: '文章有帮助',
        articleNotHelpful: '文章没有帮助',
        feedbackForm: '反馈表单',
        submitFeedback: '提交反馈',
        feedbackSubmitted: '反馈已提交',
        feedbackThanks: '感谢您的反馈',
        bugReport: 'Bug报告',
        featureRequest: '功能请求',
        improvementSuggestion: '改进建议',
        otherFeedback: '其他反馈',
        feedbackType: '反馈类型',
        feedbackTitle: '反馈标题',
        feedbackDescription: '反馈描述',
        feedbackAttachments: '反馈附件',
        feedbackPriority: '反馈优先级',
        priorityLow: '低',
        priorityMedium: '中',
        priorityHigh: '高',
        priorityUrgent: '紧急',
        news: '新闻',
        latestNews: '最新新闻',
        archivedNews: '归档新闻',
        newsCategory: '新闻分类',
        newsTag: '新闻标签',
        newsSearch: '搜索新闻',
        readNews: '阅读新闻',
        newsRead: '新闻已读',
        newsUnread: '新闻未读',
        newsNotification: '新闻通知',
        enableNewsNotification: '启用新闻通知',
        disableNewsNotification: '禁用新闻通知',
        announcements: '公告',
        latestAnnouncements: '最新公告',
        archivedAnnouncements: '归档公告',
        announcementCategory: '公告分类',
        announcementTag: '公告标签',
        announcementSearch: '搜索公告',
        readAnnouncement: '阅读公告',
        announcementRead: '公告已读',
        announcementUnread: '公告未读',
        announcementNotification: '公告通知',
        enableAnnouncementNotification: '启用公告通知',
        disableAnnouncementNotification: '禁用公告通知',
        changelogView: '更新日志',
        latestChangelog: '最新更新',
        archivedChangelog: '历史更新',
        changelogCategory: '更新分类',
        changelogTag: '更新标签',
        changelogSearch: '搜索更新',
        readChangelog: '阅读更新',
        changelogRead: '更新已读',
        changelogUnread: '更新未读',
        changelogNotification: '更新通知',
        enableChangelogNotification: '启用更新通知',
        disableChangelogNotification: '禁用更新通知',
        noOtherOnline: '暂无其他在线用户',
        noUserFound: '没有找到用户',
        onlineSection: '在线',
        offlineSection: '离线',
        noEmojiData: '暂无表情数据',
        noEmoji: '暂无表情',
        nicknameEmpty: '昵称不能为空',
        nicknameTooLong: '昵称不能超过20个字符',
        saving: '保存中…',
        nicknameUsed: '昵称已被占用',
        nicknameSaved: '昵称已更新',
        searching: '正在查找...',
        searchingInDb: '正在数据库中查找…',
        quoteLabel: '引用',
        alreadyLatest: '当前已是最新版本',
        copied: '已复制',
        locatedOriginal: '已定位到原文',
        messageDeleted2: '原消息已被删除',
        foundAndLoaded: '已找到并加载原文',
        networkError: '网络错误',
        originalNotFound: '未找到原始消息',
        saveFailed: '保存失败',
        pleaseSelectImage: '请选择图片',
        imageTooLargeMsg: '图片不能超过5MB',
        uploading: '上传中…',
        avatarUpdated: '头像已更新',
        uploadFailedMsg: '上传失败',
        downloadOriginal: '下载原图',
        downloadingBtn: '下载中…',
        downloaded: '已下载',
        downloadFailed: '失败',
        close: '关闭',
        pleaseLogin: '请先登录',
        restoredMessages: '已恢复 {count} 条消息。',
        cleanedMessages: '已清理 {count} 条消息。',
        sensitiveWordTip: '消息包含敏感词（"{word}"），请修改后重试',
        sendTooFast: '发送太快',
        sendFailed: '发送失败: ',
        unknownError: '未知错误'
    },
    en: {
        login: 'Login',
        register: 'Register',
        email: 'Email',
        password: 'Password',
        confirmPassword: 'Confirm Password',
        forgotPassword: 'Forgot Password?',
        or: 'or',
        welcome: 'Welcome back',
        createAccount: 'Create Account',
        loginDesc: 'Login to your account',
        signupDesc: 'Sign up with email and password',
        noAccount: 'Don\'t have an account? <a id="switchToSignup">Register</a>',
        hasAccount: 'Already have an account? <a id="switchToSignup">Login</a>',
        emailPlaceholder: 'Email',
        passwordPlaceholder: 'Password',
        emailLabel: 'Email',
        passwordLabel: 'Password',
        newUser: 'New user?',
        chatPlaceholder: 'Type a message… (Ctrl+Enter newline, Enter send)',
        globalChat: 'Global Chat',
        allMembers: '# All Members',
        online: 'Online',
        offline: 'Offline',
        retract: 'Retract',
        retracted: 'Retracted',
        onlineCount: '{count} online',
        onlineUsersTitle: 'Online Users ({count})',
        allMembersTitle: 'All Members ({count})',
        allMembersTitleWithOnline: 'All Members ({count} · {online} online)',
        noMembersFound: 'No members found',
        atFirstResult: 'At first result',
        atLastResult: 'At last result',
        agreeTerms: 'I have read and agree to the above terms of service',
        confirm: 'Confirm',
        joinedAt: 'Joined At',
        settings: 'Settings',
        profile: 'Profile',
        general: 'General',
        account: 'Account',
        about: 'About',
        terms: 'Terms of Service',
        noticeBeforeUse: 'Notice Before Use',
        welcomeMiniChat: 'Welcome to MiniChat',
        noticeDesc1: 'Before creating an account, please read the full MiniChat Service Agreement. By registering, you acknowledge and agree to the following:',
        quickAgreementTitle: 'Quick Agreement',
        quickAgreementNotice: 'You must be at least 13 years old; do not send illegal, non-compliant, or malicious content; keep your account credentials secure; respect the legitimate rights of other users; and comply with applicable laws and regulations.',
        fullAgreementLinkTitle: 'Full Service Agreement',
        viewFullAgreement: 'View Full Service Agreement →',
        quickAgreement: 'Quick Service Agreement',
        quickAgreementDesc: 'View a simplified version of the Service Agreement',
        fullAgreement: 'Full Service Agreement',
        fullAgreementDesc: 'View the complete Service Agreement details',
        userAgreement: 'User Agreement',
        userAgreementDesc: 'Terms you must agree to use this service',
        privacyPolicy: 'Privacy Policy',
        privacyPolicyDesc: 'How we protect your privacy',
        thirdPartySharing: 'Third-Party Information Sharing',
        thirdPartySharingDesc: 'Information shared with third parties',
        dataCollection: 'Personal Information Collection',
        dataCollectionDesc: 'Personal information we collect',
        appPermissions: 'App Permissions',
        appPermissionsDesc: 'Permissions required by the app',
        userAgreementContent: 'Welcome to use MiniChat service. By using this service, you agree to the following terms:',
        userAgreementItem1: 'You must be at least 13 years old to use this service',
        userAgreementItem2: 'You must not send illegal, violating or malicious content through this service',
        userAgreementItem3: 'You are responsible for your account security',
        userAgreementItem4: 'We reserve the right to modify this agreement at any time',
        privacyPolicyContent: 'We value your privacy protection and take the following measures:',
        privacyPolicyItem1: 'All data transmission uses end-to-end encryption',
        privacyPolicyItem2: 'We will not sell your personal information to third parties',
        privacyPolicyItem3: 'You can delete your account and data at any time',
        privacyPolicyItem4: 'Regular security audits and vulnerability detection',
        thirdPartySharingContent: 'This service may share necessary information with the following third parties:',
        thirdPartySharingItem1: 'Supabase: For data storage and user authentication',
        thirdPartySharingItem2: 'No other third-party data sharing',
        dataCollectionContent: 'We only collect necessary information to provide services:',
        dataCollectionItem1: 'Email address: For account registration and authentication',
        dataCollectionItem2: 'Display name: For identification in chats',
        dataCollectionItem3: 'Avatar: For personalized display',
        dataCollectionItem4: 'Message content: For providing chat functionality',
        dataCollectionItem5: 'Login time and IP: For security auditing',
        appPermissionsContent: 'Permissions required by this application:',
        appPermissionsItem1: 'Network permission: For sending and receiving messages',
        appPermissionsItem2: 'Storage permission: For uploading avatars and files',
        appPermissionsItem3: 'Notification permission: For receiving new message notifications',
        view: 'View',
        avatar: 'Avatar',
        uploadAvatar: 'Click to upload new avatar',
        displayName: 'Display Name',
        displayNameDesc: 'Other members will see this name',
        save: 'Save',
        theme: 'Theme',
        themeMode: 'Theme Mode',
        themeDesc: 'Choose interface appearance mode',
        darkMode: 'Dark Mode',
        lightMode: 'Light Mode',
        systemMode: 'Follow System',
        autoMode: 'Auto',
        language: 'Language',
        interfaceLanguage: 'Interface Language',
        languageDesc: 'Choose app interface language',
        chinese: '中文',
        english: 'English',
        systemLang: 'Follow System',
        accountInfo: 'Account Info',
        accountEmail: 'Email',
        emailDesc: 'Your login email',
        resetPassword: 'Reset Password',
        resetPasswordDesc: 'Reset your account password',
        accountActions: 'Account Actions',
        accountActionsDesc: 'Logout or delete account',
        moreActions: 'More Actions',
        share: 'Share',
        logout: 'Logout',
        logoutDesc: 'You will need to login again',
        logoutBtn: 'Logout',
        logoutConfirm: 'Are you sure you want to logout?',
        deleteAccount: 'Delete Account',
        deleteAccountDesc: 'Permanently delete your account and all data',
        versionCheck: 'Version Check',
        checkUpdate: 'Check for Updates',
        checkUpdateDesc: 'Check if a new version is available',
        checkUpdateBtn: 'Check Updates',
        version: 'Version',
        developer: 'Developer',
        license: 'License',
        githubRepo: 'GitHub Repository',
        feedback: 'Feedback',
        bilibili: 'ningqi24\'s Bilibili',
        lock: 'Lock',
        unlock: 'Unlock',
        inputSettings: 'Input Settings',
        inputAutoHide: 'Input Display',
        inputAutoHideDesc: 'Control input area display',
        inputAuto: 'Auto',
        inputAlwaysShow: 'Always Show',
        inputAlwaysHide: 'Always Hide',
        notifications: 'Notifications',
        desktopNotifications: 'Desktop Notifications',
        desktopNotificationsDesc: 'Show desktop notifications for new messages',
        soundEnabled: 'Notification Sound',
        soundEnabledDesc: 'Play sound for new messages',
        mentionNotifications: '@ Mentions',
        mentionNotificationsDesc: 'Notify when mentioned',
        deletedUser: 'Deleted User',
        closeSettings: 'Close Settings',
        send: 'Send',
        attach: 'Attach',
        emoji: 'Emoji',
        newMessage: 'New Message',
        markAllRead: 'Mark All Read',
        search: 'Search',
        loading: 'Loading…',
        noMessages: 'No messages, send the first one',
        enterMessage: 'Enter a message to start chatting',
        loadMessagesFailed: 'Failed to load messages, please refresh and try again',
        refresh: 'Refresh',
        chatPlaceholder: 'Enter message… (Ctrl+Enter newline, Enter send)',
        searchPlaceholder: 'Search messages…',
        notLoggedIn: 'Not logged in',
        quoteMessage: 'Quote Message',
        quoteAuthor: 'Author',
        quoteTime: 'Time',
        quoteContent: 'Quote content',
        jumpToOriginal: 'Jump to original',
        mention: '@Mention',
        viewProfile: 'View Profile',
        mobileChat: 'Chat',
        mobileMembers: 'Members',
        mobileOnline: 'Online',
        mobileSettings: 'Settings',
        areYouSure: 'Are you sure?',
        deleteConfirm: 'Confirm again: Are you sure you want to delete your account? This action cannot be undone.',
        refreshConfirm: 'Are you sure you want to refresh?',
        passwordResetSent: 'Password reset email has been sent. Please check your email.',
        passwordResetFailed: 'Failed to send email: ',
        deleteFailed: 'Failed to delete account: ',
        latestVersion: 'You are on the latest version',
        newVersionAvailable: 'New version available',
        currentVersion: 'Current Version',
        newestVersion: 'Latest Version',
        updateAvailable: 'New version detected, please refresh to get the latest features and fixes',
        remindLater: 'Remind me later',
        refreshNow: 'Refresh now',
        selectingFile: 'Selecting file...',
        selectFileHint: 'Please select images or audio from the system dialog',
        today: 'Today',
        yesterday: 'Yesterday',
        updateNow: 'Update Now',
        cancel: 'Cancel',
        confirm: 'Confirm',
        ok: 'OK',
        success: 'Success',
        error: 'Error',
        info: 'Info',
        yes: 'Yes',
        no: 'No',
        preview: 'Preview',
        upload: 'Upload',
        uploadStatus: 'Upload Status',
        nickname: 'Nickname',
        nicknameMessage: 'Nickname Message',
        showProfile: 'View Profile',
        copyMessage: 'Copy Message',
        quoteMessage: 'Quote Message',
        jumpToMessage: 'Jump to Message',
        recallMessage: 'Recall Message',
        messageRecalled: 'Message recalled',
        messageDeleted: 'Message deleted',
        cannotRecall: 'Cannot recall this message',
        recallConfirm: 'Confirm recall?',
        recallFailed: 'Recall failed',
        mention: '@Mention',
        reply: 'Reply',
        thread: 'Thread',
        channel: 'Channel',
        notification: 'Notification',
        permission: 'Permission',
        blocked: 'Blocked',
        muted: 'Muted',
        unmuted: 'Unmuted',
        block: 'Block',
        unblock: 'Unblock',
        report: 'Report',
        reportMessage: 'Report Message',
        reportUser: 'Report User',
        reportReason: 'Report Reason',
        submitReport: 'Submit Report',
        reportSuccess: 'Report submitted',
        reportFailed: 'Report failed',
        messageTooLong: 'Message too long',
        messageEmpty: 'Message cannot be empty',
        imageTooLarge: 'Image too large',
        fileTooLarge: 'File too large',
        unsupportedFile: 'Unsupported file type',
        uploadFailed: 'Upload failed',
        uploadSuccess: 'Upload successful',
        downloading: 'Downloading…',
        downloadFailed: 'Download failed',
        downloadSuccess: 'Download successful',
        connecting: 'Connecting…',
        disconnected: 'Disconnected',
        reconnecting: 'Reconnecting…',
        connected: 'Connected',
        offline: 'Offline',
        away: 'Away',
        busy: 'Busy',
        invisible: 'Invisible',
        status: 'Status',
        changeStatus: 'Change Status',
        clearHistory: 'Clear History',
        clearHistoryConfirm: 'Are you sure you want to clear all chat history?',
        clearHistorySuccess: 'History cleared',
        clearHistoryFailed: 'Failed to clear',
        exportHistory: 'Export History',
        exportHistorySuccess: 'History exported',
        exportHistoryFailed: 'Failed to export',
        importHistory: 'Import History',
        importHistorySuccess: 'History imported',
        importHistoryFailed: 'Failed to import',
        dataMigrated: 'Data migrated',
        migrationFailed: 'Migration failed',
        welcomeMessage: 'Welcome to MiniChat!',
        joinMessage: 'Joined the chat',
        leaveMessage: 'Left the chat',
        join: 'Join',
        leave: 'Leave',
        createChannel: 'Create Channel',
        channelName: 'Channel Name',
        channelDescription: 'Channel Description',
        create: 'Create',
        editChannel: 'Edit Channel',
        deleteChannel: 'Delete Channel',
        channelDeleted: 'Channel deleted',
        channelCreated: 'Channel created',
        channelUpdated: 'Channel updated',
        channelMembers: 'Channel Members',
        addMember: 'Add Member',
        removeMember: 'Remove Member',
        memberAdded: 'Member added',
        memberRemoved: 'Member removed',
        channelSettings: 'Channel Settings',
        channelPermissions: 'Channel Permissions',
        readOnly: 'Read Only',
        public: 'Public',
        private: 'Private',
        passwordProtected: 'Password Protected',
        channelPassword: 'Channel Password',
        setPassword: 'Set Password',
        enterPassword: 'Enter Password',
        incorrectPassword: 'Incorrect password',
        passwordRequired: 'Password required',
        twoFactorAuth: 'Two-Factor Authentication',
        enable2FA: 'Enable 2FA',
        disable2FA: 'Disable 2FA',
        verifyCode: 'Verify Code',
        enterCode: 'Enter Verification Code',
        codeInvalid: 'Invalid code',
        codeExpired: 'Code expired',
        codeSent: 'Code sent',
        verifyEmail: 'Verify Email',
        emailVerified: 'Email verified',
        verifyEmailSent: 'Verification email sent',
        emailNotVerified: 'Email not verified',
        upgradeAccount: 'Upgrade Account',
        downgradeAccount: 'Downgrade Account',
        premiumFeatures: 'Premium Features',
        subscription: 'Subscription',
        subscribed: 'Subscribed',
        notSubscribed: 'Not Subscribed',
        subscribeNow: 'Subscribe Now',
        cancelSubscription: 'Cancel Subscription',
        paymentFailed: 'Payment failed',
        paymentSuccess: 'Payment successful',
        invoice: 'Invoice',
        billingHistory: 'Billing History',
        paymentMethod: 'Payment Method',
        addPaymentMethod: 'Add Payment Method',
        removePaymentMethod: 'Remove Payment Method',
        paymentMethodAdded: 'Payment method added',
        paymentMethodRemoved: 'Payment method removed',
        notifications: 'Notifications',
        emailNotifications: 'Email Notifications',
        pushNotifications: 'Push Notifications',
        desktopNotifications: 'Desktop Notifications',
        notificationSettings: 'Notification Settings',
        mentionNotifications: 'Mention Notifications',
        replyNotifications: 'Reply Notifications',
        messageNotifications: 'Message Notifications',
        muteNotifications: 'Mute Notifications',
        soundEnabled: 'Sound Enabled',
        soundDisabled: 'Sound Disabled',
        soundSettings: 'Sound Settings',
        themeSettings: 'Theme Settings',
        appearance: 'Appearance',
        accessibility: 'Accessibility',
        highContrast: 'High Contrast',
        reducedMotion: 'Reduced Motion',
        fontScale: 'Font Scale',
        zoom: 'Zoom',
        resetZoom: 'Reset Zoom',
        keyboardShortcuts: 'Keyboard Shortcuts',
        shortcuts: 'Shortcuts',
        help: 'Help',
        documentation: 'Documentation',
        faq: 'FAQ',
        support: 'Support',
        contactUs: 'Contact Us',
        privacyPolicy: 'Privacy Policy',
        termsOfService: 'Terms of Service',
        cookiePolicy: 'Cookie Policy',
        aboutMiniChat: 'About MiniChat',
        changelog: 'Changelog',
        releaseNotes: 'Release Notes',
        contributing: 'Contributing',
        donate: 'Donate',
        sponsors: 'Sponsors',
        credits: 'Credits',
        creditThis: 'This project',
        creditInspired: 'Design inspiration',
        creditBased: 'Built upon it',
        partners: 'Partners',
        partnerFloxDesc: 'The FloxChat verification-code login is provided by FloxChat; FloxChat also bridges the MiniChat group chat into its own client.',
        partnerAuthor: 'Author · Shebiao',
        svcSupabase: 'Database · Auth · Storage · Edge Functions',
        svcTurnstile: 'Human verification',
        svcJsdelivr: 'CDN: loads the Supabase SDK',
        svcEsmsh: 'CDN: Edge Function dependencies',
        svcUiavatar: 'Default avatar generation',
        svcGhpages: 'Static site hosting',
        svcEmojihub: 'Emoji data',
        svcTurbowarp: 'FloxChat runtime',
        svcLucide: 'Icons',
        licenseInfo: 'License Information',
        sourceCode: 'Source Code',
        github: 'GitHub',
        twitter: 'Twitter',
        discord: 'Discord',
        telegram: 'Telegram',
        reddit: 'Reddit',
        youtube: 'YouTube',
        blog: 'Blog',
        newsletter: 'Newsletter',
        subscribeNewsletter: 'Subscribe',
        unsubscribeNewsletter: 'Unsubscribe',
        newsletterSubscribed: 'Subscribed to newsletter',
        newsletterUnsubscribed: 'Unsubscribed from newsletter',
        searchResults: 'Search Results',
        noResults: 'No results found',
        searchMessages: 'Search Messages',
        searchUsers: 'Search Users',
        searchChannels: 'Search Channels',
        searchFiles: 'Search Files',
        advancedSearch: 'Advanced Search',
        filterByDate: 'Filter by Date',
        filterByUser: 'Filter by User',
        filterByType: 'Filter by Type',
        clearFilters: 'Clear Filters',
        loadMore: 'Load More',
        showAll: 'Show All',
        hide: 'Hide',
        show: 'Show',
        expand: 'Expand',
        collapse: 'Collapse',
        pinnedMessages: 'Pinned Messages',
        pinMessage: 'Pin Message',
        unpinMessage: 'Unpin Message',
        messagePinned: 'Message pinned',
        messageUnpinned: 'Message unpinned',
        starredMessages: 'Starred Messages',
        starMessage: 'Star Message',
        unstarMessage: 'Unstar Message',
        messageStarred: 'Message starred',
        messageUnstarred: 'Message unstarred',
        scheduledMessages: 'Scheduled Messages',
        scheduleMessage: 'Schedule Message',
        messageScheduled: 'Message scheduled',
        messageSent: 'Message sent',
        messageDelivered: 'Message delivered',
        messageRead: 'Message read',
        typing: 'Typing…',
        recording: 'Recording…',
        sendVoice: 'Send Voice',
        cancelVoice: 'Cancel Recording',
        voiceMessage: 'Voice Message',
        play: 'Play',
        pause: 'Pause',
        stop: 'Stop',
        volume: 'Volume',
        speed: 'Playback Speed',
        download: 'Download',
        uploadFile: 'Upload File',
        selectFile: 'Select File',
        dropFiles: 'Drop files here',
        fileUploaded: 'File uploaded',
        imagePreview: 'Image Preview',
        videoPreview: 'Video Preview',
        audioPreview: 'Audio Preview',
        documentPreview: 'Document Preview',
        linkPreview: 'Link Preview',
        generateLinkPreview: 'Generate Link Preview',
        linkPreviewFailed: 'Failed to generate link preview',
        embedVideo: 'Embed Video',
        embedAudio: 'Embed Audio',
        embedImage: 'Embed Image',
        embedDocument: 'Embed Document',
        embedCode: 'Embed Code',
        embedLink: 'Embed Link',
        formatBold: 'Bold',
        formatItalic: 'Italic',
        formatStrikethrough: 'Strikethrough',
        formatCode: 'Code',
        formatQuote: 'Quote',
        formatLink: 'Link',
        formatList: 'List',
        formatOrderedList: 'Ordered List',
        formatTaskList: 'Task List',
        formatHeading: 'Heading',
        formatParagraph: 'Paragraph',
        formatAlignLeft: 'Align Left',
        formatAlignCenter: 'Align Center',
        formatAlignRight: 'Align Right',
        formatAlignJustify: 'Align Justify',
        formatIndent: 'Increase Indent',
        formatOutdent: 'Decrease Indent',
        formatUndo: 'Undo',
        formatRedo: 'Redo',
        formatClear: 'Clear Format',
        formatHelp: 'Format Help',
        markdown: 'Markdown',
        richText: 'Rich Text',
        plainText: 'Plain Text',
        editMessage: 'Edit Message',
        saveEdit: 'Save Edit',
        cancelEdit: 'Cancel Edit',
        messageEdited: 'Message edited',
        editFailed: 'Edit failed',
        deleteMessage: 'Delete Message',
        deleteConfirmMsg: 'Are you sure you want to delete this message?',
        deleteForEveryone: 'Delete for everyone',
        deleteForMe: 'Delete for me only',
        messageDeletedForEveryone: 'Message deleted for everyone',
        messageDeletedForMe: 'Message deleted for me',
        reactions: 'Reactions',
        addReaction: 'Add Reaction',
        removeReaction: 'Remove Reaction',
        reactionAdded: 'Reaction added',
        reactionRemoved: 'Reaction removed',
        polls: 'Polls',
        createPoll: 'Create Poll',
        pollQuestion: 'Poll Question',
        pollOptions: 'Poll Options',
        addOption: 'Add Option',
        removeOption: 'Remove Option',
        pollDuration: 'Poll Duration',
        pollMultiple: 'Allow Multiple Choices',
        pollAnonymous: 'Anonymous Poll',
        pollCreated: 'Poll created',
        vote: 'Vote',
        voteSuccess: 'Vote successful',
        voteFailed: 'Vote failed',
        pollEnded: 'Poll ended',
        pollResults: 'Poll Results',
        pollWinner: 'Winner',
        threads: 'Threads',
        createThread: 'Create Thread',
        threadCreated: 'Thread created',
        threadReply: 'Reply to Thread',
        threadReplySuccess: 'Reply successful',
        threadReplyFailed: 'Reply failed',
        threadDeleted: 'Thread deleted',
        threadLocked: 'Thread locked',
        threadUnlocked: 'Thread unlocked',
        threadPinned: 'Thread pinned',
        threadUnpinned: 'Thread unpinned',
        threadArchived: 'Thread archived',
        threadUnarchived: 'Thread unarchived',
        threadMuted: 'Thread muted',
        threadUnmuted: 'Thread unmuted',
        viewThread: 'View Thread',
        closeThread: 'Close Thread',
        leaveThread: 'Leave Thread',
        followThread: 'Follow Thread',
        unfollowThread: 'Unfollow',
        threadNotifications: 'Thread Notifications',
        pinnedThreads: 'Pinned Threads',
        archivedThreads: 'Archived Threads',
        mutedThreads: 'Muted Threads',
        searchThreads: 'Search Threads',
        threadStats: 'Thread Statistics',
        threadMessages: 'Thread Messages',
        threadParticipants: 'Thread Participants',
        threadActivity: 'Thread Activity',
        threadCreatedBy: 'Thread Creator',
        threadCreatedAt: 'Created At',
        threadLastReply: 'Last Reply',
        threadTags: 'Thread Tags',
        addTag: 'Add Tag',
        removeTag: 'Remove Tag',
        tagAdded: 'Tag added',
        tagRemoved: 'Tag removed',
        tags: 'Tags',
        searchTags: 'Search Tags',
        trendingTags: 'Trending Tags',
        subscribedTags: 'Subscribed Tags',
        subscribeTag: 'Subscribe to Tag',
        unsubscribeTag: 'Unsubscribe',
        tagNotifications: 'Tag Notifications',
        mentions: 'Mentions',
        searchMentions: 'Search Mentions',
        mentionedMessages: 'Mentioned Messages',
        mentionedBy: 'Mentioned By',
        mentionSettings: 'Mention Settings',
        highlightMentions: 'Highlight Mentions',
        notifyMentions: 'Notify on Mentions',
        replyMentions: 'Reply to Mentions',
        ignoreMentions: 'Ignore Mentions',
        userProfile: 'User Profile',
        viewProfile: 'View Profile',
        editProfile: 'Edit Profile',
        profileUpdated: 'Profile updated',
        profileUpdateFailed: 'Failed to update profile',
        userStats: 'User Statistics',
        messagesCount: 'Message Count',
        joinedAt: 'Joined At',
        lastActive: 'Last Active',
        roles: 'Roles',
        roleAdmin: 'Admin',
        roleModerator: 'Moderator',
        roleUser: 'User',
        roleGuest: 'Guest',
        permissions: 'Permissions',
        grantPermission: 'Grant Permission',
        revokePermission: 'Revoke Permission',
        permissionGranted: 'Permission granted',
        permissionRevoked: 'Permission revoked',
        moderation: 'Moderation',
        reportQueue: 'Report Queue',
        pendingReports: 'Pending Reports',
        resolvedReports: 'Resolved Reports',
        resolveReport: 'Resolve Report',
        reportResolved: 'Report resolved',
        banUser: 'Ban User',
        unbanUser: 'Unban User',
        userBanned: 'User banned',
        userUnbanned: 'User unbanned',
        muteUser: 'Mute User',
        unmuteUser: 'Unmute User',
        userMuted: 'User muted',
        userUnmuted: 'User unmuted',
        warnUser: 'Warn User',
        userWarned: 'User warned',
        deleteUserMessages: 'Delete User Messages',
        messagesDeleted: 'Messages deleted',
        purgeUserMessages: 'Purge User Messages',
        messagesPurged: 'Messages purged',
        logs: 'Logs',
        viewLogs: 'View Logs',
        downloadLogs: 'Download Logs',
        clearLogs: 'Clear Logs',
        logsCleared: 'Logs cleared',
        systemLogs: 'System Logs',
        userLogs: 'User Logs',
        adminLogs: 'Admin Logs',
        auditLogs: 'Audit Logs',
        serverStatus: 'Server Status',
        onlineUsers: 'Online Users',
        totalUsers: 'Total Users',
        activeUsers: 'Active Users',
        serverLoad: 'Server Load',
        uptime: 'Uptime',
        versionInfo: 'Version Info',
        updateAvailable: 'Update available',
        updateNowBtn: 'Update Now',
        updateLater: 'Update Later',
        updating: 'Updating…',
        updateComplete: 'Update complete',
        updateFailed: 'Update failed',
        restartRequired: 'Restart required',
        restartNow: 'Restart Now',
        restartLater: 'Restart Later',
        maintenance: 'Maintenance',
        scheduledMaintenance: 'Scheduled Maintenance',
        maintenanceStart: 'Maintenance Start',
        maintenanceEnd: 'Maintenance End',
        maintenanceMessage: 'Service may be temporarily unavailable during maintenance',
        backup: 'Backup',
        createBackup: 'Create Backup',
        backupCreated: 'Backup created',
        backupFailed: 'Backup failed',
        restoreBackup: 'Restore Backup',
        backupRestored: 'Backup restored',
        restoreFailed: 'Restore failed',
        backupSettings: 'Backup Settings',
        autoBackup: 'Auto Backup',
        backupFrequency: 'Backup Frequency',
        backupRetention: 'Backup Retention',
        deleteBackup: 'Delete Backup',
        backupDeleted: 'Backup deleted',
        importExport: 'Import/Export',
        importData: 'Import Data',
        exportData: 'Export Data',
        dataImported: 'Data imported',
        dataExported: 'Data exported',
        importFailed: 'Import failed',
        exportFailed: 'Export failed',
        database: 'Database',
        databaseStatus: 'Database Status',
        databaseSize: 'Database Size',
        optimizeDatabase: 'Optimize Database',
        databaseOptimized: 'Database optimized',
        optimizeFailed: 'Optimization failed',
        cache: 'Cache',
        clearCache: 'Clear Cache',
        cacheCleared: 'Cache cleared',
        cacheStats: 'Cache Statistics',
        memoryUsage: 'Memory Usage',
        cpuUsage: 'CPU Usage',
        diskUsage: 'Disk Usage',
        networkUsage: 'Network Usage',
        apiStats: 'API Statistics',
        requests: 'Requests',
        errors: 'Errors',
        latency: 'Latency',
        uptimePercentage: 'Uptime Percentage',
        performance: 'Performance',
        performanceMode: 'Performance Mode',
        enablePerformanceMode: 'Enable Performance Mode',
        disablePerformanceMode: 'Disable Performance Mode',
        performanceOptimizations: 'Performance Optimizations',
        lazyLoading: 'Lazy Loading',
        enableLazyLoading: 'Enable Lazy Loading',
        disableLazyLoading: 'Disable Lazy Loading',
        imageCompression: 'Image Compression',
        enableImageCompression: 'Enable Image Compression',
        disableImageCompression: 'Disable Image Compression',
        webSocket: 'WebSocket',
        reconnectInterval: 'Reconnect Interval',
        maxReconnectAttempts: 'Max Reconnect Attempts',
        connectionTimeout: 'Connection Timeout',
        security: 'Security',
        twoFactorAuthSettings: 'Two-Factor Authentication Settings',
        enableTwoFactorAuth: 'Enable Two-Factor Authentication',
        disableTwoFactorAuth: 'Disable Two-Factor Authentication',
        recoveryCodes: 'Recovery Codes',
        generateRecoveryCodes: 'Generate Recovery Codes',
        recoveryCodesGenerated: 'Recovery codes generated',
        verifyRecoveryCode: 'Verify Recovery Code',
        recoveryCodeVerified: 'Recovery code verified',
        sessions: 'Sessions',
        activeSessions: 'Active Sessions',
        endSession: 'End Session',
        sessionEnded: 'Session ended',
        endAllSessions: 'End All Sessions',
        allSessionsEnded: 'All sessions ended',
        trustedDevices: 'Trusted Devices',
        addTrustedDevice: 'Add Trusted Device',
        removeTrustedDevice: 'Remove Trusted Device',
        deviceAdded: 'Device added',
        deviceRemoved: 'Device removed',
        loginHistory: 'Login History',
        recentLogins: 'Recent Logins',
        failedLogins: 'Failed Logins',
        suspiciousActivity: 'Suspicious Activity',
        securityAlerts: 'Security Alerts',
        alertSettings: 'Alert Settings',
        alertEmail: 'Email Alerts',
        alertPush: 'Push Alerts',
        alertBrowser: 'Browser Alerts',
        alertSMS: 'SMS Alerts',
        privacy: 'Privacy',
        privacySettings: 'Privacy Settings',
        onlineStatus: 'Online Status',
        showOnlineStatus: 'Show Online Status',
        hideOnlineStatus: 'Hide Online Status',
        profileVisibility: 'Profile Visibility',
        publicProfile: 'Public Profile',
        privateProfile: 'Private Profile',
        friendsOnlyProfile: 'Friends Only',
        messageReadReceipts: 'Read Receipts',
        enableReadReceipts: 'Enable Read Receipts',
        disableReadReceipts: 'Disable Read Receipts',
        typingIndicator: 'Typing Indicator',
        enableTypingIndicator: 'Enable Typing Indicator',
        disableTypingIndicator: 'Disable Typing Indicator',
        voiceRecordingIndicator: 'Voice Recording Indicator',
        enableVoiceRecordingIndicator: 'Enable Voice Recording Indicator',
        disableVoiceRecordingIndicator: 'Disable Voice Recording Indicator',
        dataCollection: 'Data Collection',
        enableDataCollection: 'Enable Data Collection',
        disableDataCollection: 'Disable Data Collection',
        analytics: 'Analytics',
        enableAnalytics: 'Enable Analytics',
        disableAnalytics: 'Disable Analytics',
        cookies: 'Cookies',
        cookieSettings: 'Cookie Settings',
        essentialCookies: 'Essential Cookies',
        functionalCookies: 'Functional Cookies',
        analyticsCookies: 'Analytics Cookies',
        advertisingCookies: 'Advertising Cookies',
        acceptAllCookies: 'Accept All Cookies',
        rejectAllCookies: 'Reject All Cookies',
        saveCookiePreferences: 'Save Cookie Preferences',
        cookiePreferencesSaved: 'Cookie preferences saved',
        consent: 'Consent',
        consentRequired: 'Consent Required',
        consentGiven: 'Consent Given',
        consentRevoked: 'Consent Revoked',
        termsAndConditions: 'Terms and Conditions',
        privacyPolicyLink: 'Privacy Policy',
        termsOfServiceLink: 'Terms of Service',
        acceptTerms: 'Accept Terms',
        rejectTerms: 'Reject Terms',
        termsAccepted: 'Terms accepted',
        termsRejected: 'Terms rejected',
        welcomeTour: 'Welcome Tour',
        startTour: 'Start Tour',
        skipTour: 'Skip Tour',
        nextStep: 'Next Step',
        prevStep: 'Previous Step',
        finishTour: 'Finish Tour',
        tourCompleted: 'Tour completed',
        tourSkipped: 'Tour skipped',
        helpCenter: 'Help Center',
        gettingStarted: 'Getting Started',
        advancedFeatures: 'Advanced Features',
        troubleshooting: 'Troubleshooting',
        commonIssues: 'Common Issues',
        contactSupport: 'Contact Support',
        submitTicket: 'Submit Ticket',
        ticketSubmitted: 'Ticket submitted',
        ticketStatus: 'Ticket Status',
        ticketResolved: 'Ticket resolved',
        knowledgeBase: 'Knowledge Base',
        articles: 'Articles',
        categories: 'Categories',
        searchKnowledgeBase: 'Search Knowledge Base',
        articleViewed: 'Article viewed',
        articleHelpful: 'Article helpful',
        articleNotHelpful: 'Article not helpful',
        feedbackForm: 'Feedback Form',
        submitFeedback: 'Submit Feedback',
        feedbackSubmitted: 'Feedback submitted',
        feedbackThanks: 'Thank you for your feedback',
        bugReport: 'Bug Report',
        featureRequest: 'Feature Request',
        improvementSuggestion: 'Improvement Suggestion',
        otherFeedback: 'Other Feedback',
        feedbackType: 'Feedback Type',
        feedbackTitle: 'Feedback Title',
        feedbackDescription: 'Feedback Description',
        feedbackAttachments: 'Feedback Attachments',
        feedbackPriority: 'Feedback Priority',
        priorityLow: 'Low',
        priorityMedium: 'Medium',
        priorityHigh: 'High',
        priorityUrgent: 'Urgent',
        news: 'News',
        latestNews: 'Latest News',
        archivedNews: 'Archived News',
        newsCategory: 'News Category',
        newsTag: 'News Tag',
        newsSearch: 'Search News',
        readNews: 'Read News',
        newsRead: 'News read',
        newsUnread: 'News unread',
        newsNotification: 'News Notification',
        enableNewsNotification: 'Enable News Notification',
        disableNewsNotification: 'Disable News Notification',
        announcements: 'Announcements',
        latestAnnouncements: 'Latest Announcements',
        archivedAnnouncements: 'Archived Announcements',
        announcementCategory: 'Announcement Category',
        announcementTag: 'Announcement Tag',
        announcementSearch: 'Search Announcements',
        readAnnouncement: 'Read Announcement',
        announcementRead: 'Announcement read',
        announcementUnread: 'Announcement unread',
        announcementNotification: 'Announcement Notification',
        enableAnnouncementNotification: 'Enable Announcement Notification',
        disableAnnouncementNotification: 'Disable Announcement Notification',
        changelogView: 'Changelog',
        latestChangelog: 'Latest Updates',
        archivedChangelog: 'Past Updates',
        changelogCategory: 'Update Category',
        changelogTag: 'Update Tag',
        changelogSearch: 'Search Updates',
        readChangelog: 'Read Update',
        changelogRead: 'Update read',
        changelogUnread: 'Update unread',
        changelogNotification: 'Update Notification',
        enableChangelogNotification: 'Enable Update Notification',
        disableChangelogNotification: 'Disable Update Notification',
        noOtherOnline: 'No other online users',
        noUserFound: 'No user found',
        onlineSection: 'Online',
        offlineSection: 'Offline',
        noEmojiData: 'No emoji data',
        noEmoji: 'No emoji',
        nicknameEmpty: 'Nickname cannot be empty',
        nicknameTooLong: 'Nickname cannot exceed 20 characters',
        saving: 'Saving…',
        nicknameUsed: 'Nickname already taken',
        nicknameSaved: 'Nickname updated',
        searching: 'Searching...',
        searchingInDb: 'Searching in database…',
        quoteLabel: 'Quote',
        alreadyLatest: 'Already the latest version',
        copied: 'Copied',
        locatedOriginal: 'Located original message',
        messageDeleted2: 'Original message has been deleted',
        foundAndLoaded: 'Found and loaded original message',
        networkError: 'Network error',
        originalNotFound: 'Original message not found',
        saveFailed: 'Save failed',
        pleaseSelectImage: 'Please select an image',
        imageTooLargeMsg: 'Image cannot exceed 5MB',
        uploading: 'Uploading…',
        avatarUpdated: 'Avatar updated',
        uploadFailedMsg: 'Upload failed',
        downloadOriginal: 'Download Original',
        downloadingBtn: 'Downloading…',
        downloaded: 'Downloaded',
        downloadFailed: 'Failed',
        close: 'Close',
        pleaseLogin: 'Please login first',
        restoredMessages: 'Restored {count} messages.',
        cleanedMessages: 'Cleaned {count} messages.',
        sensitiveWordTip: 'Message contains sensitive word ("{word}"), please modify and retry',
        sendTooFast: 'Sending too fast',
        sendFailed: 'Send failed: ',
        unknownError: 'Unknown error'
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
    localStorage.setItem('minichat_lang', lang === 'system' ? 'system' : lang);
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
        var key = el.getAttribute('data-i18n');
        if (key && i18n[lang] && i18n[lang][key]) {
            el.textContent = i18n[lang][key];
        }
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function(el) {
        var key = el.getAttribute('data-i18n-html');
        if (key && i18n[lang] && i18n[lang][key]) {
            el.innerHTML = i18n[lang][key];
        }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
        var key = el.getAttribute('data-i18n-placeholder');
        if (key && i18n[lang] && i18n[lang][key]) {
            el.placeholder = i18n[lang][key];
        }
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function(el) {
        var key = el.getAttribute('data-i18n-title');
        if (key && i18n[lang] && i18n[lang][key]) {
            el.title = i18n[lang][key];
        }
    });
    document.querySelectorAll('.time-label[data-time]').forEach(function(el) {
        var t = el.querySelector('span');
        if (t) t.textContent = formatTimeLine(el.dataset.time);
    });
    document.querySelectorAll('.time-divider[data-time]').forEach(function(el) {
        var t = el.querySelector('span');
        if (t) t.textContent = formatTimeShort(el.dataset.time);
    });
    document.querySelectorAll('.message[data-created-at] .time').forEach(function(el) {
        var msgEl = el.closest('.message');
        if (msgEl && msgEl.dataset.createdAt) el.textContent = formatTimeShort(msgEl.dataset.createdAt);
    });
    var langDropdownBtn = document.getElementById('languageDropdownBtn');
    var savedLang = localStorage.getItem('minichat_lang') || 'system';
    if (langDropdownBtn) {
        var span = langDropdownBtn.querySelector('.lang-name');
        if (span) {
            var displayLang = savedLang === 'system' ? (navigator.language || navigator.userLanguage || 'zh').startsWith('zh') ? 'zh' : 'en' : savedLang;
            span.textContent = displayLang === 'zh' ? i18n.zh.chinese : i18n.en.english;
        }
    }
}
function setLang(lang) {
    localStorage.setItem('minichat_lang', lang);
    loadLanguage();
    if (typeof updateOnlineUI === 'function') updateOnlineUI();
}

// ===================== 表情面板（绕过 Service Worker） =====================
function toEmojiChar(code) {
    if (typeof code !== 'string') return code;
    if (code.startsWith('U+')) {
        return String.fromCodePoint(parseInt(code.slice(2), 16));
    }
    if (/^[0-9A-Fa-f]+$/.test(code)) {
        return String.fromCodePoint(parseInt(code, 16));
    }
    return code;
}
function decodeHtmlEntities(str) {
    if (typeof str !== 'string') return str;
    const textarea = document.createElement('textarea');
    textarea.innerHTML = str;
    return textarea.value;
}
var allEmojiData = {};
var EMOJI_FALLBACK = {
    '常用': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','🤩','😘','😗','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾'],
    '手势': ['👋','🤚','🖐️','🖖','👌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤛','🤜','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦵','🦿','🦶','👂','🦻','👃','👄','👅','👀','👁️'],
    '动物': ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🦋','🐌','🐛','🐞','🦟','🦗','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🦈','🐳','🐋','🦭','🦐','🦑','🐙','🦪','🦀','🐡'],
    '食物': ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🌽','🥦','🥬','🥒','🌶️','🌽','🥕','🧅','🧄','🥜','🌰','🍞','🥐','🥖','🥨','🧀','🍕','🍔','🍟','🌭','🍿','🧈','🍳','🥚','🍞','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌮','🌯','🥙','🧆','🥚','🍳','🧈','🥛','🍼','☕','🍵','🧃','🥤','🧋','🍶','🍾','🍷','🥃','🍸','🍹','🧉','🍺','🍻','🥂','🥞'],
    '物品': ['💎','🎁','🎈','🎀','🏆','🎯','🎮','🎲','🎸','🎹','🎺','🎻','🎷','🎤','🎧','📱','💻','🖥️','⌚','📷','📸','📹','🎥','📺','📻','📡','💾','💿','📀','📼','📞','☎️','📟','📠','📡','🔋','🔌','🔍','🔎','🧭','🧪','🧫','🧬','📊','📈','📉','📋','📌','📍','📍','📎','📏','📐','✂️','🔗','🖇️','📕','📖','📗','📘','📙','📚','📓','📔','📒','📑','📰','📈','📉','📊','📋','📌','🔖','🏷️'],
    '表情': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','💢','💯','💢','💬','💭','🗨️','💤','😴','🤤','😪','😫','🥱','😌','😔','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😴','🤤','😪','😵','🤯','🤠'],
    '颜文字': ['(^_^)', '(^^)', '(^_^;)', '(;^_^)', '(^^;)', '(^-^)', '(^o^)', '(^▽^)', '(^.^)', '(^-^;)', '(;^-^)', '(^^)', '(^_^)', '(^o^)', '(^▽^)', '(^.^)', '(^-^)', '(^_^)', '(^o^)', '(^▽^)', '(^.^)', '(^-^)', '(^_^)', '(^o^)', '(^▽^)', '(^.^)', '(^-^)', '(^_^)', '(^o^)', '(^▽^)', '(^.^)', '(^-^)', '(^_^)', '(^o^)', '(^▽^)', '(^.^)', '(^-^)', '(^_^)', '(^o^)', '(^▽^)', '(^.^)', '(^-^)'],
    '符号': ['❤️','✨','🌟','⭐','🔥','💯','💪','🎉','🎊','🎁','🎈','🎀','🏆','🎯','🎲','🎸','🎹','🎺','🎻','🎷','🎤','🎧','📱','💻','🖥️','⌚','📷','📸','📹','🎥','📺','📻','📡','💾','💿','📀','📼','📞','☎️','📟','📠','📡','🔋','🔌','🔍','🔎','🧭','🧪','🧫','🧬','📊','📈','📉','📋','📌','📍','📍','📎','📏','📐','✂️','🔗','🖇️','📕','📖','📗','📘','📙','📚','📓','📔','📒','📑','📰','📈','📉','📊','📋','📌','🔖','🏷️','💎','👑','🎖️','⚽','🏀','🏈','⚾','🎾','🏐','🏉','🎱','🏓','🏸','🏒','🏑','🥍','🎳','⛳','🚵','🚴','🏂','⛷️','🎿','🛷','⛸️','🚣','🏊','🤽','🤾','🎽','🎿','🛷','⛸️','🚣','🏊','🤽','🤾','🎽','🎿','🛷','⛸️','🚣','🏊','🤽','🤾','🎽','🎿','🛷','⛸️','🚣','🏊','🤽','🤾','🎽']
};
async function loadEmojiData(retry) {
            retry = retry || 0;
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 15000);
                const headers = { 'Cache-Control': 'no-cache, no-store' };
                const ts = Date.now() + '_' + Math.random();
                const [emojiRes, kaoRes] = await Promise.all([
                    fetch('./data/emojihub-all.json?t=' + ts, { signal: controller.signal, headers: headers, cache: 'no-store' })
                        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
                        .catch(() => null),
                    fetch('./data/kaomoji.json?t=' + ts, { signal: controller.signal, headers: headers, cache: 'no-store' })
                        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
                        .catch(() => null)
                ]);
                clearTimeout(timeout);
                const emojiGroups = {};
                if (emojiRes && Array.isArray(emojiRes)) {
                    emojiRes.forEach(item => {
                        const cat = item.category || '其他';
                        if (!emojiGroups[cat]) emojiGroups[cat] = [];
                        let unicodeStr = item.unicode;
                        if (Array.isArray(unicodeStr)) unicodeStr = unicodeStr[0];
                        if (unicodeStr) {
                            emojiGroups[cat].push(toEmojiChar(unicodeStr));
                        } else if (item.htmlCode && item.htmlCode.length) {
                            let htmlStr = Array.isArray(item.htmlCode) ? item.htmlCode[0] : item.htmlCode;
                            emojiGroups[cat].push({ __html: htmlStr });
                        }
                    });
                } else if (emojiRes && typeof emojiRes === 'object') {
                    Object.entries(emojiRes).forEach(([cat, list]) => { emojiGroups[cat] = list; });
                }
                const kaoGroups = {};
                if (kaoRes && typeof kaoRes === 'object') {
                    for (const [cat, list] of Object.entries(kaoRes)) {
                        const decodedList = list.map(item => decodeHtmlEntities(item));
                        kaoGroups['颜文字_' + cat] = decodedList;
                    }
                }
                if (Object.keys(emojiGroups).length === 0) {
                    Object.assign(emojiGroups, EMOJI_FALLBACK);
                }
                if (Object.keys(kaoGroups).length === 0) {
                    kaoGroups['颜文字'] = EMOJI_FALLBACK['颜文字'];
                }
                allEmojiData = { ...emojiGroups, ...kaoGroups };
                renderTabs();
                emojiLoadFailed = false;
            } catch(e) {
                console.warn('表情加载失败:', e.message);
                if (retry < 2) {
                    console.log('表情加载超时，尝试重试', retry+1);
                    setTimeout(() => loadEmojiData(retry+1), 2000);
                    return;
                }
                allEmojiData = EMOJI_FALLBACK;
                renderTabs();
                emojiLoadFailed = true;
            }
        }
        function renderTabs() {
    if (!emojiTabs || !emojiGrid) return;
    emojiTabs.innerHTML = '';
    const cats = Object.keys(allEmojiData);
    if (cats.length === 0) { emojiGrid.innerHTML = '<div class="emoji-loading">'+t('noEmojiData')+'</div>'; return; }
    cats.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'emoji-tab';
        const firstItem = allEmojiData[cat][0];
        let exampleChar = '';
        if (typeof firstItem === 'string') {
            exampleChar = firstItem;
        } else if (firstItem && firstItem.__html) {
            exampleChar = firstItem.__html.replace(/<[^>]*>/g, '');
        }
        if (exampleChar) btn.textContent = exampleChar;
        else btn.textContent = cat;
        btn.title = cat;
        btn.addEventListener('click', () => switchCategory(cat));
        emojiTabs.appendChild(btn);
    });
    if (cats.length) switchCategory(cats[0]);
}
function switchCategory(cat) {
    if (!emojiTabs || !emojiGrid) return;
    document.querySelectorAll('.emoji-tab').forEach(t => t.classList.remove('active'));
    const tab = [...emojiTabs.children].find(t => t.title === cat);
    if (tab) tab.classList.add('active');
    renderGrid(allEmojiData[cat] || []);
}
function renderGrid(items) {
    if (!emojiGrid) return;
    emojiGrid.innerHTML = '';
    if (!items.length) { emojiGrid.innerHTML = '<div class="emoji-loading">'+t('noEmoji')+'</div>'; return; }
    items.forEach(emoji => {
        const span = document.createElement('span');
        span.className = 'emoji-item' + (typeof emoji === 'string' && emoji.length > 2 ? ' kaomoji-item' : '');
        if (typeof emoji === 'string') {
            span.textContent = emoji;
        } else if (emoji && emoji.__html) {
            span.innerHTML = emoji.__html;
        } else {
            span.textContent = String(emoji);
        }
        span.addEventListener('click', () => {
            const text = span.textContent || span.innerText;
            insertAtCursor(text);
            if (emojiPanel) emojiPanel.classList.remove('active');
            emojiVisible = false;
        });
        emojiGrid.appendChild(span);
    });
}
var emojiVisible = false;
if (emojiBtn) {
    emojiBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        emojiVisible = !emojiVisible;
        if (emojiPanel) emojiPanel.classList.toggle('active', emojiVisible);
    });
}
document.addEventListener('click', function(e) {
    if (emojiVisible && emojiPanel && !emojiPanel.contains(e.target) && e.target !== emojiBtn) {
        if (emojiPanel) emojiPanel.classList.remove('active');
        emojiVisible = false;
    }
});
loadEmojiData();

// ===================== 独立 Presence 频道 =====================
function setupPresenceChannel() {
    if (presenceChannel) {
        presenceChannel.unsubscribe();
        presenceChannel = null;
    }
    if (!currentUserId) return;
    presenceChannel = supabase.channel('presence-global', {
        config: { presence: { key: currentUserId } }
    });
    presenceChannel.on('presence', { event: 'sync' }, () => {
        var state = presenceChannel.presenceState();
        var us = {}, c = 0;
        for (var k in state) {
            var p = state[k][0];
            if (!p) continue;
            var em = p.email || '';
            us[k] = {
                user_id: k,
                display_name: p.display_name || '匿名',
                email: em,
                avatar_url: p.avatar_url || getDefaultAvatar(em)
            };
            if (p.avatar_url && (!currentUserMap[em] || currentUserMap[em].avatar_url !== p.avatar_url)) {
                currentUserMap[em] = { ...currentUserMap[em], avatar_url: p.avatar_url };
                refreshAllAvatars(em, p.avatar_url);
            }
            if (p.display_name) currentUserMap[em] = { ...currentUserMap[em], display_name: p.display_name };
            c++;
        }
        onlineUsers = us;
        onlineCount = c;
        updateOnlineUI();
    });
    presenceChannel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
            await presenceChannel.track({
                user_id: currentUserId,
                email: currentEmail,
                display_name: currentDisplayName || currentEmail.split('@')[0],
                avatar_url: currentAvatarUrl,
                online_at: new Date().toISOString()
            }).catch(err => console.warn('Presence track 失败:', err));
        }
    });
}
function setupProfilesRealtime() {
    if (profilesRealtimeChannel) {
        profilesRealtimeChannel.unsubscribe();
        profilesRealtimeChannel = null;
    }
    var debounceTimer = null;
    profilesRealtimeChannel = supabase.channel('profiles-realtime');
    profilesRealtimeChannel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'profiles'
    }, function(payload) {
        if (!currentEmail) return;
        if (payload.new && payload.new.email === currentEmail) return;
        // 别人的头像换了：同步到本地缓存并刷新所有显示该用户头像的位置
        if (payload.eventType === 'UPDATE' && payload.new && payload.old &&
            payload.new.avatar_url && payload.new.avatar_url !== payload.old.avatar_url) {
            var changedEmail = payload.new.email;
            if (changedEmail) {
                currentUserMap[changedEmail] = Object.assign({}, currentUserMap[changedEmail] || {}, { avatar_url: payload.new.avatar_url });
                delete failedAvatars[changedEmail];
                avatarCache = {};
                refreshAllAvatars(changedEmail, payload.new.avatar_url);
            }
        }
        if (payload.eventType === 'UPDATE' && payload.old && payload.new && payload.old.display_name !== payload.new.display_name) {
            var oldName = payload.old.display_name;
            var newName = payload.new.display_name;
            if (oldName && newName && oldName !== newName) {
                try { updateMentionsInDOM(oldName, newName); } catch(e) {}
            }
        }
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
            fetchAllMembers().then(function(members) {
                if (allMembersModal && allMembersModal.classList.contains('active')) {
                    renderAllMembers(members);
                }
            });
        }, 500);
    });
    profilesRealtimeChannel.subscribe(function(status) {
        if (status === 'SUBSCRIBED') {
            console.log('Profiles realtime subscribed');
        }
    });
}

// ===================== 聊天核心 =====================
function enterChat() {
            if (!loginOverlay || !mainInterface) return;
            loginOverlay.classList.add('hidden');
            // ⚠️ 关键：#app 是启动画面 + 登录界面的容器，CSS 是 width:100vw;height:100vh。
            //    它一直留在文档流里，会占满整个视口高度，把排在它后面的 #mainInterface
            //    整个顶到屏幕下方 —— 表现就是"界面各项属性全对，但人看到的是一片白"。
            //    所以进聊天时必须把它收起来。
            var appShell = document.getElementById('app');
            if (appShell) appShell.style.display = 'none';
            mainInterface.classList.remove('hidden');
            // 锁定全局聊天 ID，不再动态切换会话
            currentConversationId = '00000000-0000-0000-0000-000000000000';
            hasMoreMessages = true; oldestTimestamp = null; isLoadingMore = false; unreadCount = 0;
            document.title = 'MiniChat';
            // ⚠️ 这里必须接 .catch：loadDisplayName 一旦失败（网络抖动 / profile 查询出错），
            //    原来整个 .then 都不会执行 —— 主界面框架显示出来了，但下面的
            //    ensureGlobalConversation / loadHistory / subscribeMessages 全被跳过，
            //    用户看到的就是「登录界面闪一下，然后一片空白」。
            console.log('[MiniChat/boot] enterChat 开始');
            loadDisplayName().catch(function(e) {
                console.warn('[MiniChat/boot] 加载昵称失败，继续初始化聊天：', e && e.message);
            }).then(() => {
                console.log('[MiniChat/boot] 昵称加载完成');
                try { setupPresenceChannel(); } catch (e) { console.warn('[MiniChat/boot] presence 失败', e); }
                try { setupProfilesRealtime(); } catch (e) { console.warn('[MiniChat/boot] profiles 失败', e); }
                try { fetchAllMembers(); } catch (e) { console.warn('[MiniChat/boot] 成员列表失败', e); }
                // 不再加载会话列表，仅保证全局会话存在并订阅频道
                ensureGlobalConversation().catch(function(e) {
                    console.warn('[MiniChat/boot] 全局会话准备失败（继续）', e && e.message);
                }).then(() => {
                    console.log('[MiniChat/boot] 开始加载历史 | messageList=' + !!messageList +
                                ' isLoadingMore=' + isLoadingMore + ' hasMoreMessages=' + hasMoreMessages);
                    // 这里【不清空】消息列表：清空放在 loadHistory 成功之后再统一做。
                    // 否则一旦查询失败或超时，界面就会一直是一片空白。
                    isLoadingMore = false;   // 强制复位，避免被别处的并发调用卡住
                    loadHistory(false);
                    try { subscribeMessages(); } catch (e) { console.warn('[MiniChat/boot] 订阅消息失败', e); }
                    highlightGlobalNav();
                    // 自愈：4 秒后列表还是空的就再拉一次（只补一次，避免死循环）
                    setTimeout(function() {
                        if (messageList && messageList.children.length === 0) {
                            console.warn('[MiniChat/boot] 消息列表仍为空，重试一次');
                            isLoadingMore = false;
                            loadHistory(false);
                        }
                    }, 4000);
                });
            });
            localStorage.setItem('minichat_user', JSON.stringify({ email: currentEmail, id: currentUserId }));
            var accountEmailEl = document.getElementById('accountEmail');
            if (accountEmailEl) accountEmailEl.textContent = currentEmail;
            loadTheme();
            loadLanguage();
            if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
            setupGlobalEventListeners();
            if (btnSend) btnSend.disabled = false;
            if (chatInput) {
                chatInput.addEventListener('input', function() {
                    localStorage.setItem('minichat_draft', chatInput.value);
                    autoResizeTextarea();
                });
                var savedDraft = localStorage.getItem('minichat_draft');
                if (savedDraft) {
                    chatInput.value = savedDraft;
                }
                autoResizeTextarea();
                chatInput.addEventListener('focus', function() {
                    setTimeout(function() {
                        if (messageList) {
                            messageList.scrollTop = messageList.scrollHeight;
                            isUserAtBottom = true;
                            updateNewMsgButton();
                        }
                    }, 100);
                });
            }
            if (settingsNav) {
                settingsNav.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (settingsOverlay) settingsOverlay.classList.add('active');
                });
            }
            if (sidebarUserAvatar) {
                sidebarUserAvatar.addEventListener('click', function(e) {
                    e.stopPropagation();
                    showUserProfile(currentEmail);
                });
            }
            var sidebarUserAvatarBtn = document.getElementById('sidebarUserAvatarBtn');
            if (sidebarUserAvatarBtn) {
                sidebarUserAvatarBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    showUserProfile(currentEmail);
                });
            }
            if (sidebarUserEmail) {
                sidebarUserEmail.addEventListener('click', function(e) {
                    e.stopPropagation();
                    showUserProfile(currentEmail);
                });
            }
            if (sidebarCollapseBtn && sidebar) {
                sidebarCollapseBtn.addEventListener('click', function() {
                    sidebar.classList.toggle('collapsed');
                    var isCollapsed = sidebar.classList.contains('collapsed');
                    localStorage.setItem('minichat_sidebar_collapsed', isCollapsed ? 'true' : 'false');
                });
                var saved = localStorage.getItem('minichat_sidebar_collapsed');
                if (saved === 'true') sidebar.classList.add('collapsed');
            }
        }

        function handleLogout() {
            showConfirm(t('logoutConfirm'), async function() {
                if (presenceChannel) {
                    try { await presenceChannel.untrack(); } catch(e) {}
                    presenceChannel.unsubscribe();
                    presenceChannel = null;
                }
                if (window.chatChannel) {
                    try { await window.chatChannel.untrack(); } catch(e) {}
                    window.chatChannel.unsubscribe();
                    window.chatChannel = null;
                }
                await supabase.auth.signOut();
                localStorage.clear();
                sessionStorage.clear();
                location.reload(true);
            });
        }
function closeSettingsFunc() { if (settingsOverlay) settingsOverlay.classList.remove('active'); }

// ===================== 会话管理（仅全局聊天） =====================
// 确保全局会话存在，并保证当前用户是其中的参与者
async function ensureGlobalConversation() {
    try {
        // 1. 确保 conversations 表中存在全局会话记录
        var existing = (await supabase
            .from('conversations')
            .select('id')
            .eq('id', '00000000-0000-0000-0000-000000000000')
            .maybeSingle()).data;
        if (!existing) {
            await supabase.from('conversations').insert({
                id: '00000000-0000-0000-0000-000000000000',
                type: 'global',
                name: '全局聊天'
            });
        }
        // 2. 确保当前用户是参与者（避免外键报错）
        if (currentUserId) {
            var part = (await supabase
                .from('conversation_participants')
                .select('conversation_id')
                .eq('conversation_id', '00000000-0000-0000-0000-000000000000')
                .eq('user_id', currentUserId)
                .maybeSingle()).data;
            if (!part) {
                await supabase.from('conversation_participants').insert({
                    conversation_id: '00000000-0000-0000-0000-000000000000',
                    user_id: currentUserId
                });
            }
        }
    } catch (e) {
        console.warn('确保全局会话存在时出错:', e.message);
    }
}

// 侧边栏聊天项的激活态切换
function highlightGlobalNav() {
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.toggle('active', el.id === 'globalChatNav');
    });
}

// ===================== 消息加载 =====================
async function loadHistory(append, retryCount = 0) {
            console.log('[MiniChat/loadHistory] 进入 append=' + append + ' messageList=' + !!messageList +
                        ' isLoadingMore=' + isLoadingMore + ' hasMoreMessages=' + hasMoreMessages);
            if (!messageList) { console.warn('[MiniChat/loadHistory] 提前返回：messageList 不存在'); return; }
            if (isLoadingMore) { console.warn('[MiniChat/loadHistory] 提前返回：上一次还在加载中'); return; }
            if (!hasMoreMessages && append) { console.warn('[MiniChat/loadHistory] 提前返回：没有更多了'); return; }
            isLoadingMore = true;
            try {
                let query = supabase
                    .from('messages')
                    .select('*')
                    .or('conversation_id.is.null,conversation_id.eq.00000000-0000-0000-0000-000000000000')
                    .order('created_at', { ascending: false })
                    .limit(PAGE_SIZE);
                if (oldestTimestamp) {
                    query = query.lt('created_at', oldestTimestamp);
                }
                console.log('[MiniChat/loadHistory] 发起查询…');
                // 超时保护：查询挂住时不能让界面一直空着
                const raceRes = await Promise.race([
                    query,
                    new Promise(function(_, rej) { setTimeout(function() { rej(new Error('查询超时（15 秒）')); }, 15000); })
                ]);
                const data = raceRes.data, error = raceRes.error;
                console.log('[MiniChat/loadHistory] 查询返回 | data=' + (data ? data.length : 'null') +
                            ' error=' + (error && error.message ? error.message : '无'));
                if (error) throw error;
                if (!data || data.length === 0) {
                    hasMoreMessages = false;
                    isLoadingMore = false;
                    console.log('[MiniChat/loadHistory] 完成（无数据，显示空状态）');
                    if (!append) {
                        messageList.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px 0;">' + t('noMessages') + '</div>';
                    }
                    return;
                }
                var sorted = data.reverse();
                oldestTimestamp = sorted[0].created_at;
                var emails = [...new Set(sorted.map(m => m.sender_email).filter(Boolean))];
                if (emails.length) {
                    var profiles = await fetchUserProfiles(emails);
                    Object.assign(currentUserMap, profiles);
                }
                var msgs = sorted.map(m => {
                    var isDeleted = !m.sender_email || m.sender_email === 'deleted_user';
                    var me = !isDeleted && m.sender_email === currentEmail;
                    var ui = currentUserMap[m.sender_email] || {};
                    return {
                        id: m.id,
                        content: m.content,
                        sender_name: isDeleted ? t('deletedUser') : (m.sender_name || ui.display_name || '匿名'),
                        sender_email: isDeleted ? '' : m.sender_email,
                        isMe: me,
                        time: formatTimeShort(m.created_at),
                        created_at: m.created_at
                    };
                });
                if (!append) {
                    messageList.innerHTML = '';
                    lastTimeLabel = '';
                    lastTimeDivider = 0;
                    allLoadedMessages = [];
                    msgs.forEach(m => addMessageToBottom(m));
                    // 加载完成后认领已读
                    setTimeout(function(){
                        if (isUserAtBottom) markMessagesRead();
                    }, 50);
                } else {
                    prependMessages(msgs);
                }
                if (data.length < PAGE_SIZE) {
                    hasMoreMessages = false;
                } else {
                    hasMoreMessages = true;
                }
                isLoadingMore = false;
                checkVirtualScroll();
                console.log('[MiniChat/loadHistory] 完成 | 子节点=' + messageList.children.length +
                            ' .message=' + messageList.querySelectorAll('.message').length +
                            ' scrollHeight=' + messageList.scrollHeight +
                            ' clientHeight=' + messageList.clientHeight +
                            ' display=' + getComputedStyle(messageList).display +
                            ' 父级display=' + (messageList.parentElement ? getComputedStyle(messageList.parentElement).display : '?'));
            } catch (e) {
                console.error('加载历史失败:', e);
                isLoadingMore = false;
                if (!append) {
                    if (retryCount < 3) {
                        setTimeout(function() {
                            loadHistory(false, retryCount + 1);
                        }, 1000 * (retryCount + 1));
                        return;
                    }
                    messageList.innerHTML = '<div style="text-align:center;color:#f87171;padding:40px 0;"><div>' + t('loadMessagesFailed') + '</div><button style="margin-top:12px;padding:6px 16px;background:var(--accent);color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer;" onclick="refreshMessages()">' + t('refresh') + '</button></div>';
                }
            }
        }

        async function refreshMessages() { if (messageList) messageList.innerHTML = ''; hasMoreMessages = true; oldestTimestamp = null; await loadHistory(false); }

// ===================== 消息渲染 =====================
var lastTimeDivider = 0;
function createMessageElement(msg) {
    var content = msg.content, sender_name = msg.sender_name, sender_email = msg.sender_email, isMe = msg.isMe, time = msg.time, id = msg.id, created_at = msg.created_at;
    var hideHeader = !!msg._hideHeader;
    var div = document.createElement('div');
    div.className = 'message ' + (isMe ? 'me' : 'other');
    if (id) div.dataset.messageId = id;
    if (created_at) div.dataset.createdAt = created_at;
    if (sender_email) div.dataset.senderEmail = sender_email;
    if (content != null) div.dataset.rawContent = content;
    var isRecalled = (content === '（' + t('retracted') + '）');
    var aw = document.createElement('div'); aw.className = 'avatar-wrapper';
    var ai = document.createElement('img');
    ai.src = getAvatarUrl(sender_email);
    ai.alt = '头像';
    ai.loading = 'eager';
    ai.dataset.senderEmail = sender_email;
    ai.onerror = function() { handleAvatarError(this, sender_email); };
    aw.appendChild(ai);
    aw.addEventListener('click', e => { e.stopPropagation(); showProfileCard(sender_email); });
    aw.addEventListener('contextmenu', e => {
        e.preventDefault();
        var rect = aw.getBoundingClientRect();
        var x = e.clientX || rect.left + rect.width/2, y = e.clientY || rect.top + rect.height/2;
        if (contextMenu) {
            contextMenu.dataset.targetEmail = sender_email;
            contextMenu.dataset.targetName = sender_name || sender_email.split('@')[0];
            contextMenu.style.left = x + 'px'; contextMenu.style.top = y + 'px';
            contextMenu.classList.add('active');
        }
    });
    div.appendChild(aw);
    var bubble = document.createElement('div'); bubble.className = 'bubble';
    if (!hideHeader) {
        var sd = document.createElement('div'); sd.className = 'sender';
        var ns = document.createElement('span'); ns.className = 'name'; ns.textContent = sender_name || '匿名'; sd.appendChild(ns);
        if (sender_email && sender_email !== sender_name) { var es = document.createElement('span'); es.className = 'email'; es.textContent = sender_email; sd.appendChild(es); }
        sd.addEventListener('click', e => { e.stopPropagation(); showProfileCard(sender_email); });
        bubble.appendChild(sd);
    }
    var cd = document.createElement('div'); cd.className = 'message-content'; cd.innerHTML = renderMessageContent(content);
    bubble.appendChild(cd);
    var ft = document.createElement('div'); ft.className = 'message-footer';
    var ts = document.createElement('span'); ts.className = 'time'; ts.textContent = time || formatTimeShort(new Date().toISOString()); ft.appendChild(ts);
    if (!isRecalled) {
        var qb = document.createElement('button'); qb.className = 'action-btn'; qb.title = '引用回复'; qb.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>';
        qb.addEventListener('click', e => { e.stopPropagation(); addQuoteAttachment(sender_name, sender_email, content, created_at, id); });
        ft.appendChild(qb);
        var fb = document.createElement('button'); fb.className = 'action-btn'; fb.title = '复制内容'; fb.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>';
        fb.addEventListener('click', e => {
            e.stopPropagation();
            var copyText = (content || '').replace(/!\[image\]\([^)]*\)/g,'[图片]').replace(/\[audio\]\([^)]*\)/g,'[音频]').replace(/\[video\]\([^)]*\)/g,'[视频]').replace(/\[file\]\([^)]*\)/g,'[文件]').replace(/\[quote:[^\]]*\]/g,'');
            navigator.clipboard.writeText(copyText).then(() => {
                var tip = document.createElement('span'); tip.textContent = t('copied'); tip.style.cssText = 'color:#4ade80;font-size:11px;margin-left:2px;';
                ft.appendChild(tip); setTimeout(() => tip.remove(), 1500);
            });
        });
        ft.appendChild(fb);
        if (isMe && created_at) {
            var age = (Date.now() - new Date(created_at).getTime())/1000/60;
            if (age < 2) {
                var rb = document.createElement('button'); rb.className = 'recall-btn'; rb.dataset.messageId = id; rb.textContent = t('retract');
                rb.addEventListener('click', e => { e.stopPropagation(); window.recallMessage(id); });
                rb.addEventListener('touchstart', e => { e.stopPropagation(); window.recallMessage(id); }, {passive:false});
                ft.appendChild(rb);
            }
        }
    }
    bubble.appendChild(ft);
    div.appendChild(bubble);
    return div;
}
function findUserByName(name) {
    if (!name) return null;
    var lower = name.toLowerCase();
    if (allMembersCache && allMembersCache.length) {
        for (var i = 0; i < allMembersCache.length; i++) {
            var m = allMembersCache[i];
            if (m && m.display_name && m.display_name.toLowerCase() === lower) {
                return { email: m.email, display_name: m.display_name, avatar_url: m.avatar_url };
            }
            if (m && m.email && m.email.toLowerCase() === lower) {
                return { email: m.email, display_name: m.display_name, avatar_url: m.avatar_url };
            }
        }
    }
    if (currentUserMap) {
        for (var em in currentUserMap) {
            if (!Object.prototype.hasOwnProperty.call(currentUserMap, em)) continue;
            var ui = currentUserMap[em];
            if (!ui) continue;
            if (ui.display_name && ui.display_name.toLowerCase() === lower) {
                return { email: em, display_name: ui.display_name, avatar_url: ui.avatar_url };
            }
            if (em && em.toLowerCase() === lower) {
                return { email: em, display_name: ui.display_name, avatar_url: ui.avatar_url };
            }
        }
    }
    return null;
}
function renderMentionHtml(name) {
    var u = findUserByName(name);
    if (u) {
        return '<span class="mention" data-original-name="'+esc(name)+'" data-display-name="'+esc(u.display_name||name)+'" data-user-email="'+esc(u.email||'')+'" data-user-exists="1" data-mention="1">@'+esc(u.display_name||name)+'</span>';
    }
    return '<span class="mention invalid" data-original-name="'+esc(name)+'" data-user-exists="0">@'+esc(name)+'</span>';
}
function updateMentionsInDOM(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return;
    var all = document.querySelectorAll('.mention');
    for (var i = 0; i < all.length; i++) {
        var n = all[i];
        if (n.getAttribute('data-original-name') === oldName) {
            if (n.getAttribute('data-user-exists') === '1') {
                n.textContent = '@' + newName;
                n.setAttribute('data-display-name', newName);
            }
        }
    }
}
function renderMessageContent(raw) {
    if (!raw) return '';
    var text = raw;
    var quotes = [], images = [], audios = [], videos = [], files = [];
    var mentions = [], links = [], codes = [], strongs = [], ems = [];
    text = text.replace(/\[quote:([^\|\]]+)\|([^\|\]]+)\|([^\|\]]*)\|([^\|\]]+)\|([\s\S]*?)\]/g, (_,a,t,e,id,b) => { quotes.push({author:a,time:t,email:e,messageId:id,body:b}); return '\x00Q'+quotes.length+'Q\x00'; });
    text = text.replace(/\[quote:([^\|\]]+)\|([^\|\]]+)\|([^\|\]]*)\|([\s\S]*?)\]/g, (_,a,t,e,b) => { quotes.push({author:a,time:t,email:e,messageId:'',body:b}); return '\x00Q'+quotes.length+'Q\x00'; });
    // 图片/音频现在也带 |mime|name|size 后缀（老消息没有），所以只取第一段当 URL
    text = text.replace(/!\[image\]\(([^)|]+)(?:\|[^)]*)?\)/g, (_,u) => { images.push(u); return '\x00I'+images.length+'I\x00'; });
    text = text.replace(/\[audio\]\(([^)|]+)(?:\|[^)]*)?\)/g, (_,u) => { audios.push(u); return '\x00A'+audios.length+'A\x00'; });
    text = text.replace(/\[video\]\(([^)]+)\|([^)]*)\|([^)]*)\|([^)]*)\)/g, (_,u,m,n,s) => { videos.push({url:u,mime:m,name:n,size:s}); return '\x00V'+videos.length+'V\x00'; });
    text = text.replace(/\[file\]\(([^)]+)\|([^)]*)\|([^)]*)\|([^)]*)\)/g, (_,u,m,n,s) => { files.push({url:u,mime:m,name:n,size:s}); return '\x00F'+files.length+'F\x00'; });
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_,l,u) => { links.push({label:l,url:u}); return '\x00L'+links.length+'L\x00'; });
    text = text.replace(/(?<!["\x00L])(https?:\/\/[^\s<>"')\]]+)/g, (_,u) => { links.push({label:u,url:u}); return '\x00L'+links.length+'L\x00'; });
    text = text.replace(/`([^`]+)`/g, (_,c) => { codes.push(c); return '\x00C'+codes.length+'C\x00'; });
    text = text.replace(/\*\*([^*]+)\*\*/g, (_,s) => { strongs.push(s); return '\x00S'+strongs.length+'S\x00'; });
    text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_,e) => { ems.push(e); return '\x00E'+ems.length+'E\x00'; });
    text = text.replace(/@(\S+)/g, (_,m) => { mentions.push(m); return '\x00M'+mentions.length+'M\x00'; });
    text = esc(text);
    text = text.replace(/\x00M(\d+)M\x00/g, (_,i) => renderMentionHtml(mentions[parseInt(i)-1] || ''));
    text = text.replace(/\x00L(\d+)L\x00/g, (_,i) => {
        var l = links[parseInt(i)-1];
        var safeUrl = safeLinkUrl(l.url);
        if (!safeUrl) return '<span class="rt-link rt-link-blocked" title="该链接协议不受支持">'+esc(l.label)+'</span>';
        return '<a class="rt-link" href="'+esc(safeUrl)+'" target="_blank" rel="noopener noreferrer">'+esc(l.label)+'</a>';
    });
    text = text.replace(/\x00C(\d+)C\x00/g, (_,i) => '<code>'+esc(codes[parseInt(i)-1])+'</code>');
    text = text.replace(/\x00S(\d+)S\x00/g, (_,i) => '<strong>'+esc(strongs[parseInt(i)-1])+'</strong>');
    text = text.replace(/\x00E(\d+)E\x00/g, (_,i) => '<em>'+esc(ems[parseInt(i)-1])+'</em>');
    text = text.replace(/\n/g, '<br>');
    images.forEach((u,i) => {
        var thumbUrl = u;
        try {
            var uo = new URL(u);
            if (uo.pathname.indexOf('/storage/v1/object/') !== -1 || uo.pathname.indexOf('/storage/v1/render/') !== -1) {
                thumbUrl = u + (u.indexOf('?') === -1 ? '?' : '&') + 'width=200&quality=70';
            }
        } catch(e) {}
        var escapedU = esc(u);
        // 不再把 URL 拼进 onclick（escJs 不做 HTML 属性转义，容易被引号逃逸），
        // 改为从 data-full 读取，彻底消除该注入面
        text = text.replace('\x00I'+(i+1)+'I\x00',
            '<img class="msg-img-thumb" data-full="'+escapedU+'" src="'+esc(thumbUrl)+'" alt="图片" loading="lazy" decoding="async" onclick="window.previewImage(this.getAttribute(\'data-full\'))"/>');
    });
    audios.forEach((u,i) => { text = text.replace('\x00A'+(i+1)+'A\x00', '<audio controls src="'+esc(u)+'" preload="metadata"></audio>'); });
    videos.forEach((v,i) => {
        var escaped = esc(v.url);
        text = text.replace('\x00V'+(i+1)+'V\x00',
            '<div class="file-attachment video"><video controls preload="metadata" src="'+escaped+'"></video></div>');
    });
    files.forEach((f,i) => {
        var sizeBytes = parseInt(f.size)||0;
        var safeUrl = esc(f.url);
        var safeName = esc(f.name || '文件');
        var jsSafeUrl = escJs(f.url);
        var jsSafeName = escJs(f.name || '文件');
        var meta = f.mime ? esc(f.mime) + ' · ' + formatFileSize(sizeBytes) : formatFileSize(sizeBytes);
        var icon = getFileIcon(f.mime, f.name);
        text = text.replace('\x00F'+(i+1)+'F\x00',
            '<a class="file-attachment" href="'+safeUrl+'" target="_blank" rel="noopener" download="'+safeName+'">'+
            '<span class="file-icon">'+icon+'</span>'+
            '<div class="file-info">'+
            '<div class="file-name">'+safeName+'</div>'+
            '<div class="file-meta">'+meta+'</div>'+
            '</div>'+
            '<button class="file-download" type="button" onclick="event.preventDefault();event.stopPropagation();window.downloadFile(\''+jsSafeUrl+'\',\''+jsSafeName+'\');">下载</button>'+
            '</a>');
    });
    quotes.forEach((q,i) => {
        var timeAttr = q.time ? formatTimeShort(q.time) : '';
        text = text.replace('\x00Q'+(i+1)+'Q\x00',
            '<div class="quote-block" data-author="'+esc(q.author)+'" data-time="'+esc(q.time)+'" data-email="'+esc(q.email)+'" data-message-id="'+esc(q.messageId)+'">'+
            '<div class="quote-header"><span class="quote-author">'+esc(q.author)+'</span></div>'+
            '<div class="quote-body">'+esc(q.body)+'</div>'+
            (timeAttr ? '<span class="quote-time">'+timeAttr+'</span>' : '')+'</div>');
    });
    return text;
}

// v3.1.0 文件下载助手（走 fetch 拿到 blob 再触发保存）
window.downloadFile = function(url, name) {
    try {
        fetch(url).then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.blob(); }).then(function(b){
            var a = document.createElement('a');
            a.href = URL.createObjectURL(b);
            a.download = name || (url.split('/').pop() || 'download');
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
        }).catch(function(){ window.open(url, '_blank'); });
    } catch(e) { window.open(url, '_blank'); }
};
// v3.1.0 添加一条消息到底部（同用户5分钟内会并入现有 message-group，避免重复头像/昵称）
function addMessageToBottom(msg) {
    if (!messageList) return;
    // 判断能否并入最近一组
    var lastGroup = messageList.lastElementChild;
    if (lastGroup && lastGroup.classList.contains('message-group')) {
        var lastMsg = lastGroup.lastElementChild;
        var prevEmail = lastMsg && lastMsg.dataset.senderEmail;
        var prevTime = lastMsg && lastMsg.dataset.createdAt;
        var timeDiff = prevTime ? (new Date(msg.created_at) - new Date(prevTime)) : Infinity;
        if (prevEmail && msg.sender_email === prevEmail && timeDiff < 5 * 60 * 1000) {
            // 同组追加
            var el = createMessageElement({ ...msg, _hideHeader: true });
            lastGroup.appendChild(el);
            observeImagesIn(lastGroup);
        } else {
            appendNewGroup(msg);
        }
    } else {
        appendNewGroup(msg);
    }
    // 新鲜进入：更新内部缓存 & 未读标记
    if (!msg.isMe) {
        allLoadedMessages.push(msg);
        if (lastReadMessageId && msg.id && msg.id !== lastReadMessageId) {
            newMessageCount++;
        }
    }
    if (isUserAtBottom) {
        messageList.scrollTop = messageList.scrollHeight;
        markMessagesRead();
    } else {
        unreadCount++;
        document.title = '(' + unreadCount + ') MiniChat';
        updateNewMsgButton();
    }
    updateBottomNavBadge();
    checkVirtualScroll();
}

function appendNewGroup(msg) {
    var dayKey = getDayKey(msg.created_at);
    var msgTime = new Date(msg.created_at).getTime();
    if (lastTimeLabel !== dayKey) {
        var label = document.createElement('div');
        label.className = 'time-label';
        label.dataset.time = msg.created_at;
        label.innerHTML = '<span>' + formatTimeLine(msg.created_at) + '</span>';
        messageList.appendChild(label);
        lastTimeLabel = dayKey;
        lastTimeDivider = msgTime;
    } else if (!lastTimeDivider || (msgTime - lastTimeDivider > 5 * 60 * 1000)) {
        var divider = document.createElement('div');
        divider.className = 'time-divider';
        divider.dataset.time = msg.created_at;
        divider.innerHTML = '<span>' + formatTimeShort(msg.created_at) + '</span>';
        messageList.appendChild(divider);
        lastTimeDivider = msgTime;
    } else {
        lastTimeDivider = msgTime;
    }
    var groupDiv = document.createElement('div');
    groupDiv.className = 'message-group';
    groupDiv.appendChild(createMessageElement(msg));
    if (virtualScrollEnabled) {
        groupDiv.style.contentVisibility = 'auto';
        groupDiv.style.containIntrinsicSize = 'auto 80px';
    }
    messageList.appendChild(groupDiv);
    observeImagesIn(groupDiv);
}
function prependMessages(msgs) {
    if (!messageList) return;
    lastTimeDivider = 0;
    // msgs 已经是按时间正序排列（旧→新）
    var frag = document.createDocumentFragment();
    var groups = groupMessagesForPrepend(msgs);
    groups.forEach(g => {
        var dayKey = getDayKey(g[0].created_at);
        var firstLabel = messageList.firstElementChild;
        if (!firstLabel || (firstLabel.classList.contains('time-label') ? getDayKey(firstLabel.dataset.time || '') !== dayKey : getDayKey(firstLabel.firstElementChild && firstLabel.firstElementChild.dataset && firstLabel.firstElementChild.dataset.createdAt || '') !== dayKey)) {
            var label = document.createElement('div');
            label.className = 'time-label';
            label.dataset.time = g[0].created_at;
            label.innerHTML = '<span>' + formatTimeLine(g[0].created_at) + '</span>';
            frag.appendChild(label);
        }
        var groupDiv = document.createElement('div');
        groupDiv.className = 'message-group';
        g.forEach((m, idx) => { groupDiv.appendChild(createMessageElement({ ...m, _hideHeader: idx > 0 })); });
        frag.appendChild(groupDiv);
    });
    if (messageList.firstChild) messageList.insertBefore(frag, messageList.firstChild);
    else messageList.appendChild(frag);
    observeImagesIn(messageList);
    if (virtualScrollEnabled) applyContentVisibility();
    checkVirtualScroll();
}
// 复用 addMessageToBottom 里的 5 分钟同组规则
function groupMessagesForPrepend(msgs) {
    var groups = [];
    var cur = null;
    msgs.forEach(function(m){
        if (!cur) { cur = [m]; return; }
        var prev = cur[cur.length-1];
        var diff = new Date(m.created_at) - new Date(prev.created_at);
        if (m.sender_email === prev.sender_email && diff < 5*60*1000) cur.push(m);
        else { groups.push(cur); cur = [m]; }
    });
    if (cur) groups.push(cur);
    return groups;
}

// ===================== 新消息按钮 =====================
var newMessagesBtn = document.getElementById('newMessagesBtn');
var newMsgBadge = document.getElementById('newMsgBadge');
var isUserAtBottom = true;

function checkIfAtBottom() {
    if (!messageList) return true;
    var threshold = 50;
    return (messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight) < threshold;
}
function updateNewMsgButton() {
    if (isUserAtBottom) {
        unreadCount = 0;
        document.title = 'MiniChat';
        if (newMessagesBtn) newMessagesBtn.classList.remove('show');
        if (newMsgBadge) newMsgBadge.style.display = 'none';
    } else {
        if (newMessagesBtn) newMessagesBtn.classList.add('show');
        if (newMsgBadge) {
            if (unreadCount > 0) {
                newMsgBadge.textContent = unreadCount;
                newMsgBadge.style.display = 'block';
            } else {
                newMsgBadge.style.display = 'none';
            }
        }
    }
    updateSidebarBadge();
}
function updateSidebarBadge() {
    var badge = document.getElementById('sidebarUnreadBadge');
    if (!badge) return;
    if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        badge.classList.add('show');
    } else {
        badge.classList.remove('show');
    }
}

// ===================== 输入框自动隐藏 =====================
var inputArea = document.querySelector('.input-area');
var lastScrollTop = 0;
var scrollTimeout = null;
var isInputHovered = false;
var isInputFocused = false;
var inputHideMode = 'auto';

function handleInputAutoHide() {
    if (!inputArea) return;
    
    if (inputHideMode === 'always-show') {
        inputArea.classList.remove('hidden-input');
        return;
    }
    
    if (inputHideMode === 'always-hide') {
        inputArea.classList.add('hidden-input');
        return;
    }
    
    if (isInputHovered || isInputFocused) return;
    
    var currentScrollTop = messageList.scrollTop;
    var scrollDirection = currentScrollTop > lastScrollTop ? 'down' : 'up';
    
    if (scrollDirection === 'up' && currentScrollTop > 100) {
        inputArea.classList.add('hidden-input');
    } else if (scrollDirection === 'down') {
        inputArea.classList.remove('hidden-input');
    }
    
    lastScrollTop = currentScrollTop;
    
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(function() {
        if (checkIfAtBottom()) {
            inputArea.classList.remove('hidden-input');
        }
    }, 1500);
}

if (inputArea) {
    inputArea.addEventListener('mouseenter', function() {
        isInputHovered = true;
        if (inputHideMode !== 'always-hide') {
            inputArea.classList.remove('hidden-input');
        }
    });
    
    inputArea.addEventListener('mouseleave', function() {
        isInputHovered = false;
        if (inputHideMode === 'always-hide') {
            inputArea.classList.add('hidden-input');
        }
    });
    
    inputArea.addEventListener('focusin', function() {
        isInputFocused = true;
        if (inputHideMode !== 'always-hide') {
            inputArea.classList.remove('hidden-input');
        }
    });
    
    inputArea.addEventListener('focusout', function() {
        isInputFocused = false;
        if (inputHideMode === 'always-hide') {
            inputArea.classList.add('hidden-input');
        }
    });
}

var inputHideOptions = document.querySelectorAll('.input-hide-option');
inputHideOptions.forEach(function(option) {
    option.addEventListener('click', function() {
        inputHideOptions.forEach(function(opt) {
            opt.classList.remove('active');
        });
        this.classList.add('active');
        inputHideMode = this.getAttribute('data-mode');
        
        if (inputHideMode === 'always-show') {
            inputArea.classList.remove('hidden-input');
        } else if (inputHideMode === 'always-hide') {
            inputArea.classList.add('hidden-input');
        }
    });
});

if (newMessagesBtn) {
    newMessagesBtn.addEventListener('click', function() {
        if (messageList) messageList.scrollTop = messageList.scrollHeight;
        isUserAtBottom = true;
        unreadCount = 0;
        updateNewMsgButton();
        markMessagesRead();
    });
}
if (messageList) {
    messageList.addEventListener('scroll', function() {
        isUserAtBottom = checkIfAtBottom();
        updateNewMsgButton();
        handleInputAutoHide();
    });
}

// ===================== 消息搜索（精简，保留核心逻辑） =====================
var Search = {
    open: false,
    term: '',
    results: [],
    remoteMatches: [],
    serverTotal: 0,
    index: -1,
    debounceId: null,
    refreshTimer: null,
    observer: null,
    observerPaused: false,
    serverSearchToken: 0,
    serverSearching: false,
    loadingHistory: false,
    init: function() {
        this.elBar = searchBar;
        this.elInput = searchInput;
        this.elStatus = searchStatus;
        this.elBtn = searchBtn;
        this.elPrev = searchPrev;
        this.elNext = searchNext;
        this.elClose = searchClose;
        this.elClear = document.getElementById('searchClearInput');
        if (this.elBtn) this.elBtn.addEventListener('click', this.toggle.bind(this));
        if (this.elClose) this.elClose.addEventListener('click', this.close.bind(this));
        if (this.elPrev) this.elPrev.addEventListener('click', this.prev.bind(this));
        if (this.elNext) this.elNext.addEventListener('click', this.next.bind(this));
        if (this.elClear) this.elClear.addEventListener('click', this.clearInput.bind(this));
        if (this.elInput) {
            this.elInput.addEventListener('input', this.onInput.bind(this));
            this.elInput.addEventListener('keydown', this.onKeyDown.bind(this));
        }
        document.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
                if (mainInterface && mainInterface.style.display !== 'none') {
                    e.preventDefault();
                    Search.toggle();
                }
            }
        });
        this.setupObserver();
    },
    setupObserver: function() {
        if (typeof MutationObserver === 'undefined' || !messageList) return;
        var self = this;
        this.observer = new MutationObserver(function() {
            if (self.observerPaused || !self.term || !self.open) return;
            clearTimeout(self.refreshTimer);
            self.refreshTimer = setTimeout(function() {
                if (self.term && self.open) self.runSearch(self.term, true, true);
            }, 300);
        });
        this.observer.observe(messageList, { childList: true, subtree: true });
    },
    withObserverPaused: function(fn) {
        if (this.observer) this.observer.disconnect();
        this.observerPaused = true;
        try { fn(); } finally {
            this.observerPaused = false;
            if (this.observer && this.open && messageList) {
                this.observer.observe(messageList, { childList: true, subtree: true });
            }
        }
    },
    toggle: function() {
        if (this.open) this.close(); else this.openPanel();
    },
    openPanel: function() {
        if (this.open) return;
        this.open = true;
        if (this.elBar) this.elBar.classList.add('open');
        var self = this;
        setTimeout(function() { if (self.elInput) { self.elInput.focus(); if (self.term) self.elInput.select(); } }, 30);
    },
    close: function() {
        if (!this.open) return;
        var self = this;
        this.withObserverPaused(function() {
            self.open = false;
            if (self.elBar) self.elBar.classList.remove('open');
            if (self.elInput) self.elInput.value = '';
            self.setClearVisible(false);
            self.term = '';
            self.results = [];
            self.index = -1;
            self.setStatus('');
            self.clearHighlights();
            self.updateNavButtons();
        });
    },
    clearInput: function() {
        if (this.elInput) this.elInput.value = '';
        this.setClearVisible(false);
        this.runSearchImmediately('');
        if (this.elInput) this.elInput.focus();
    },
    onInput: function() {
        var v = this.elInput ? this.elInput.value : '';
        this.setClearVisible(!!v);
        clearTimeout(this.debounceId);
        var self = this;
        this.debounceId = setTimeout(function() {
            self.runSearch(v, false);
        }, 180);
    },
    runSearchImmediately: function(term) {
        clearTimeout(this.debounceId);
        this.runSearch(term, false);
    },
    onKeyDown: function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (this.results.length > 0) {
                if (e.shiftKey) this.prev(); else this.next();
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this.close();
        } else if (e.key === 'Backspace' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            this.clearInput();
        }
    },
    runSearch: function(term, isRefresh, skipServerSearch) {
        if (!this.open) return;
        var self = this;
        var prevMsg = (this.index >= 0 && this.index < this.results.length) ? this.results[this.index] : null;
        this.withObserverPaused(function() {
            self.clearHighlights();
            self.term = term;
            if (!term || !term.trim()) {
                self.results = [];
                self.index = -1;
                self.remoteMatches = [];
                self.serverTotal = 0;
                self.setStatus('');
                self.updateNavButtons();
                return;
            }
            var matched = self.localSearchAndHighlight(term);
            self.results = matched;
            if (!isRefresh) {
                self.index = -1;
            } else if (prevMsg && matched.indexOf(prevMsg) >= 0) {
                self.index = matched.indexOf(prevMsg);
            } else if (matched.length > 0) {
                self.index = 0;
            } else {
                self.index = -1;
            }
            if (matched.length > 0) {
                self.setStatus(self.formatStatus(), false);
            } else {
                self.index = -1;
                self.setStatus(self.serverSearching ? '搜索中…' : '无结果', !self.serverSearching);
            }
            self.updateNavButtons();
        });
        if (skipServerSearch) return;
        if (!term || !term.trim()) return;
        this.runServerSearch(term);
    },
    localSearchAndHighlight: function(term) {
        var regex = new RegExp(escRegex(term), 'gi');
        var messages = messageList ? messageList.querySelectorAll('.message') : [];
        var matched = [];
        for (var i = 0; i < messages.length; i++) {
            if (highlightInElement(messages[i], regex)) matched.push(messages[i]);
        }
        return matched;
    },
    formatStatus: function() {
        var n = this.results.length;
        if (n === 0) return this.serverSearching ? '搜索中…' : '';
        var total = this.serverTotal;
        var label = (this.index + 1) + ' / ' + n;
        if (total && total > n) label += '  (共 ' + total + ')';
        return label;
    },
    runServerSearch: async function(term) {
        this.serverSearchToken += 1;
        var token = this.serverSearchToken;
        this.serverSearching = true;
        var self = this;
        var remote = [];
        try {
            remote = await searchMessagesRemote(term);
        } catch (e) {
            remote = [];
        }
        if (token !== this.serverSearchToken || !this.open || this.term !== term) {
            if (token === this.serverSearchToken) this.serverSearching = false;
            return;
        }
        this.serverSearching = false;
        this.remoteMatches = remote;
        this.serverTotal = remote.length;
        if (remote.length === 0) {
            this.runSearch(term, true, true);
            return;
        }
        var missing = [];
        for (var i = 0; i < remote.length; i++) {
            var r = remote[i];
            if (!document.querySelector('[data-message-id="' + r.id + '"]')) {
                missing.push(r);
            }
        }
        if (missing.length === 0) {
            this.runSearch(term, true, true);
            return;
        }
        var oldestNeeded = missing[0].created_at;
        for (var j = 1; j < missing.length; j++) {
            if (missing[j].created_at < oldestNeeded) oldestNeeded = missing[j].created_at;
        }
        if (oldestTimestamp && oldestNeeded >= oldestTimestamp) {
            this.runSearch(term, true, true);
            return;
        }
        this.loadingHistory = true;
        this.setStatus('加载历史…', false);
        var lastStatusUpdate = 0;
        try {
            await loadHistoryForSearch(oldestNeeded, function(pages) {
                if (pages - lastStatusUpdate >= 3 || pages === 1) {
                    lastStatusUpdate = pages;
                    self.setStatus('加载历史… (' + (pages * PAGE_SIZE) + '+)', false);
                }
            });
        } catch (e) {
            console.warn('[Search] 加载历史失败:', e);
        }
        if (token !== this.serverSearchToken || !this.open || this.term !== term) return;
        this.loadingHistory = false;
        this.runSearch(term, true, true);
    },
    next: function() {
        if (this.results.length === 0) return;
        if (this.index < 0) this.index = -1;
        if (this.index >= this.results.length - 1) {
            this.setStatus(t('atLastResult') || '已到达最后一个结果', false);
            return;
        }
        this.index++;
        this.setStatus((this.index + 1) + ' / ' + this.results.length, false);
        this.scrollToCurrent();
    },
    prev: function() {
        if (this.results.length === 0) return;
        if (this.index <= 0) {
            this.setStatus(t('atFirstResult') || '已到达第一个结果', false);
            return;
        }
        this.index--;
        this.setStatus((this.index + 1) + ' / ' + this.results.length, false);
        this.scrollToCurrent();
    },
    scrollToCurrent: function() {
        if (this.index < 0 || this.index >= this.results.length) return;
        var prevs = document.querySelectorAll('.search-highlight.current');
        for (var i = 0; i < prevs.length; i++) prevs[i].classList.remove('current');
        var el = this.results[this.index];
        if (!el) return;
        var hl = el.querySelector('.search-highlight');
        if (hl) {
            hl.classList.add('current');
            hl.style.animation = 'none';
            hl.offsetHeight;
            hl.style.animation = '';
            try { hl.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
            catch (e) { hl.scrollIntoView(); }
        }
    },
    updateNavButtons: function() {
        var has = this.results.length > 0;
        if (this.elPrev) this.elPrev.disabled = !has;
        if (this.elNext) this.elNext.disabled = !has;
    },
    clearHighlights: function() {
        var msgs = document.querySelectorAll('.message[data-search-orig]');
        for (var i = 0; i < msgs.length; i++) {
            msgs[i].innerHTML = msgs[i].getAttribute('data-search-orig');
            msgs[i].removeAttribute('data-search-orig');
        }
        var currents = document.querySelectorAll('.search-highlight.current');
        for (var j = 0; j < currents.length; j++) currents[j].classList.remove('current');
    },
    setStatus: function(text, isError) {
        if (!this.elStatus) return;
        this.elStatus.textContent = text;
        if (isError) this.elStatus.classList.add('no-result');
        else this.elStatus.classList.remove('no-result');
    },
    setClearVisible: function(show) {
        if (!this.elClear) return;
        if (show) this.elClear.classList.add('visible');
        else this.elClear.classList.remove('visible');
    }
};
function escRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function highlightInElement(root, regex) {
    if (!root.hasAttribute('data-search-orig')) {
        root.setAttribute('data-search-orig', root.innerHTML);
    }
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function(n) {
            if (!n.parentElement) return NodeFilter.FILTER_REJECT;
            if (n.parentElement.closest('script,style,.search-highlight')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    var textNodes = [];
    var n;
    while ((n = walker.nextNode())) textNodes.push(n);
    var matched = false;
    for (var i = 0; i < textNodes.length; i++) {
        var tn = textNodes[i];
        regex.lastIndex = 0;
        var text = tn.nodeValue;
        if (!regex.test(text)) continue;
        matched = true;
        regex.lastIndex = 0;
        var frag = document.createDocumentFragment();
        var lastIdx = 0;
        var m;
        while ((m = regex.exec(text)) !== null) {
            if (m.index > lastIdx) frag.appendChild(document.createTextNode(text.slice(lastIdx, m.index)));
            var span = document.createElement('span');
            span.className = 'search-highlight';
            span.textContent = m[0];
            frag.appendChild(span);
            lastIdx = m.index + m[0].length;
            if (m[0].length === 0) regex.lastIndex++;
        }
        if (lastIdx < text.length) frag.appendChild(document.createTextNode(text.slice(lastIdx)));
        tn.parentNode.replaceChild(frag, tn);
    }
    return matched;
}
Search.init();

// ===================== 远程搜索 =====================
async function searchMessagesRemote(term) {
    if (!term || !term.trim()) return [];
    if (typeof supabase === 'undefined' || !supabase) return [];
    try {
        var safe = term.replace(/[%_\\]/g, '\\$&');
        // 全局搜索模式：只查全局消息（conversation_id 为 null）
        var res = await supabase
            .from('messages')
            .select('id, content, sender_email, sender_name, created_at')
            .or('conversation_id.is.null,conversation_id.eq.00000000-0000-0000-0000-000000000000')
            .ilike('content', '%' + safe + '%')
            .order('created_at', { ascending: false })
            .limit(200);
        if (res.error) throw res.error;
        return res.data || [];
    } catch (e) {
        console.error('[Search] 远程搜索失败:', e);
        return [];
    }
}
async function loadHistoryForSearch(oldestNeeded, onProgress) {
    var MAX_PAGES = 100;
    var pagesLoaded = 0;
    if (!messageList) return 0;
    var distToBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight;
    var wasNearBottom = distToBottom < 120;
    while (hasMoreMessages && oldestTimestamp && oldestNeeded && oldestTimestamp > oldestNeeded && pagesLoaded < MAX_PAGES) {
        var oldHeight = messageList.scrollHeight;
        await loadHistory(true);
        pagesLoaded++;
        var newHeight = messageList.scrollHeight;
        if (wasNearBottom) {
            messageList.scrollTop = messageList.scrollHeight;
        } else {
            messageList.scrollTop += (newHeight - oldHeight);
        }
        if (typeof onProgress === 'function') onProgress(pagesLoaded);
    }
    return pagesLoaded;
}

// ===================== 引用跳转 =====================
var pendingQuoteData = null;
function openQuoteJumpModal(author, time, email, content, messageId) {
    if (qjAuthor) qjAuthor.textContent = author || '匿名';
    if (qjTime) qjTime.textContent = time ? formatTimeShort(time) : '';
    if (qjContent) qjContent.textContent = content || '[空消息]';
    if (qjStatus) qjStatus.textContent = '';
    pendingQuoteData = { author, time, email: email || '', messageId: messageId || '' };
    if (quoteJumpModal) quoteJumpModal.classList.add('active');
}
function closeQuoteJumpModal() { if (quoteJumpModal) quoteJumpModal.classList.remove('active'); pendingQuoteData = null; }
if (closeQuoteJumpBtn) closeQuoteJumpBtn.addEventListener('click', closeQuoteJumpModal);
if (qjCancel) qjCancel.addEventListener('click', closeQuoteJumpModal);
if (quoteJumpModal) {
    quoteJumpModal.addEventListener('click', e => { if (e.target === quoteJumpModal) closeQuoteJumpModal(); });
}
if (qjJump) {
    qjJump.addEventListener('click', async function() {
        if (!pendingQuoteData) return;
        var data = pendingQuoteData, messageId = data.messageId;
        if (qjStatus) { qjStatus.textContent = t('searching'); qjStatus.className = 'jump-status'; }
        var elements = messageList ? messageList.querySelectorAll('.message') : [];
        var bestMatch = null, targetTime = new Date(data.time).getTime();
        for (var el of elements) {
            if (messageId && el.dataset.messageId === messageId) { bestMatch = el; break; }
            var msgTime = el.dataset.createdAt ? new Date(el.dataset.createdAt).getTime() : NaN;
            if (isNaN(msgTime)) continue;
            var senderEmail = el.dataset.senderEmail || '';
            var senderName = (el.querySelector('.sender .name')?.textContent || '').trim();
            if (data.email && senderEmail === data.email && Math.abs(msgTime - targetTime) < 60000) { bestMatch = el; }
            else if (!data.email && senderName === data.author && Math.abs(msgTime - targetTime) < 60000) { bestMatch = el; }
        }
        if (bestMatch) {
            if (qjStatus) { qjStatus.textContent = t('locatedOriginal'); qjStatus.className = 'jump-status success'; }
            bestMatch.scrollIntoView({behavior:'smooth',block:'center'});
            bestMatch.classList.add('message-highlight');
            setTimeout(() => bestMatch.classList.remove('message-highlight'), 2400);
            setTimeout(closeQuoteJumpModal, 1200);
            return;
        }
        if (messageId) {
            if (qjStatus) { qjStatus.textContent = t('searchingInDb'); qjStatus.className = 'jump-status'; }
            try {
                var { data: msgData } = await supabase.from('messages').select('*').eq('id', messageId).single();
                if (!msgData) { if (qjStatus) { qjStatus.textContent = t('messageDeleted2'); qjStatus.className = 'jump-status error'; } return; }
                var isDeleted = !msgData.sender_email || msgData.sender_email === 'deleted_user';
                var isMe = !isDeleted && msgData.sender_email === currentEmail;
                var info = currentUserMap[msgData.sender_email] || {};
                var displayName = isDeleted ? t('deletedUser') : (msgData.sender_name || info.display_name || msgData.sender_email.split('@')[0]);
                var msgObj = { id: msgData.id, content: msgData.content, sender_name: displayName, sender_email: isDeleted ? '' : msgData.sender_email, isMe, time: formatTimeShort(msgData.created_at), created_at: msgData.created_at };
                if (!currentUserMap[msgData.sender_email]) currentUserMap[msgData.sender_email] = { display_name: displayName };
                var newEl = createMessageElement(msgObj);
                if (messageList) {
                    if (messageList.firstChild) messageList.insertBefore(newEl, messageList.firstChild);
                    else messageList.appendChild(newEl);
                }
                if (qjStatus) { qjStatus.textContent = t('foundAndLoaded'); qjStatus.className = 'jump-status success'; }
                newEl.scrollIntoView({behavior:'smooth',block:'center'});
                newEl.classList.add('message-highlight');
                setTimeout(() => newEl.classList.remove('message-highlight'), 2400);
                setTimeout(closeQuoteJumpModal, 1500);
            } catch(err) { if (qjStatus) { qjStatus.textContent = t('networkError'); qjStatus.className = 'jump-status error'; } }
            return;
        }
        if (qjStatus) { qjStatus.textContent = t('originalNotFound'); qjStatus.className = 'jump-status error'; }
    });
}

// ===================== 右键菜单 =====================
if (ctxMention) {
    ctxMention.addEventListener('click', () => {
        var targetName = contextMenu ? contextMenu.dataset.targetName : '';
        if (targetName) insertAtCursor('@' + targetName + ' ');
        if (contextMenu) contextMenu.classList.remove('active');
    });
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && contextMenu) contextMenu.classList.remove('active'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && customModal && customModal.classList.contains('active')) closeCustomModal(); });
document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    var activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && !activeEl.readOnly) return;
    if (quoteJumpModal && quoteJumpModal.classList.contains('active')) { closeQuoteJumpModal(); return; }
    if (settingsOverlay && settingsOverlay.classList.contains('active')) { closeSettingsFunc(); return; }
    if (uploadOverlay && uploadOverlay.classList.contains('active')) { hideUploadOverlay(); if (fileInput) fileInput.value = ''; return; }
    if (profileCard && profileCard.classList.contains('active')) { profileCard.classList.remove('active'); return; }
    if (mobileActionSheet && mobileActionSheet.classList.contains('active')) { closeMobileActionSheet(); return; }
    if (termsOverlay && termsOverlay.classList.contains('active')) { termsOverlay.classList.remove('active'); return; }
    if (versionUpdateModal && versionUpdateModal.classList.contains('active')) { versionUpdateModal.classList.remove('active'); return; }
    if (allMembersModal && allMembersModal.classList.contains('active')) { allMembersModal.classList.remove('active'); return; }
    if (onlineModal && onlineModal.classList.contains('active')) { onlineModal.classList.remove('active'); return; }
    var imgOverlay = document.querySelector('.img-preview-overlay');
    if (imgOverlay) { imgOverlay.remove(); return; }
});

// ===================== 用户资料 =====================
async function fetchUserProfiles(emails) {
    if (!emails.length) return {};
    var data = (await supabase.from('profiles').select('email,display_name,avatar_url').in('email', emails)).data || [];
    var m = {};
    data.forEach(r => { m[r.email] = { display_name: r.display_name, avatar_url: r.avatar_url }; });
    return m;
}
function showUserProfile(email) { showProfileCard(email); }
// v3.1.0 资料卡：昵称 / 邮箱 / 注册时间 / 消息总数 / 在线状态（在线 - 在线；离线 - 5分钟内 - 最近活跃）
function showProfileCard(email) {
    if (!email || !profileCard) return;
    var info = currentUserMap[email] || {};
    if (email === currentEmail) info = Object.assign({}, info, { display_name: currentDisplayName, avatar_url: currentAvatarUrl });
    var ou = Object.values(onlineUsers).find(u => u.email === email);
    var statusText = '离线', statusClass = 'offline';
    if (ou) { statusText = '在线'; statusClass = 'online'; }
    else if (info.last_seen && (Date.now() - new Date(info.last_seen).getTime() < 5 * 60 * 1000)) {
        statusText = '最近活跃'; statusClass = 'recent';
    }
    if (profileCardAvatar) {
        profileCardAvatar.src = getAvatarUrl(email);
        profileCardAvatar.loading = 'eager';
        profileCardAvatar.onerror = function(){ handleAvatarError(this, email); };
    }
    if (profileCardName) profileCardName.textContent = info.display_name || email.split('@')[0];
    if (profileCardEmail) profileCardEmail.textContent = email;
    if (profileCardStatus) {
        profileCardStatus.textContent = statusText;
        profileCardStatus.className = 'status ' + statusClass;
    }
    if (profileCardJoined) profileCardJoined.textContent = t('joinedAt') + ': ' + (info.created_at ? formatTime(info.created_at) : t('unknown'));
    if (profileCardMessages) profileCardMessages.textContent = t('messagesCount') + ': ' + t('loading');
    profileCard.classList.add('active');
    // 取注册时间和消息总数
    try {
        supabase.from('profiles').select('created_at').eq('email', email).maybeSingle().then(function(res){
            if (res && res.data && res.data.created_at && profileCardJoined) {
                profileCardJoined.textContent = t('joinedAt') + ': ' + formatTime(res.data.created_at);
                info.created_at = res.data.created_at;
                currentUserMap[email] = Object.assign({}, currentUserMap[email] || {}, { created_at: res.data.created_at });
            }
        });
    } catch(e) {}
    try {
        supabase.from('messages').select('id', { count: 'exact' }).eq('sender_email', email).then(function(res){
            if (res && res.count !== null && profileCardMessages) profileCardMessages.textContent = t('messagesCount') + ': ' + res.count;
        });
    } catch(e) {}
}

// ===================== 显示名称 =====================
async function loadDisplayName() {
            if (!currentUserId) return;
            try {
                var data = (await supabase.from('profiles').select('display_name,avatar_url').eq('id', currentUserId).single()).data;
                if (data) { currentDisplayName = data.display_name || currentEmail.split('@')[0]; currentAvatarUrl = data.avatar_url || getDefaultAvatar(currentEmail); }
                else { currentDisplayName = currentEmail.split('@')[0]; currentAvatarUrl = getDefaultAvatar(currentEmail); }
            } catch(e) { currentDisplayName = currentEmail.split('@')[0]; currentAvatarUrl = getDefaultAvatar(currentEmail); }
            currentUserMap[currentEmail] = { avatar_url: currentAvatarUrl, display_name: currentDisplayName };
            delete failedAvatars[currentEmail];
            avatarCache = {};
            if (displayNameInput) displayNameInput.value = currentDisplayName;
            if (sidebarUserEmail) sidebarUserEmail.textContent = currentDisplayName;
            if (sidebarUserAvatar) {
                sidebarUserAvatar.src = currentAvatarUrl;
                sidebarUserAvatar.loading = 'eager';
                sidebarUserAvatar.onerror = function() { handleAvatarError(this, currentEmail); };
            }
            if (avatarPreview) {
                avatarPreview.src = currentAvatarUrl;
                avatarPreview.loading = 'eager';
                avatarPreview.onerror = function() { handleAvatarError(this, currentEmail); };
            }
            refreshAllAvatars(currentEmail, currentAvatarUrl);
        }
async function saveDisplayName() {
    if (!displayNameInput) return;
    var n = displayNameInput.value.trim();
    if (!n) { showAlert(t('nicknameEmpty'), 'error'); return; }
    if (n.length > 20) { showAlert(t('nicknameTooLong'), 'error'); return; }
    showLoading(t('saving'));
    try {
        var error = (await supabase.from('profiles').update({ display_name: n }).eq('id', currentUserId)).error;
        if (error) { if (error.message.includes('duplicate')) { showAlert(t('nicknameUsed'), 'error'); } else throw error; closeCustomModal(); return; }
        await supabase.from('messages').update({ sender_name: n }).eq('sender_email', currentEmail);
        currentDisplayName = n;
        if (sidebarUserEmail) sidebarUserEmail.textContent = n;
        currentUserMap[currentEmail].display_name = n;
        if (presenceChannel) {
            try { await presenceChannel.track({ user_id: currentUserId, email: currentEmail, display_name: n, avatar_url: currentAvatarUrl, online_at: new Date().toISOString() }); } catch(e) {}
        }
        refreshMessages();
        closeCustomModal();
        showAlert(t('nicknameSaved'), 'success');
    } catch(e) { console.error(e); closeCustomModal(); showAlert(t('saveFailed'), 'error'); }
}

// ===================== 头像上传 =====================
// 把 email 安全地放进 CSS 属性选择器
function avatarSelectorValue(v) {
    return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
function refreshAllAvatars(email, newUrl) {
            // v3.1.1：先清除失败标记，保证后续 bustCache 能正确生成新 URL
            delete failedAvatars[email];
            // 所有渲染头像的地方都会写 data-sender-email（消息列表、在线/全部成员列表、
            // @提及下拉……），统一按这个属性刷新，避免只更新消息列表、其他地方要刷新页面才变
            var sel = 'img[data-sender-email="' + avatarSelectorValue(email) + '"]';
            function applyAvatar(url) {
                document.querySelectorAll(sel).forEach(function(img){
                    if (img.dataset.avatarErrorHandled === 'true') return;
                    // 在线列表是懒加载：src 为空时只等进入视口后再取 originalSrc
                    if (img.dataset.originalSrc !== undefined) img.dataset.originalSrc = url;
                    if (img.getAttribute('src')) img.src = bustCache(url);
                    img.onerror = function() { handleAvatarError(this, email); };
                });
                // 关键：getAvatarUrl 会优先取 onlineUsers 里的 avatar_url，
                // 不同步这里的话，资料卡等"重新计算头像"的地方会一直拿到旧头像
                Object.keys(onlineUsers).forEach(function(id){
                    if (onlineUsers[id] && onlineUsers[id].email === email) onlineUsers[id].avatar_url = url;
                });
                if (email === currentEmail) {
                    if (sidebarUserAvatar) {
                        sidebarUserAvatar.src = bustCache(url);
                        sidebarUserAvatar.onerror = function() { handleAvatarError(this, email); };
                    }
                    if (avatarPreview) {
                        avatarPreview.src = bustCache(url);
                        avatarPreview.onerror = function() { handleAvatarError(this, email); };
                    }
                }
                if (profileCard && profileCard.classList.contains('active') && profileCardEmail &&
                    profileCardEmail.textContent === email && profileCardAvatar) {
                    profileCardAvatar.src = bustCache(url);
                    profileCardAvatar.onerror = function() { handleAvatarError(this, email); };
                }
            }
            // 预加载新头像，避免 NS_BINDING_ABORTED
            var preloadImg = new Image();
            preloadImg.onload = function() { applyAvatar(newUrl); };
            preloadImg.onerror = function() {
                failedAvatars[email] = true;
                document.querySelectorAll(sel).forEach(function(img){
                    if (img.dataset.avatarErrorHandled === 'true') return;
                    if (img.getAttribute('src')) img.src = getDefaultAvatar(email);
                    img.onerror = null;
                });
            };
            preloadImg.src = newUrl;
        }
async function uploadAvatar(file) {
            if (!currentUserId) { showAlert(t('pleaseLogin'), 'error'); return; }
            if (!file || !file.type.startsWith('image/')) { showAlert(t('pleaseSelectImage'), 'error'); return; }
            // 统一裁成正方形：FloxChat 侧的群头像/用户头像规格是 150×150 正方形，
            // 非正方形图在那边会被拉伸变形，而且尺寸不一致会导致显示大小忽大忽小。
            var pf = file;
            try { pf = await cropAvatar(file, 300); } catch(e) { pf = file; }
            if (pf.size > 5*1024*1024) { showAlert(t('imageTooLargeMsg'), 'error'); return; }
            showLoading(t('uploading'));
            try {
                var ext = pf.name.split('.').pop(), fn = 'avatar_'+currentUserId+'_'+Date.now()+'.'+ext, fp = 'public/'+fn;
                var ue = (await supabase.storage.from('avatars').upload(fp, pf, { cacheControl:'0', upsert:true })).error;
                if (ue) throw ue;
                var pub = supabase.storage.from('avatars').getPublicUrl(fp).data.publicUrl;
                var ue2 = (await supabase.from('profiles').update({ avatar_url: pub }).eq('id', currentUserId)).error;
                if (ue2) throw ue2;
                currentAvatarUrl = pub;
                currentUserMap[currentEmail].avatar_url = pub;
                delete failedAvatars[currentEmail];
                avatarCache = {};
                refreshAllAvatars(currentEmail, pub);
                if (avatarPreview) {
                    avatarPreview.src = getAvatarUrl(currentEmail);
                    avatarPreview.onerror = function() { handleAvatarError(this, currentEmail); };
                }
                if (presenceChannel) {
                    try { await presenceChannel.track({ user_id: currentUserId, email: currentEmail, display_name: currentDisplayName, avatar_url: pub, online_at: new Date().toISOString() }); } catch(e) {}
                }
                closeCustomModal();
                showAlert(t('avatarUpdated'), 'success');
            } catch(err) { console.error(err); closeCustomModal(); showAlert(t('uploadFailedMsg'), 'error'); }
        }
// 等比压缩（聊天图片附件用，不裁剪、保留长宽比）
function compressImage(file, mw, q) {
    return new Promise((res,rej) => {
        var r = new FileReader();
        r.onload = e => {
            var img = new Image();
            img.onload = () => {
                var c = document.createElement('canvas');
                var w = img.width, h = img.height;
                if (w > mw) { h = h * (mw/w); w = mw; }
                c.width = w; c.height = h;
                c.getContext('2d').drawImage(img, 0, 0, w, h);
                c.toBlob(b => { if (!b) rej(new Error('压缩失败')); else res(new File([b], file.name, {type:'image/jpeg'})); }, 'image/jpeg', q);
            };
            img.onerror = rej;
            img.src = e.target.result;
        };
        r.onerror = rej;
        r.readAsDataURL(file);
    });
}

// 居中裁剪成正方形并缩放：头像统一存 300×300 正方形
// （FloxChat 那边会用桥接扩展再压到 150×150，正好是它的头像规格）
function cropAvatar(file, size) {
    return new Promise((res,rej) => {
        var r = new FileReader();
        r.onload = e => {
            var img = new Image();
            img.onload = () => {
                var s = Math.min(img.width, img.height);   // 取短边做正方形
                var c = document.createElement('canvas');
                c.width = size; c.height = size;
                c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
                c.toBlob(b => { if (!b) rej(new Error('裁剪失败')); else res(new File([b], 'avatar.jpg', {type:'image/jpeg'})); }, 'image/jpeg', 0.9);
            };
            img.onerror = rej;
            img.src = e.target.result;
        };
        r.onerror = rej;
        r.readAsDataURL(file);
    });
}

// ===================== 附件 =====================
function addQuoteAttachment(senderName, senderEmail, content, isoTime, messageId) {
    var plain = (content || '').replace(/!\[image\]\([^)]*\)/g,'[图片]').replace(/\[audio\]\([^)]*\)/g,'[音频]').replace(/\[quote:[^\]]*\]/g,'').trim() || '[空消息]';
    plain = plain.split('\n')[0].substring(0, 100);
    attachments.push({ id: 'quote-'+Date.now(), type:'quote', quoteAuthor: senderName || '匿名', quoteEmail: senderEmail || '', quoteText: plain, quoteIsoTime: isoTime || new Date().toISOString(), quoteMessageId: messageId || '' });
    renderAttachments();
    if (chatInput) chatInput.focus();
}
function renderAttachments() {
    if (!attachmentArea) return;
    attachmentArea.innerHTML = '';
    attachments.forEach((att, idx) => {
        var item = document.createElement('div');
        if (att.type === 'quote') {
            item.className = 'attachment-item quote-attachment';
            var iconWrap = document.createElement('span'); iconWrap.className = 'qa-icon';
            iconWrap.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>';
            var content = document.createElement('div'); content.className = 'qa-content';
            var lbl = document.createElement('span'); lbl.className = 'qa-label'; lbl.textContent = t('quoteLabel');
            var auth = document.createElement('span'); auth.className = 'qa-author'; auth.textContent = att.quoteAuthor;
            var txt = document.createElement('span'); txt.className = 'qa-text'; txt.textContent = att.quoteText;
            content.appendChild(lbl); content.appendChild(auth); content.appendChild(txt);
            item.appendChild(iconWrap); item.appendChild(content);
            var rb = document.createElement('button'); rb.className = 'remove-attach'; rb.textContent = '×';
            rb.addEventListener('click', e => { e.stopPropagation(); attachments.splice(idx,1); renderAttachments(); });
            item.appendChild(rb);
        } else if (att.type === 'image') {
            item.className = 'attachment-item';
            var img = document.createElement('img'); img.src = att.url || URL.createObjectURL(att.file); item.appendChild(img);
            var ns = document.createElement('span'); ns.className = 'file-name'; ns.textContent = att.name || '图片'; item.appendChild(ns);
            if (att.existing) { var lk = document.createElement('span'); lk.textContent = '🔒'; item.appendChild(lk); }
            else { var rb = document.createElement('button'); rb.className = 'remove-attach'; rb.textContent = '×'; rb.addEventListener('click', e => { e.stopPropagation(); attachments.splice(idx,1); renderAttachments(); }); item.appendChild(rb); }
        } else {
            // v3.1.0 统一附件渲染（音频 / 视频 / 文档）
            item.className = 'attachment-item';
            var icon = document.createElement('span'); icon.className = 'file-icon'; icon.textContent = getFileIcon(att.mime, att.name) + ' ';
            item.appendChild(icon);
            var ns2 = document.createElement('span'); ns2.className = 'file-name'; ns2.textContent = att.name || '文件'; item.appendChild(ns2);
            if (att.size) { var ms = document.createElement('span'); ms.style.cssText = 'font-size:11px;color:var(--text-muted);margin-left:auto;'; ms.textContent = formatFileSize(att.size); item.appendChild(ms); }
            if (att.existing) item.innerHTML += '<span>🔒</span>';
            else { var rb = document.createElement('button'); rb.className = 'remove-attach'; rb.textContent = '×'; rb.addEventListener('click', e => { e.stopPropagation(); attachments.splice(idx,1); renderAttachments(); }); item.appendChild(rb); }
        }
        attachmentArea.appendChild(item);
    });
    adjustMobileMessagePadding();
}
function addAttachment(file) {
    var t = '';
    var fileType = file.type || '';
    var fileName = file.name || '';
    if (fileType.startsWith('image/')) t = 'image';
    else if (fileType.startsWith('audio/')) t = 'audio';
    else if (fileType.startsWith('video/')) t = 'video';
    else if (fileType === 'application/pdf' || /\.pdf$/i.test(fileName)) t = 'pdf';
    else if (/word|document|\.docx?$/i.test(fileType) || /\.docx?$/i.test(fileName)) t = 'doc';
    else if (/excel|spreadsheet|\.xlsx?$/i.test(fileType) || /\.xlsx?$/i.test(fileName)) t = 'xls';
    else if (/presentation|\.pptx?$/i.test(fileType) || /\.pptx?$/i.test(fileName)) t = 'ppt';
    else if (fileType.startsWith('text/') || /\.txt$/i.test(fileName)) t = 'text';
    else if (/zip|archive|\.(zip|rar|7z)$/i.test(fileName)) t = 'zip';
    else { setAuthMessage('暂不支持该文件类型','error'); setTimeout(() => setAuthMessage(''), 2000); return; }
    var limitMap = { image: 5*1024*1024, audio: 20*1024*1024, video: 50*1024*1024, pdf: 10*1024*1024, doc: 10*1024*1024, xls: 10*1024*1024, ppt: 10*1024*1024, text: 5*1024*1024, zip: 20*1024*1024 };
    var max = limitMap[t] || 10*1024*1024;
    if (file.size > max) { setAuthMessage('文件超过大小限制（' + formatFileSize(max) + '）','error'); setTimeout(() => setAuthMessage(''), 2000); return; }
    attachments.push({ id: Date.now()+Math.random(), file, type: t, name: file.name, size: file.size, mime: file.type });
    renderAttachments();
}
async function uploadNewAttachments(list) {
    if (!list.length) return [];
    return await Promise.all(list.map(async att => {
        var pf = att.file;
        if (att.type === 'image' && att.file.size > 200*1024) try { pf = await compressImage(att.file, 1080, 0.7); } catch(e) {}
        var ext = pf.name.split('.').pop() || 'bin';
        var safeName = Date.now()+'_'+Math.random().toString(36).slice(2,7)+'.'+ext;
        var fp = 'public/'+safeName;
        var bucket = ({image:'chat-images',audio:'chat-audios',video:'chat-videos',pdf:'chat-files',doc:'chat-files',xls:'chat-files',ppt:'chat-files',text:'chat-files',zip:'chat-files'})[att.type] || 'chat-files';
        var error = (await supabase.storage.from(bucket).upload(fp, pf, { cacheControl:'3600', upsert: false })).error;
        if (error) throw error;
        var url = supabase.storage.from(bucket).getPublicUrl(fp).data.publicUrl;
        // 文档类型以 [file:URL|mime|name|size] 形式存储
        // ⚠️ 大小一律用 pf.size（实际上传的那个 blob）—— 图片超过 200KB 会被 compressImage 压过，
        // 用 att.file.size 会报出原始大小，和服务器上的对不上。
        var realSize = (pf && typeof pf.size === 'number') ? pf.size : att.file.size;
        // 图片/音频现在也带上 |mime|name|size，桥接方（FloxChat）就能显示大小了
        if (att.type === 'image') return '![image]('+url+'|'+esc(att.mime||'image/png')+'|'+esc(att.name||'image')+'|'+realSize+')';
        if (att.type === 'audio') return '[audio]('+url+'|'+esc(att.mime||'audio/mpeg')+'|'+esc(att.name||'audio')+'|'+realSize+')';
        if (att.type === 'video') return '[video]('+url+'|'+esc(att.mime||'video/mp4')+'|'+esc(att.name||'video.mp4')+'|'+realSize+')';
        return '[file]('+url+'|'+esc(att.mime||'application/octet-stream')+'|'+esc(att.name||'file')+'|'+realSize+')';
    }));
}

// ===================== 发送消息 =====================
async function sendMessageContent(content) {
            if (!currentEmail) return;
            var text = (content || '').trim();
            var hasText = text.length > 0, hasNew = attachments.some(a => !a.existing);
            if (!hasText && !hasNew) return;
            // v3.1.1 敏感词检查（原始用户输入 text，而非 fc 拼接后的内容）
            if (hasText && !checkSensitive(text)) {
                isSending = false;
                if (btnSend) btnSend.disabled = false;
                if (chatInput) chatInput.disabled = false;
                return;
            }
            var now = Date.now();
            if (now - lastSendTime < MIN_SEND_INTERVAL) { setAuthMessage(t('sendTooFast'),'error'); setTimeout(() => setAuthMessage(''), 1500); return; }
            if (isSending) return;
            isSending = true; lastSendTime = now;
            if (btnSend) btnSend.disabled = true;
            if (chatInput) chatInput.disabled = true;
            var senderName = currentDisplayName || currentEmail.split('@')[0];
            try {
                var fc = text;
                attachments.filter(a => a.type === 'quote').forEach(q => {
                    fc = '[quote:'+q.quoteAuthor+'|'+q.quoteIsoTime+(q.quoteEmail?'|'+q.quoteEmail:'')+(q.quoteMessageId?'|'+q.quoteMessageId:'')+'|'+q.quoteText+']\n' + fc;
                });
                var na = attachments.filter(a => !a.existing && a.type !== 'quote');
                var nmd = await uploadNewAttachments(na);
                if (nmd.length) { if (fc) fc += '\n'; fc += nmd.join('\n'); }
                if (!fc.trim()) { isSending = false; if (btnSend) btnSend.disabled = false; if (chatInput) chatInput.disabled = false; return; }
                var mentions = text.match(/@(\S+)/g) || [];
                var mentionedIds = [];
                for (var id in onlineUsers) {
                    var u = onlineUsers[id];
                    if (u.email === currentEmail) continue;
                    if (mentions.some(m => u.display_name?.includes(m.slice(1)) || u.email?.includes(m.slice(1)))) mentionedIds.push(id);
                }
                if (mentionedIds.length && window.chatChannel) window.chatChannel.send({ type:'broadcast', event:'mention', payload:{ from: senderName, users: mentionedIds } });
                var tempId = 'temp-'+Date.now();
                addMessageToBottom({ id: tempId, content: fc, sender_name: senderName, sender_email: currentEmail, isMe: true, time: formatTimeShort(new Date().toISOString()), created_at: new Date().toISOString() });
                if (chatInput) { chatInput.value = ''; localStorage.removeItem('minichat_draft'); attachments = []; renderAttachments(); autoResizeTextarea(); }
                // 全局模式：直接插入消息，不写 conversation_id（默认 null）
                var insertObj = {
                    content: fc,
                    sender_name: senderName,
                    sender_email: currentEmail
                };
                var res = await supabase.from('messages').insert(insertObj).select().single();
                if (res.error) throw res.error;
                var data = res.data;
                if (data && messageList) {
                    var te = messageList.querySelector('[data-message-id="'+tempId+'"]');
                    if (te) te.replaceWith(createMessageElement({ id: data.id, content: data.content, sender_name: data.sender_name || senderName, sender_email: data.sender_email || currentEmail, isMe: true, time: formatTimeShort(data.created_at), created_at: data.created_at }));
                }
            } catch(err) {
                console.error(err);
                if (text && chatInput) { chatInput.value = text; localStorage.setItem('minichat_draft', text); autoResizeTextarea(); }
                setAuthMessage(t('sendFailed') + (err.message || t('unknownError')),'error');
                if (messageList) {
                    var te = messageList.querySelector('[data-message-id^="temp-"]');
                    if (te) te.remove();
                }
            } finally { isSending = false; if (btnSend) btnSend.disabled = false; if (chatInput) chatInput.disabled = false; }
        }
window.recallMessage = async function(mid) {
    if (!mid) return;
    showConfirm(t('recallConfirm'), async function() {
        try {
            var error = (await supabase.from('messages').update({ content: '（' + t('retracted') + '）' }).eq('id', mid).eq('sender_email', currentEmail)).error;
            if (error) setAuthMessage(t('recallFailed'),'error');
        } catch(e) { console.error(e); }
    });
};

// ===================== 在线状态 =====================
var totalMemberCount = 0;
function updateOnlineUI() {
    if (onlineBadge) { onlineBadge.textContent = onlineCount; onlineBadge.classList.toggle('show', onlineCount > 0); }
    if (allMembersNum) allMembersNum.textContent = '(' + totalMemberCount + ')';
    updateAllMembersIfOpen();
    updateBottomNavBadge();
    if (onlineStatus) {
        onlineStatus.textContent = '● '+t('onlineCount').replace('{count}', onlineCount);
        onlineStatus.style.color = '';
    }
}
function updateAllMembersIfOpen() {
    if (!allMembersModal || !allMembersModal.classList.contains('active')) return;
    if (!allMembersCache.length) return;
    renderAllMembers(allMembersCache);
}
function groupMembersByStatus(members) {
    var onlineEmails = {};
    Object.keys(onlineUsers).forEach(function(id) {
        var u = onlineUsers[id];
        if (u && u.email) onlineEmails[u.email] = true;
    });
    var onlineList = [];
    var offlineList = [];
    (members || []).forEach(function(m) {
        if (m.email && onlineEmails[m.email]) onlineList.push(m);
        else offlineList.push(m);
    });
    return { online: onlineList, offline: offlineList };
}
async function fetchAllMembers() {
    if (!supabase) return [];
    try {
        var result = await supabase.from('profiles')
            .select('id,email,display_name,avatar_url,created_at')
            .order('display_name', { ascending: true });
        if (result.error) throw result.error;
        var members = result.data || [];
        totalMemberCount = members.length;
        members.forEach(function(m) { if (m.email) currentUserMap[m.email] = { display_name: m.display_name, avatar_url: m.avatar_url }; });
        updateOnlineUI();
        return members;
    } catch (e) { console.error('fetchAllMembers failed:', e); return []; }
}
var allMembersCache = [];
var allMembersVirtualList = {
    container: null,
    list: null,
    spacer: null,
    rows: [],
    itemHeight: 44,
    sectionHeight: 28,
    visibleStart: 0,
    visibleEnd: 0,
    init: function() {
        if (!allMembersList) return;
        allMembersList.innerHTML = '';
        var container = document.createElement('div');
        container.className = 'virtual-scroll-container';
        var list = document.createElement('div');
        list.className = 'virtual-scroll-list';
        var spacer = document.createElement('div');
        spacer.className = 'virtual-scroll-spacer';
        list.appendChild(spacer);
        container.appendChild(list);
        allMembersList.appendChild(container);
        this.container = container;
        this.list = list;
        this.spacer = spacer;
        var self = this;
        this.container.addEventListener('scroll', function() { self.updateVisible(); });
    },
    buildRows: function(grouped) {
        var rows = [];
        var onlineArr = (grouped && grouped.online) || [];
        var offlineArr = (grouped && grouped.offline) || [];
        if (onlineArr.length) {
            rows.push({ type: 'section', key: 'online', label: t('onlineSection') + ' (' + onlineArr.length + ')', cls: 'members-section-header' });
            onlineArr.forEach(function(m) { rows.push({ type: 'item', data: m, key: (m.email || '') + '-o' }); });
        }
        if (offlineArr.length) {
            rows.push({ type: 'section', key: 'offline', label: t('offlineSection') + ' (' + offlineArr.length + ')', cls: 'members-section-header offline-header' });
            offlineArr.forEach(function(m) { rows.push({ type: 'item', data: m, key: (m.email || '') + '-f' }); });
        }
        return rows;
    },
    rowHeight: function(row) { return row && row.type === 'section' ? this.sectionHeight : this.itemHeight; },
    updateVisible: function() {
        if (!this.container || !this.list || this.rows.length === 0) return;
        var scrollTop = this.container.scrollTop;
        var viewHeight = this.container.clientHeight;
        var acc = 0;
        var start = 0, end = this.rows.length;
        for (var i = 0; i < this.rows.length; i++) {
            var h = this.rowHeight(this.rows[i]);
            if (acc + h > scrollTop && start === 0 && i > 0) start = Math.max(0, i - 2);
            if (acc > scrollTop + viewHeight) { end = Math.min(this.rows.length, i + 2); break; }
            acc += h;
        }
        this.visibleStart = start;
        this.visibleEnd = end;
        this.renderVisible();
    },
    renderVisible: function() {
        var existing = this.list.querySelectorAll('.online-user-item, .members-section-header');
        existing.forEach(function(el) { el.remove(); });
        var topAcc = 0;
        for (var i = 0; i < this.visibleStart; i++) topAcc += this.rowHeight(this.rows[i]);
        var lastSection = null;
        for (var j = 0; j < this.visibleStart; j++) {
            if (this.rows[j] && this.rows[j].type === 'section') lastSection = this.rows[j].key;
        }
        for (var j = this.visibleStart; j < this.visibleEnd; j++) {
            var row = this.rows[j];
            if (!row) continue;
            var el;
            if (row.type === 'section') {
                el = document.createElement('div');
                el.className = row.cls || 'members-section-header';
                el.textContent = row.label;
                lastSection = row.key;
            } else {
                el = this.createItemElement(row.data, lastSection === 'online');
            }
            el.style.position = 'absolute';
            el.style.top = topAcc + 'px';
            el.style.left = '0';
            el.style.width = '100%';
            el.style.height = this.rowHeight(row) + 'px';
            this.list.appendChild(el);
            topAcc += this.rowHeight(row);
        }
    },
    createItemElement: function(m, isOnline) {
        var email = m.email || '';
        var displayName = m.display_name || email.split('@')[0] || '匿名';
        var it = document.createElement('div'); it.className = 'online-user-item';
        var avatar = document.createElement('img'); avatar.className = 'avatar-small';
        avatar.loading = 'lazy';
        avatar.dataset.senderEmail = email;
        avatar.dataset.originalSrc = getAvatarUrl(email);
        avatar.src = '';
        avatar.onerror = function() { handleAvatarError(this, email); };
        avatar.addEventListener('click', function(e) { e.stopPropagation(); showUserProfile(email); });
        var self = this;
        var observer = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting && avatar.dataset.originalSrc) {
                    avatar.src = avatar.dataset.originalSrc;
                    observer.disconnect();
                }
            });
        }, { root: self.container, rootMargin: '50px' });
        observer.observe(avatar);
        var dot = document.createElement('span'); dot.className = 'online-dot';
        dot.style.background = isOnline ? 'var(--success)' : 'var(--text-muted)';
        var info = document.createElement('div'); info.className = 'online-user-info';
        var name = document.createElement('span'); name.className = 'online-user-name'; name.textContent = displayName;
        var em = document.createElement('span'); em.className = 'online-user-email'; em.textContent = email || '';
        info.appendChild(name); info.appendChild(em);
        it.appendChild(avatar); it.appendChild(dot); it.appendChild(info);
        return it;
    },
    setItems: function(grouped) {
        this.rows = this.buildRows(grouped);
        var total = 0;
        for (var i = 0; i < this.rows.length; i++) total += this.rowHeight(this.rows[i]);
        if (this.spacer) this.spacer.style.height = total + 'px';
        this.visibleStart = 0;
        this.visibleEnd = Math.min(this.rows.length, Math.ceil((this.container ? this.container.clientHeight : 350) / this.itemHeight) + 4);
        this.renderVisible();
        if (this.container) this.container.scrollTop = 0;
    }
};
function renderAllMembers(members) {
    if (!allMembersList) return;
    allMembersCache = members || [];
    var searchTerm = memberSearchInput ? memberSearchInput.value.trim().toLowerCase() : '';
    var filtered = allMembersCache;
    if (searchTerm) {
        filtered = allMembersCache.filter(function(m) {
            var name = (m.display_name || '').toLowerCase();
            var email = (m.email || '').toLowerCase();
            return name.includes(searchTerm) || email.includes(searchTerm);
        });
    }
    var grouped = groupMembersByStatus(filtered);
    var totalCount = filtered.length;
    var onlineCountNum = grouped.online.length;
    if (allMembersTitle) {
        allMembersTitle.innerHTML = t('allMembersTitleWithOnline').replace('{count}', '<span id="allMembersCountInner">'+totalCount+'</span>').replace('{online}', '<span id="allMembersOnlineInner">'+onlineCountNum+'</span>');
        allMembersCount = $safe('allMembersCountInner');
    }
    allMembersList.innerHTML = '';
    if (!totalCount) { allMembersList.innerHTML = '<div class="online-empty">'+t('noMembersFound')+'</div>'; return; }
    function appendSection(label, dotCls) {
        var sec = document.createElement('div');
        sec.className = 'members-section-header' + (dotCls ? ' ' + dotCls : '');
        sec.textContent = label;
        allMembersList.appendChild(sec);
    }
    function appendItem(m, isOnline) {
        var email = m.email || '';
        var displayName = m.display_name || email.split('@')[0] || '匿名';
        var it = document.createElement('div');
        it.className = 'online-user-item' + (isOnline ? ' is-online' : '');
        var avatar = document.createElement('img');
        avatar.className = 'avatar-small';
        avatar.loading = 'lazy';
        avatar.dataset.senderEmail = email;
        avatar.dataset.originalSrc = getAvatarUrl(email);
        avatar.src = '';
        avatar.onerror = function() { handleAvatarError(this, email); };
        avatar.addEventListener('click', function(e) { e.stopPropagation(); showUserProfile(email); });
        var dot = document.createElement('span');
        dot.className = 'online-dot' + (isOnline ? '' : ' offline');
        var info = document.createElement('div');
        info.className = 'online-user-info';
        var name = document.createElement('span');
        name.className = 'online-user-name';
        name.textContent = displayName;
        var em = document.createElement('span');
        em.className = 'online-user-email';
        em.textContent = email || '';
        info.appendChild(name); info.appendChild(em);
        it.appendChild(avatar); it.appendChild(dot); it.appendChild(info);
        allMembersList.appendChild(it);
    }
    if (grouped.online.length) {
        appendSection(t('onlineSection') + ' (' + grouped.online.length + ')');
        grouped.online.forEach(function(m) { appendItem(m, true); });
    }
    if (grouped.offline.length) {
        appendSection(t('offlineSection') + ' (' + grouped.offline.length + ')', 'members-section-header-offline');
        grouped.offline.forEach(function(m) { appendItem(m, false); });
    }
}
async function showAllMembersModal() {
    if (!allMembersModal) return;
    allMembersModal.classList.add('active');
    allMembersList.innerHTML = '<div class="online-empty">'+t('loading')+'</div>';
    try {
        var members = await fetchAllMembers();
        renderAllMembers(members);
    } catch(err) {
        console.error('showAllMembersModal failed:', err);
        allMembersList.innerHTML = '<div class="online-empty">'+t('noMembersFound')+'</div>';
    }
}

// ===================== @提及 =====================
var mentionActive = false;
var mentionSelectedIdx = -1;
if (chatInput) {
    chatInput.addEventListener('input', function() {
        var v = this.value, cp = this.selectionStart, la = v.lastIndexOf('@', cp);
        if (la !== -1 && !v.substring(la+1, cp).includes(' ')) { mentionActive = true; mentionSelectedIdx = 0; renderMentionDropdown(v.substring(la+1, cp)); if (mentionDropdown) mentionDropdown.classList.add('active'); }
        else { mentionActive = false; mentionSelectedIdx = -1; if (mentionDropdown) mentionDropdown.classList.remove('active'); }
        sendTypingEvent(); autoResizeTextarea();
    });
    chatInput.addEventListener('keydown', function(e) {
        if (!mentionActive || !mentionDropdown) return;
        var items = Array.prototype.slice.call(mentionDropdown.querySelectorAll('.mention-item'));
        if (!items.length) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            mentionSelectedIdx = (mentionSelectedIdx + 1) % items.length;
            updateMentionSelection(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            mentionSelectedIdx = mentionSelectedIdx <= 0 ? items.length - 1 : mentionSelectedIdx - 1;
            updateMentionSelection(items);
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (mentionSelectedIdx >= 0 && items[mentionSelectedIdx]) {
                e.preventDefault();
                items[mentionSelectedIdx].click();
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            mentionDropdown.classList.remove('active');
            mentionActive = false;
        }
    });
}
function updateMentionSelection(items) {
    items.forEach(function(it, i) { it.classList.toggle('active', i === mentionSelectedIdx); });
    var active = items[mentionSelectedIdx];
    if (active) {
        var r = active.getBoundingClientRect();
        var c = mentionDropdown.getBoundingClientRect();
        if (r.bottom > c.bottom) mentionDropdown.scrollTop += r.bottom - c.bottom;
        else if (r.top < c.top) mentionDropdown.scrollTop -= c.top - r.top;
    }
}
function getAllKnownMembers() {
    var list = [];
    var seen = {};
    if (allMembersCache && allMembersCache.length) {
        allMembersCache.forEach(function(m) {
            if (!m || !m.email) return;
            if (seen[m.email]) return;
            var dn = m.display_name || m.email.split('@')[0] || '匿名';
            list.push({ email: m.email, display_name: dn, avatar_url: m.avatar_url, isOnline: !!onlineUsers && Object.values(onlineUsers).some(function(o){ return o.email === m.email; }) });
            seen[m.email] = true;
        });
    } else {
        Object.keys(currentUserMap || {}).forEach(function(em) {
            if (seen[em]) return;
            var ui = currentUserMap[em] || {};
            list.push({ email: em, display_name: ui.display_name || em.split('@')[0] || '匿名', avatar_url: ui.avatar_url, isOnline: !!onlineUsers && Object.values(onlineUsers).some(function(o){ return o.email === em; }) });
            seen[em] = true;
        });
    }
    return list;
}
function renderMentionDropdown(filter) {
    if (!mentionDropdown) return;
    var all = getAllKnownMembers().filter(function(u) { return u.email !== currentEmail; });
    var f = (filter || '').toLowerCase();
    var matched = f ? all.filter(function(u) {
        return (u.display_name || '').toLowerCase().indexOf(f) !== -1 || (u.email || '').toLowerCase().indexOf(f) !== -1;
    }) : all;
    var online = matched.filter(function(u) { return u.isOnline; });
    var offline = matched.filter(function(u) { return !u.isOnline; });
    mentionDropdown.innerHTML = '';
    if (!matched.length) {
        mentionDropdown.innerHTML = '<div class="mention-empty">'+t('noUserFound')+'<div class="mention-hint">@'+esc(filter||'')+'</div></div>';
        return;
    }
    function makeSection(label, dotClass) {
        var sec = document.createElement('div');
        sec.className = 'mention-section' + (dotClass ? ' ' + dotClass : '');
        sec.innerHTML = '<span class="mention-section-dot"></span><span>'+esc(label)+'</span>';
        mentionDropdown.appendChild(sec);
    }
    function makeItem(u, idx, isOnline) {
        var it = document.createElement('button'); it.type = 'button';
        it.className = 'mention-item' + (idx === mentionSelectedIdx ? ' active' : '');
        it.dataset.idx = idx;
        var avatar = document.createElement('img'); avatar.alt = '';
        avatar.dataset.senderEmail = u.email;
        avatar.src = getAvatarUrl(u.email);
        avatar.onerror = function() { handleAvatarError(this, u.email); };
        var info = document.createElement('div'); info.className = 'mention-info';
        var name = document.createElement('span'); name.className = 'name'; name.textContent = u.display_name || '匿名';
        var em = document.createElement('span'); em.className = 'email'; em.textContent = u.email || '';
        info.appendChild(name); info.appendChild(em);
        var dot = document.createElement('span'); dot.className = 'mention-status' + (isOnline ? '' : ' offline');
        it.appendChild(avatar); it.appendChild(info); it.appendChild(dot);
        it.addEventListener('click', function() {
            var v = chatInput ? chatInput.value : '', cp = chatInput ? chatInput.selectionStart : 0, la = v.lastIndexOf('@', cp);
            if (la !== -1 && chatInput) { var before = v.substring(0,la), after = v.substring(cp), mt = '@'+(u.display_name||u.email)+' '; chatInput.value = before+mt+after; chatInput.selectionStart = chatInput.selectionEnd = before.length+mt.length; chatInput.focus(); }
            if (mentionDropdown) mentionDropdown.classList.remove('active'); mentionActive = false; autoResizeTextarea();
        });
        mentionDropdown.appendChild(it);
    }
    var idx = 0;
    if (online.length) {
        makeSection(t('onlineSection') + ' (' + online.length + ')');
        online.forEach(function(u) { makeItem(u, idx++, true); });
    }
    if (offline.length) {
        makeSection(t('offlineSection') + ' (' + offline.length + ')', 'offline-section');
        offline.forEach(function(u) { makeItem(u, idx++, false); });
    }
}
document.addEventListener('click', e => { if (mentionActive && mentionDropdown && !mentionDropdown.contains(e.target) && e.target !== chatInput) { mentionDropdown.classList.remove('active'); mentionActive = false; } });

// ===================== 输入状态 =====================
var typingStopId, lastTypingBT = 0;
function sendTypingEvent() {
    if (!window.chatChannel || !currentUserId) return;
    var n = Date.now();
    if (n - lastTypingBT < 1500) return;
    lastTypingBT = n;
    window.chatChannel.send({ type:'broadcast', event:'typing', payload:{ user_id: currentUserId, display_name: currentDisplayName || currentEmail.split('@')[0] } });
}
function showTypingIndicator(dn) {
    var i = document.getElementById('typingIndicator'), t = document.getElementById('typingText');
    if (!i || !t) return;
    t.textContent = (dn || '用户') + ' 正在输入';
    i.classList.add('active');
    clearTimeout(typingStopId);
    typingStopId = setTimeout(() => { i.classList.remove('active'); adjustMobileMessagePadding(); }, 2000);
    adjustMobileMessagePadding();
}

// ===================== 实时频道（仅全局聊天） =====================
function subscribeMessages() {
    if (window.chatChannel) {
        window.chatChannel.unsubscribe();
        window.chatChannel = null;
    }
    // 固定全局频道名，不再依赖 convId
    var ch = supabase.channel('chat-room-global', {
        config: { presence: { key: currentUserId } }
    });
    ch.on('presence', { event:'sync' }, () => {
        // Presence 已由独立频道处理，这里不再重复
    });
    ch.on('broadcast', { event:'typing' }, data => { if (data.payload.user_id !== currentUserId) showTypingIndicator(data.payload.display_name); });
    ch.on('broadcast', { event:'mention' }, data => {
        if (data.payload.users.includes(currentUserId)) {
            if ('Notification' in window && Notification.permission === 'granted') new Notification('有人@了你', { body: data.payload.from + ' 提到了你', icon: 'assets/logo.svg' });
            else { setAuthMessage(data.payload.from + ' 提到了你','success'); setTimeout(() => setAuthMessage(''), 5000); }
        }
    });
    // 不再使用 convId 过滤器，监听 messages 表全部变更，在回调里筛全局消息（conversation_id 为 null）
    ch.on('postgres_changes', { event:'INSERT', schema:'public', table:'messages' }, payload => {
        var m = payload.new; if (!m || m.sender_email === currentEmail) return;
        // 跳过非全局消息（理论上不再存在，但兼容历史数据）
        if (m.conversation_id && m.conversation_id !== '00000000-0000-0000-0000-000000000000') return;
        addMessageToBottom({ id: m.id, content: m.content, sender_name: m.sender_name || '匿名', sender_email: m.sender_email, isMe: false, time: formatTimeShort(m.created_at), created_at: m.created_at });
    });
    ch.on('postgres_changes', { event:'UPDATE', schema:'public', table:'messages' }, payload => {
        var u = payload.new;
        if (u.conversation_id && u.conversation_id !== '00000000-0000-0000-0000-000000000000') return;
        document.querySelectorAll('.message[data-message-id="'+u.id+'"]').forEach(el => { el.replaceWith(createMessageElement({ id: u.id, content: u.content, sender_name: u.sender_name, sender_email: u.sender_email, isMe: u.sender_email === currentEmail, time: formatTimeShort(u.created_at), created_at: u.created_at })); });
    });
    ch.on('postgres_changes', { event:'DELETE', schema:'public', table:'messages' }, payload => {
        var el = messageList ? messageList.querySelector('[data-message-id="'+payload.old.id+'"]') : null;
        if (el) el.remove();
    });
    ch.subscribe(async status => { if (status === 'SUBSCRIBED') {
        // 不再 track，由独立 Presence 频道负责
    } });
    window.chatChannel = ch;
}

// ===================== 图片预览 =====================
window.previewImage = function(url) {
    var o = document.createElement('div'); o.className = 'img-preview-overlay';
    var container = document.createElement('div'); container.className = 'img-preview-container';
    var img = new Image(); img.src = url; img.className = 'img-preview-img';
    var zoomInfo = document.createElement('div'); zoomInfo.className = 'img-preview-zoom-info'; zoomInfo.textContent = '100%';
    img.onload = function(){ img.classList.add('loaded'); };

    var scale = 1;
    var translateX = 0;
    var translateY = 0;
    var isDragging = false;
    var lastX = 0;
    var lastY = 0;

    function updateTransform() {
        img.style.transform = 'translate(' + translateX + 'px, ' + translateY + 'px) scale(' + scale + ')';
        zoomInfo.textContent = Math.round(scale * 100) + '%';
        if (scale > 1) {
            img.classList.add('zoomed');
        } else {
            img.classList.remove('zoomed');
            translateX = 0;
            translateY = 0;
            img.style.transform = 'scale(' + scale + ')';
        }
    }

    function handleWheel(e) {
        e.preventDefault();
        var delta = e.deltaY > 0 ? -0.1 : 0.1;
        var newScale = Math.max(1, Math.min(5, scale + delta));
        if (newScale !== scale) {
            scale = newScale;
            updateTransform();
        }
    }

    function handleMouseDown(e) {
        if (scale <= 1) return;
        isDragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        img.style.transition = 'none';
    }

    function handleMouseMove(e) {
        if (!isDragging || scale <= 1) return;
        var dx = e.clientX - lastX;
        var dy = e.clientY - lastY;
        translateX += dx;
        translateY += dy;
        lastX = e.clientX;
        lastY = e.clientY;
        img.style.transform = 'translate(' + translateX + 'px, ' + translateY + 'px) scale(' + scale + ')';
    }

    function handleMouseUp() {
        isDragging = false;
        img.style.transition = 'transform .15s ease';
    }

    function handleDoubleClick(e) {
        e.stopPropagation();
        if (scale > 1) {
            scale = 1;
            translateX = 0;
            translateY = 0;
        } else {
            scale = 2;
        }
        updateTransform();
    }

    container.addEventListener('wheel', handleWheel, { passive: false });
    img.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    img.addEventListener('dblclick', handleDoubleClick);

    var bc = document.createElement('div'); bc.className = 'img-preview-actions';
    var db = document.createElement('button'); db.className = 'btn-primary'; db.textContent = t('downloadOriginal');
    db.onclick = () => {
        db.textContent = t('downloadingBtn'); db.disabled = true;
        fetch(url).then(r=>r.blob()).then(b => { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = url.split('/').pop() || 'image.jpg'; a.click(); db.textContent = t('downloaded'); setTimeout(()=>{ db.textContent = t('downloadOriginal'); db.disabled = false; }, 2000); }).catch(() => { db.textContent = t('downloadFailed'); setTimeout(()=>{ db.textContent = t('downloadOriginal'); db.disabled = false; }, 2000); });
    };
    var cb = document.createElement('button'); cb.className = 'btn-secondary'; cb.textContent = t('close');
    cb.onclick = () => { document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp); document.body.removeChild(o); };
    bc.appendChild(db); bc.appendChild(cb);
    container.appendChild(img);
    container.appendChild(zoomInfo);
    o.appendChild(container);
    o.appendChild(bc);
    o.onclick = () => { document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp); document.body.removeChild(o); };
    document.body.appendChild(o);
};

// v3.1.0 图片懒加载：初次出现的才设真实 src
function setupImageObserver() {
    if (imageObserver || typeof IntersectionObserver === 'undefined') return;
    imageObserver = new IntersectionObserver(function(entries){
        entries.forEach(function(en){
            if (en.isIntersecting) {
                var img = en.target;
                var full = img.dataset.full || img.src;
                if (img.src !== full) img.src = full;
                imageObserver.unobserve(img);
            }
        });
    }, { root: messageList || null, rootMargin: '200px', threshold: 0.05 });
}
function observeImagesIn(root) {
    if (!imageObserver || !root) return;
    var imgs = root.querySelectorAll ? root.querySelectorAll('img.msg-img-thumb[data-full]:not([data-observed])') : [];
    imgs.forEach(function(img){ img.setAttribute('data-observed','1'); imageObserver.observe(img); });
}

// ===================== 事件绑定 =====================
if (attachBtn) {
    attachBtn.addEventListener('click', e => { e.preventDefault(); showUploadOverlay(); setTimeout(() => { if (fileInput) fileInput.click(); }, 150); });
}
function showUploadOverlay() { if (uploadOverlay) uploadOverlay.classList.add('active'); isUploadingFile = true; }
function hideUploadOverlay() { if (uploadOverlay) uploadOverlay.classList.remove('active'); isUploadingFile = false; }
if (closeUploadBtn) closeUploadBtn.addEventListener('click', () => { hideUploadOverlay(); if (fileInput) fileInput.value = ''; });
if (fileInput) {
    fileInput.addEventListener('change', e => { hideUploadOverlay(); var f = e.target.files; for (var i=0; i<f.length; i++) addAttachment(f[i]); fileInput.value = ''; });
}
if (uploadOverlay) {
    uploadOverlay.addEventListener('click', e => { if (e.target === uploadOverlay) { hideUploadOverlay(); if (fileInput) fileInput.value = ''; } });
}
if (chatInput) {
    chatInput.addEventListener('dragover', e => { e.preventDefault(); chatInput.style.borderColor = 'var(--accent)'; });
    chatInput.addEventListener('dragleave', e => { e.preventDefault(); chatInput.style.borderColor = ''; });
    chatInput.addEventListener('drop', e => { e.preventDefault(); chatInput.style.borderColor = ''; var f = e.dataTransfer.files; for (var i=0; i<f.length; i++) if (f[i].type.startsWith('image/') || f[i].type.startsWith('audio/')) addAttachment(f[i]); });
    chatInput.addEventListener('paste', e => {
        for (var i=0; i<e.clipboardData.items.length; i++) {
            var item = e.clipboardData.items[i];
            if (item.type.indexOf('image') !== -1) { e.preventDefault(); var f = item.getAsFile(); if (f) addAttachment(f); return; }
            if (item.kind === 'file' && item.type.startsWith('audio/')) { e.preventDefault(); var f = item.getAsFile(); if (f) addAttachment(f); return; }
        }
    });
    chatInput.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            insertAtCursor('\n');
        } else if (!e.shiftKey) {
            e.preventDefault();
            sendMessageContent(chatInput.value);
        }
    });
}
if (btnSend) btnSend.addEventListener('click', () => { if (chatInput) sendMessageContent(chatInput.value); });

// 设置按钮事件已在 enterChat 中绑定，此处不再重复

if (closeSettingsEl) closeSettingsEl.addEventListener('click', closeSettingsFunc);
if (settingsOverlay) {
    settingsOverlay.addEventListener('click', e => { if (e.target === settingsOverlay) closeSettingsFunc(); });
}

var settingsLockBtn = document.getElementById('settingsLock');
var settingsPanel = document.querySelector('.settings-panel');
var isSettingsLocked = false;

if (settingsLockBtn) {
    settingsLockBtn.addEventListener('click', function() {
        isSettingsLocked = !isSettingsLocked;
        if (isSettingsLocked) {
            settingsPanel.classList.add('locked');
            settingsLockBtn.classList.add('locked');
            settingsLockBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><path d="M12 15h.01"/></svg>';
            settingsLockBtn.title = t('unlock');
            settingsLockBtn.setAttribute('aria-label', t('unlock') + '设置');
        } else {
            settingsPanel.classList.remove('locked');
            settingsLockBtn.classList.remove('locked');
            settingsLockBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
            settingsLockBtn.title = t('lock');
            settingsLockBtn.setAttribute('aria-label', t('lock') + '设置');
        }
    });
}

if (settingsLogout) settingsLogout.addEventListener('click', handleLogout);

var mobileHeaderActionsBtn = document.getElementById('mobileHeaderActionsBtn');
if (mobileHeaderActionsBtn) {
    mobileHeaderActionsBtn.addEventListener('click', function() {
        var menuItems = [
            {
                text: t('share'),
                icon: '<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
                onClick: shareChat
            }
        ];
        if (window.innerWidth > 768) {
            menuItems.push({
                text: t('allMembers'),
                icon: '<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
                onClick: function() {
                    showAllMembersModal();
                }
            });
        }
        showMobileActionSheet(t('moreActions'), menuItems);
    });
}
if (saveDisplayNameBtn) saveDisplayNameBtn.addEventListener('click', saveDisplayName);
if (displayNameInput) {
    displayNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveDisplayName(); } });
}
if (avatarUploadBtn) avatarUploadBtn.addEventListener('click', () => { if (avatarFileInput) avatarFileInput.click(); });
if (avatarFileInput) {
    avatarFileInput.addEventListener('change', e => { if (e.target.files.length) uploadAvatar(e.target.files[0]); e.target.value = ''; });
}
var checkBtn = document.getElementById('checkUpdateBtn');
if (checkBtn) checkBtn.addEventListener('click', checkForUpdate);
function showTermsContent(title, content) {
    showCustomModal({
        type: 'info',
        title: title,
        message: '<div style="max-height:400px;overflow-y:auto;text-align:left;padding:8px">' + content + '</div>',
        showCancel: false,
        showConfirm: true,
        confirmText: t('close')
    });
}
document.getElementById('openQuickAgreement')?.addEventListener('click', function() {
    var content = '<h4>' + t('userAgreement') + '</h4><p>' + t('userAgreementContent') + '</p><ul style="margin-top:8px;padding-left:20px"><li>' + t('userAgreementItem1') + '</li><li>' + t('userAgreementItem2') + '</li><li>' + t('userAgreementItem3') + '</li><li>' + t('userAgreementItem4') + '</li></ul>' +
        '<h4 style="margin-top:16px">' + t('privacyPolicy') + '</h4><p>' + t('privacyPolicyContent') + '</p><ul style="margin-top:8px;padding-left:20px"><li>' + t('privacyPolicyItem1') + '</li><li>' + t('privacyPolicyItem2') + '</li><li>' + t('privacyPolicyItem3') + '</li><li>' + t('privacyPolicyItem4') + '</li></ul>' +
        '<h4 style="margin-top:16px">' + t('thirdPartySharing') + '</h4><p>' + t('thirdPartySharingContent') + '</p><ul style="margin-top:8px;padding-left:20px"><li>' + t('thirdPartySharingItem1') + '</li><li>' + t('thirdPartySharingItem2') + '</li></ul>' +
        '<h4 style="margin-top:16px">' + t('dataCollection') + '</h4><p>' + t('dataCollectionContent') + '</p><ul style="margin-top:8px;padding-left:20px"><li>' + t('dataCollectionItem1') + '</li><li>' + t('dataCollectionItem2') + '</li><li>' + t('dataCollectionItem3') + '</li><li>' + t('dataCollectionItem4') + '</li><li>' + t('dataCollectionItem5') + '</li></ul>' +
        '<h4 style="margin-top:16px">' + t('appPermissions') + '</h4><p>' + t('appPermissionsContent') + '</p><ul style="margin-top:8px;padding-left:20px"><li>' + t('appPermissionsItem1') + '</li><li>' + t('appPermissionsItem2') + '</li><li>' + t('appPermissionsItem3') + '</li></ul>';
    showTermsContent(t('quickAgreement'), content);
});
document.getElementById('openFullAgreement')?.addEventListener('click', function() {
    window.open('agreements/', '_blank');
});
var settingsTabs = document.querySelectorAll('.settings-tab');
settingsTabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
        var targetTab = this.dataset.tab;
        settingsTabs.forEach(function(t) { t.classList.remove('active'); });
        this.classList.add('active');
        document.querySelectorAll('.settings-tab-content').forEach(function(content) { content.classList.remove('active'); });
        var targetContent = document.getElementById('tab-' + targetTab);
        if (targetContent) targetContent.classList.add('active');
    });
});
var themeOptions = document.querySelectorAll('.theme-option');
themeOptions.forEach(function(option) {
    option.addEventListener('click', function() {
        setTheme(this.dataset.theme);
    });
});
var langDropdownBtn = document.getElementById('languageDropdownBtn');
var langDropdownMenu = document.getElementById('languageDropdownMenu');
if (langDropdownBtn && langDropdownMenu) {
    langDropdownBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        langDropdownMenu.classList.toggle('open');
    });
    document.addEventListener('click', function() {
        langDropdownMenu.classList.remove('open');
    });
    var langItems = langDropdownMenu.querySelectorAll('.language-dropdown-item');
    langItems.forEach(function(item) {
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            setLang(this.dataset.lang);
            langDropdownMenu.classList.remove('open');
        });
    });
}
updateThemeButtons();

var notifyDesktop = document.getElementById('notifyDesktop');
var notifySound = document.getElementById('notifySound');
var notifyMention = document.getElementById('notifyMention');
if (notifyDesktop) {
    notifyDesktop.checked = localStorage.getItem('minichat_notify_desktop') !== 'false';
    notifyDesktop.addEventListener('change', function() {
        localStorage.setItem('minichat_notify_desktop', this.checked ? 'true' : 'false');
        if (this.checked && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    });
}
if (notifySound) {
    notifySound.checked = localStorage.getItem('minichat_notify_sound') !== 'false';
    notifySound.addEventListener('change', function() {
        localStorage.setItem('minichat_notify_sound', this.checked ? 'true' : 'false');
    });
}
if (notifyMention) {
    notifyMention.checked = localStorage.getItem('minichat_notify_mention') !== 'false';
    notifyMention.addEventListener('change', function() {
        localStorage.setItem('minichat_notify_mention', this.checked ? 'true' : 'false');
    });
}

var accountEmailEl = document.getElementById('accountEmail');
if (accountEmailEl && window.currentEmail) {
    accountEmailEl.textContent = window.currentEmail;
}
var forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
if (forgotPasswordBtn) {
    forgotPasswordBtn.addEventListener('click', function() {
        var email = window.currentEmail || prompt('请输入您的邮箱地址：');
        if (!email) return;
        // 开启 CAPTCHA 后 /recover 也需要 token；按钮旁边就是验证码容器，点两次即可
        if (captchaEnabled() && !captchaTokenOf('captchaBoxSettings')) {
            renderCaptcha('captchaBoxSettings');
            showAlert('请先完成按钮左侧的人机验证，然后再次点击「重置密码」', 'error');
            return;
        }
        var opts = { redirectTo: window.location.origin };
        if (captchaEnabled()) opts.captchaToken = captchaTokenOf('captchaBoxSettings');
        supabase.auth.resetPasswordForEmail(email, opts).then(function() {
            if (captchaEnabled()) resetCaptcha('captchaBoxSettings');
            showAlert(t('passwordResetSent'), 'success');
        }).catch(function(err) {
            if (captchaEnabled()) resetCaptcha('captchaBoxSettings');
            showAlert(t('passwordResetFailed') + err.message, 'error');
        });
    });
}
var deleteAccountBtn = document.getElementById('deleteAccountBtn');
if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener('click', async function() {
        showConfirm(t('deleteConfirm'), async function() {
            showConfirm('是否同时清理您发送的所有消息？清理后消息将显示为"已注销用户"发送。', async function() {
                if (currentEmail) {
                    var result = await anonymizeUserMessages(currentEmail);
                    if (!result.success) {
                        showConfirm('清理消息失败：' + result.error + '\n\n是否继续注销账户？', function() {
                            confirmDelete();
                        });
                    } else {
                        showAlert(t('cleanedMessages').replace('{count}', result.count), 'success');
                        setTimeout(confirmDelete, 1500);
                    }
                } else {
                    confirmDelete();
                }
            });
        });
    });
}

function confirmDelete() {
    showConfirm(t('deleteConfirm'), function() {
        supabase.auth.deleteUser().then(function() {
            localStorage.clear();
            location.reload();
        }).catch(function(err) {
            showAlert(t('deleteFailed') + err.message, 'error');
        });
    });
}
if (allMembersBtn) {
    allMembersBtn.addEventListener('click', e => { e.stopPropagation(); showAllMembersModal(); });
}
if (closeAllMembersModal) closeAllMembersModal.addEventListener('click', e => { e.stopPropagation(); if (allMembersModal) allMembersModal.classList.remove('active'); });
if (allMembersModal) allMembersModal.addEventListener('click', e => { e.stopPropagation(); });
document.addEventListener('click', e => { if (allMembersModal && allMembersModal.classList.contains('active') && !allMembersModal.contains(e.target) && allMembersBtn && !allMembersBtn.contains(e.target)) allMembersModal.classList.remove('active'); });
if (memberSearchInput) {
    memberSearchInput.addEventListener('input', function() { renderAllMembers(allMembersCache); });
}

// ===================== 全局事件 =====================
function handleDocumentClick(e) {
    var recallBtn = e.target.closest('.recall-btn');
    if (recallBtn) { e.preventDefault(); window.recallMessage(recallBtn.dataset.messageId); return; }
    var quote = e.target.closest('.quote-block');
    if (quote) {
        e.preventDefault();
        var author = quote.dataset.author, time = quote.dataset.time, email = quote.dataset.email, messageId = quote.dataset.messageId;
        var bodyEl = quote.querySelector('.quote-body');
        var content = bodyEl ? (bodyEl.textContent || '').trim() : '';
        if (author && time) openQuoteJumpModal(author, time, email, content, messageId);
        return;
    }
    var mention = e.target.closest('.mention[data-user-exists="1"][data-user-email]');
    if (mention) {
        e.preventDefault();
        e.stopPropagation();
        var em = mention.getAttribute('data-user-email');
        if (em) {
            try { showUserProfile(em); } catch(err) { console.warn('showUserProfile failed:', err); }
        }
    }
}
function handleDocumentScroll(e) {
    if (e.target === messageList || (messageList && e.target.closest('#messageList'))) {
        var target = e.target === messageList ? messageList : e.target.closest('#messageList');
        if (target && target.scrollTop <= 20 && !isLoadingMore && hasMoreMessages) loadHistory(true);
    }
}
function setupGlobalEventListeners() {
    document.removeEventListener('click', handleDocumentClick);
    document.removeEventListener('scroll', handleDocumentScroll);
    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('scroll', handleDocumentScroll, true);
}

// ===================== 初始化 =====================
        document.addEventListener('DOMContentLoaded', function() {
            var authToggle = document.querySelector('.auth-toggle');
            if (authToggle) authToggle.addEventListener('click', handleAuthToggleClick);
            var togglePwd = document.getElementById('togglePwd');
            if (togglePwd) {
                togglePwd.addEventListener('click', function() {
                    if (!authPassword) return;
                    var t = authPassword.getAttribute('type') === 'password' ? 'text' : 'password';
                    authPassword.setAttribute('type', t);
                    this.innerHTML = t === 'password' 
                        ? '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
                        : '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M17 16s4-1 4-5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6c0 4 4 5 4 5"/><line x1="12" y1="13" x2="12" y2="17"/><line x1="8" y1="9" x2="16" y2="9"/></svg>';
                });
            }
            if (btnLogin) btnLogin.addEventListener('click', handleAuth);
            // FloxChat
            var switchFlox = document.getElementById('switchFloxChat');
            if (switchFlox) switchFlox.addEventListener('click', switchToFloxLogin);
            var floxBack = document.getElementById('floxBack');
            if (floxBack) floxBack.addEventListener('click', switchBackFromFlox);
            var btnSend = document.getElementById('btnFloxSendCode');
            if (btnSend) btnSend.addEventListener('click', handleFloxSendCode);
            var btnVerify = document.getElementById('btnFloxVerify');
            if (btnVerify) btnVerify.addEventListener('click', handleFloxVerify);
            // v3.1.0: 返回前台后只清桌面未读，小红点保留直到真正阅读
            document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateBottomNavBadge(); } });
            window.addEventListener('beforeunload', async () => { if (presenceChannel) { try { await presenceChannel.untrack(); } catch(e) {} presenceChannel.unsubscribe(); } if (window.chatChannel) { window.chatChannel.unsubscribe(); } });
            window.addEventListener('resize', adjustMobileMessagePadding);
            loadTheme();
            loadLanguage();
            var sidebarVer = document.getElementById('sidebarVersion');
            if (sidebarVer) sidebarVer.textContent = 'v'+APP_VERSION;
            var logoArea = document.getElementById('logoArea');
            if (logoArea) {
                logoArea.addEventListener('click', function(e) {
                    var target = e.target;
                    if (target === sidebarVer || target.closest('.version-tag')) {
                        if (settingsOverlay) settingsOverlay.classList.add('active');
                        var aboutTab = document.querySelector('.settings-tab[data-tab="about"]');
                        if (aboutTab) aboutTab.click();
                    } else {
                        showConfirm(t('refreshConfirm'), function() {
                            location.reload();
                        });
                    }
                });
            }
            var panelVer = document.getElementById('panelVersion');
            if (panelVer) panelVer.textContent = 'MiniChat v'+APP_VERSION;

            // ===================== v3.1.0 新增事件绑定 =====================
            setupImageObserver();      // 初始化图片懒加载观察器
            bindProfileCard();         // 资料卡关闭 / 点击外部
            bindShareButton();         // 分享按钮
            bindCtxProfile();          // 右键菜单 查看资料
            bindBottomNav();           // 底部导航 Tab
            bindCustomModal();         // 自定义弹窗事件绑定

            // 禁用 Service Worker，避免资源拦截问题
            // if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js?v='+APP_VERSION);
        });

// ===================== v3.1.0 资料卡事件 =====================
function bindProfileCard() {
    if (profileCardClose) profileCardClose.addEventListener('click', () => profileCard && profileCard.classList.remove('active'));
    if (profileCard) profileCard.addEventListener('click', e => { if (e.target === profileCard) profileCard.classList.remove('active'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && profileCard && profileCard.classList.contains('active')) profileCard.classList.remove('active'); });
}

function bindCustomModal() {
    if (customModalOverlay) customModalOverlay.addEventListener('click', closeCustomModal);
    if (customModalCancel) customModalCancel.addEventListener('click', closeCustomModal);
    if (customModalConfirm) {
        customModalConfirm.addEventListener('click', function() {
            closeCustomModal();
        });
    }
    
    var actionOverlay = document.getElementById('mobileActionOverlay');
    var actionCancel = document.getElementById('mobileActionCancel');
    if (actionOverlay) actionOverlay.addEventListener('click', closeMobileActionSheet);
    if (actionCancel) actionCancel.addEventListener('click', closeMobileActionSheet);
    document.addEventListener('keydown', function(e) {
        var actionSheet = document.getElementById('mobileActionSheet');
        if (e.key === 'Escape' && actionSheet && actionSheet.classList.contains('active')) {
            closeMobileActionSheet();
        }
    });
}

// ===================== v3.1.0 右键 查看资料 =====================
function bindCtxProfile() {
    if (!ctxProfile) return;
    ctxProfile.addEventListener('click', () => {
        var targetEmail = contextMenu ? contextMenu.dataset.targetEmail : '';
        if (targetEmail) showProfileCard(targetEmail);
        if (contextMenu) contextMenu.classList.remove('active');
    });
}

// ===================== v3.1.0 分享 =====================
function shareChat() {
    var url = window.location.href.split('#')[0];
    var shareData = { title: 'MiniChat', text: '来 MiniChat 和我一起聊天吧！', url: url };
    if (navigator.share) {
        navigator.share(shareData).catch(function(err){ /* 用户取消 */ });
        return;
    }
    if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function(){
            setAuthMessage('链接已复制，快分享给朋友吧！','success');
            setTimeout(function(){ setAuthMessage(''); }, 2500);
        }).catch(function(){
            prompt('复制以下链接分享：', url);
        });
    } else { prompt('复制以下链接分享：', url); }
}
function bindShareButton() {
    if (!shareBtn) return;
    shareBtn.addEventListener('click', shareChat);
}

// ===================== v3.1.0 底部导航 =====================
function updateBottomNavBadge() {
    if (bottomUnreadBadge) {
        if (unreadCount > 0) { bottomUnreadBadge.textContent = unreadCount > 99 ? '99+' : unreadCount; bottomUnreadBadge.classList.add('show'); }
        else bottomUnreadBadge.classList.remove('show');
    }
}
function bindBottomNav() {
    if (!bottomNav) return;
    var tabs = bottomNav.querySelectorAll('.nav-item');
    tabs.forEach(function(tab){
        tab.addEventListener('click', function(e){
            e.stopPropagation();
            tabs.forEach(function(t){ t.classList.remove('active'); });
            this.classList.add('active');
            var tabName = this.dataset.tab;
            if (allMembersModal && allMembersModal.classList.contains('active') && tabName !== 'members') allMembersModal.classList.remove('active');
            if (tabName === 'chat') {
                if (chatInput) chatInput.focus();
            } else if (tabName === 'members') {
                showAllMembersModal();
            } else if (tabName === 'settings') {
                if (settingsOverlay) settingsOverlay.classList.add('active');
            }
        });
    });
}

// ===================== v3.1.0 未读标记 =====================
function markMessagesRead() {
    if (!messageList) return;
    // 优先采用最近一条 .message 的 messageId 作为已读
    var all = messageList.querySelectorAll('.message[data-message-id]');
    var lastMsg = all[all.length - 1];
    if (!lastMsg) return;
    var id = lastMsg.dataset.messageId;
    if (!id || id.startsWith('temp-')) return;
    if (id !== lastReadMessageId) {
        lastReadMessageId = id;
        try { localStorage.setItem('minichat_last_read', id); } catch(e) {}
    }
    newMessageCount = 0;
    unreadCount = 0;
    document.title = 'MiniChat';
    if (newMessagesBtn) newMessagesBtn.classList.remove('show');
    if (newMsgBadge) newMsgBadge.style.display = 'none';
    updateSidebarBadge();
    updateBottomNavBadge();
}

// ===================== v3.1.0 虚拟滚动优化 =====================
// 虚拟滚动只在消息非常多时才值得开启（它靠 clientHeight 算可视窗口，
// 一旦高度测量不准就会把消息全判成"屏幕外"而隐藏 → 白屏）。
// 阈值从 400 提到 800，显著降低误触概率。
var VIRTUAL_SCROLL_THRESHOLD = 800;
var VIRTUAL_BUFFER = 30;
var virtualScrollEnabled = false;
var virtualScrollTick = false;
var vsTopPadding = 0;
var vsBottomPadding = 0;

function enableVirtualScroll() {
    if (virtualScrollEnabled || !messageList) return;
    virtualScrollEnabled = true;
    // ⚠️ 这里曾经是 contain: 'strict'，它会连 contain:size 一起打开，
    //    意思是"不看内容也算这个元素的大小" —— 结果 messageList.clientHeight
    //    变得不可靠（常常是 0）。而下面的 updateVirtualWindow() 正是靠
    //    clientHeight 来算可视窗口的：
    //        viewportBottom = scrollTop + messageList.clientHeight   // ≈ scrollTop + 0
    //    于是所有消息都被判定在窗口之外、统统隐藏 —— 表现就是【消息区全白】。
    //    只保留 layout/paint，去掉 size，既拿到渲染隔离的性能收益，又不会算错高度。
    messageList.style.contain = 'layout paint';
    messageList.addEventListener('scroll', onVirtualScroll, { passive: true });
    applyContentVisibility();
}

function checkVirtualScroll() {
    if (!messageList || virtualScrollEnabled) return;
    var msgCount = messageList.querySelectorAll('.message').length;
    if (msgCount >= VIRTUAL_SCROLL_THRESHOLD) {
        console.log('[MiniChat/vscroll] 消息数 ' + msgCount + ' ≥ ' + VIRTUAL_SCROLL_THRESHOLD + '，启用虚拟滚动');
        enableVirtualScroll();
    }
}

function applyContentVisibility() {
    if (!messageList) return;
    var groups = messageList.querySelectorAll('.message-group, .time-label, .time-divider');
    groups.forEach(function(el) {
        if (!el.style.contentVisibility) {
            el.style.contentVisibility = 'auto';
            el.style.containIntrinsicSize = 'auto 80px';
        }
    });
}

function onVirtualScroll() {
    if (!messageList || !virtualScrollEnabled) return;
    if (messageList.scrollTop < 1000 && hasMoreMessages && !isLoadingMore) loadHistory(true);
    if (messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 200) {
        if (isUserAtBottom) markMessagesRead();
    }
    if (virtualScrollTick) return;
    virtualScrollTick = true;
    requestAnimationFrame(function() {
        virtualScrollTick = false;
        updateVirtualWindow();
    });
}

function updateVirtualWindow() {
    if (!messageList || !virtualScrollEnabled) return;
    var children = Array.from(messageList.children);
    var total = children.length;
    if (total < VIRTUAL_SCROLL_THRESHOLD) return;
    // 防御：拿不到可视高度就【绝不能】开始隐藏消息，
    // 否则会把整个列表都判成"屏幕外"，直接白屏（见 enableVirtualScroll 的注释）
    if (!messageList.clientHeight) {
        console.warn('[MiniChat/vscroll] clientHeight 为 0，跳过本轮隐藏');
        return;
    }
    var viewportTop = messageList.scrollTop;
    var viewportBottom = viewportTop + messageList.clientHeight;
    var bufferTop = viewportTop - 2000;
    var bufferBottom = viewportBottom + 2000;
    var currentY = 0;
    var hideTopEnd = -1;
    var hideBottomStart = total;
    var hiddenTopHeight = 0;
    var hiddenBottomHeight = 0;
    for (var i = 0; i < total; i++) {
        var el = children[i];
        var h = el.offsetHeight || 80;
        var elTop = currentY;
        var elBottom = currentY + h;
        if (elBottom < bufferTop) {
            hideTopEnd = i;
            hiddenTopHeight += h;
        }
        if (elTop > bufferBottom) {
            if (hideBottomStart === total) hideBottomStart = i;
            hiddenBottomHeight += h;
        }
        currentY += h;
    }
    for (var j = 0; j < total; j++) {
        var cel = children[j];
        var spacer = cel._vsSpacer;
        var shouldHide = j <= hideTopEnd || j >= hideBottomStart;
        if (shouldHide && cel.style.display !== 'none') {
            if (!spacer) {
                spacer = document.createElement('div');
                spacer.className = 'vs-spacer';
                spacer.style.height = cel.offsetHeight + 'px';
                cel._vsSpacer = spacer;
            } else {
                spacer.style.height = cel.offsetHeight + 'px';
            }
            cel.style.display = 'none';
            cel.parentNode.insertBefore(spacer, cel);
        } else if (!shouldHide && cel.style.display === 'none') {
            if (spacer && spacer.parentNode) spacer.parentNode.removeChild(spacer);
            cel.style.display = '';
        }
    }
}
