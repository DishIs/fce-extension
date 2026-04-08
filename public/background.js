/* global browser */
importScripts("libs/webextension-polyfill.js");

const API_BASE = "https://api2.freecustom.email";
const WS_BASE = "wss://api2.freecustom.email";

// Helper to get fingerprint (service worker compatible)
function getExtensionFingerprint() {
    // Create a simple fingerprint in service worker context
    // Service workers don't have navigator/window, but browser.runtime can give us info
    const fingerprint = [
        self.navigator?.userAgent || 'extension',
        self.navigator?.language || 'en',
        new Date().getTimezoneOffset(),
        Date.now()
    ].join('|');
    
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < fingerprint.length; i++) {
        const char = fingerprint.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
}

// Helper to get headers
async function getAuthHeaders() {
    const { extToken } = await browser.storage.local.get("extToken");
    const headers = { 
        "Content-Type": "application/json", 
        "x-fce-client": "extension",
        "x-fingerprint": getExtensionFingerprint()
    };
    if (extToken) {
        headers["Authorization"] = `Bearer ${extToken}`;
    }
    return headers;
}

// Storage helpers
let isStorageLocked = false;
const updateQueue = [];

async function updateSavedMessages(changeFunction) {
    return new Promise((resolve, reject) => {
        updateQueue.push({ changeFunction, resolve, reject });
        if (isStorageLocked) return;
        processQueue();
    });
}

async function processQueue() {
    if (updateQueue.length === 0) {
        isStorageLocked = false;
        return;
    }
    isStorageLocked = true;
    const { changeFunction, resolve, reject } = updateQueue.shift();
    try {
        const { savedMessages = {} } = await browser.storage.local.get("savedMessages");
        const updatedMessages = changeFunction(savedMessages);
        await browser.storage.local.set({ savedMessages: updatedMessages });
        resolve({ success: true });
    } catch (error) {
        reject(error);
    } finally {
        processQueue();
    }
}

// Websocket Management
let socket = null;
let reconnectTimer = null;
let isConnecting = false;
let currentMailbox = null;

async function initWebSocket(force = false) {
    if (isConnecting) return; // Prevent multiple concurrent connections
    
    const { extToken, tempEmail } = await browser.storage.local.get(["extToken", "tempEmail"]);
    if (!tempEmail) return;

    // If we already have a connection to this mailbox, don't reconnect unless forced
    if (!force && socket && socket.readyState === WebSocket.OPEN && currentMailbox === tempEmail) {
        return;
    }
    
    if (socket) {
        socket.close();
        socket = null;
    }
    
    isConnecting = true;
    currentMailbox = tempEmail;

    let wsUrl = `${WS_BASE}/?mailbox=${encodeURIComponent(tempEmail)}`;
    
    // Fetch a WS token
    try {
        const headers = await getAuthHeaders();
        const ticketRes = await fetch(`${API_BASE}/v1/ext/ws-ticket?mailbox=${encodeURIComponent(tempEmail)}`, { headers });
        if (ticketRes.ok) {
            const ticketData = await ticketRes.json();
            if (ticketData.token) {
                wsUrl = `${WS_BASE}/?mailbox=${encodeURIComponent(tempEmail)}&token=${encodeURIComponent(ticketData.token)}`;
            }
        }
    } catch(e) {
        console.error("Failed to fetch WS ticket", e);
    }

    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        console.log("WebSocket connected to", wsUrl);
        isConnecting = false;
    };

    socket.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === "new_mail") {
                await handleNewMail(data);
            }
        } catch (e) {
            console.error("WS message error", e);
        }
    };

    socket.onclose = () => {
        isConnecting = false;
        // Only reconnect if we still have a tempEmail
        browser.storage.local.get("tempEmail").then(res => {
            if (res.tempEmail) {
                clearTimeout(reconnectTimer);
                reconnectTimer = setTimeout(() => initWebSocket(true), 5000);
            }
        });
    };
    
    socket.onerror = (err) => {
        console.error("WebSocket error:", err);
        isConnecting = false;
    };
}

// Process new incoming mail
async function handleNewMail(data) {
    const headers = await getAuthHeaders();
    try {
        const res = await fetch(`${API_BASE}/v1/ext/mailbox/${data.mailbox}/message/${data.id}`, { headers });
        if (!res.ok) return;
        
        const result = await res.json();
        const fullMsg = result.data || result;
        
        // Save to storage
        const changeFn = (currentSavedMessages) => {
            const currentMailboxData = currentSavedMessages?.[data.mailbox]?.data || [];
            if (!currentMailboxData.some(m => m.id === fullMsg.id)) {
                // Determine folder based on spam rules
                // For simplicity, we just put it in Inbox/Unread
                const newMsg = { ...fullMsg, folder: ["Inbox", "Unread"] };
                return {
                    ...currentSavedMessages,
                    [data.mailbox]: {
                        ...currentSavedMessages[data.mailbox],
                        data: [...currentMailboxData, newMsg]
                    }
                };
            }
            return currentSavedMessages;
        };
        await updateSavedMessages(changeFn);
        
        // Send to popup with folder property
        browser.runtime.sendMessage({ type: "NEW_MESSAGE", data: newMsg }).catch(() => {});
        
        browser.notifications.create({
            type: "basic",
            iconUrl: "icon61.png",
            title: `New Email from ${fullMsg.from}`,
            message: fullMsg.subject || "No Subject",
            priority: 2,
        });

        // Extract OTP
        const { settings } = await browser.storage.local.get("settings");
        if (settings?.Additional?.codeExtraction !== false && fullMsg.text) {
            const otp = extractOTP(fullMsg.text);
            if (otp) {
                await browser.storage.local.set({ latestOtp: otp });
                const tabs = await browser.tabs.query({ active: true, currentWindow: true });
                for (const tab of tabs) {
                    browser.tabs.sendMessage(tab.id, { type: "NEW_OTP", otp }).catch(() => {});
                }
            }
        }
        
        browser.runtime.sendMessage({ type: "NEW_MESSAGE", data: fullMsg }).catch(() => {});
    } catch (e) {
        console.error("Error handling new mail", e);
    }
}

function extractOTP(text, opts = {}) {
    opts = {
        minDigits: 4,
        maxDigits: 8,
        keywords: ['otp', 'verification', 'verify', 'code', 'passcode', 'pin', 'auth', 'security'],
        stopWords: [
            'please', 'your', 'this', 'that', 'thank', 'thanks', 'hello', 'dear', 'kindly',
            'click', 'link', 'visit', 'login', 'account', 'email', 'message', 'regards'
        ],
        ...opts
    };

    if (!text || typeof text !== 'string') return null;

    const lower = text.toLowerCase();

    if (!opts.keywords.some(k => lower.includes(k))) {
        return null;
    }

    const candidates = new Map();

    const pushCandidate = (val, score = 0, reason = '') => {
        if (!val) return;
        const key = val.trim();
        if (!key) return;
        if (!candidates.has(key)) {
            candidates.set(key, { token: key, score: 0, reasons: [] });
        }
        const entry = candidates.get(key);
        entry.score += score;
        entry.reasons.push(reason);
    };

    const numRegex = new RegExp(`\\b\\d{${opts.minDigits},${opts.maxDigits}}\\b`, 'g');
    let m;
    while ((m = numRegex.exec(text))) {
        pushCandidate(m[0], 50, 'numeric candidate');
    }

    const alphaNumRegex = /\b[A-Za-z0-9]{6,12}\b/g;
    while ((m = alphaNumRegex.exec(text))) {
        pushCandidate(m[0], 30, 'alphanumeric candidate');
    }

    for (const entry of candidates.values()) {
        const ltok = entry.token.toLowerCase();

        if (opts.stopWords.includes(ltok)) {
            entry.score = 0;
            continue;
        }

        for (const kw of opts.keywords) {
            const idx = lower.indexOf(kw);
            if (idx !== -1) {
                const distance = Math.abs(idx - text.indexOf(entry.token));
                if (distance < 50) entry.score += 40;
            }
        }

        if (/^\d{6}$/.test(entry.token)) entry.score += 20;
    }

    const list = Array.from(candidates.values())
        .filter(e => e.score > 0)
        .sort((a, b) => b.score - a.score);

    const best = list[0];
    if (!best) return null;
    if (!/\d/.test(best.token)) return null;
    if (best.score < 50) return null;

    return best.token;
}

// Message Listeners
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    
    if (message.type === "FETCH_MAILBOX") {
        (async () => {
            try {
                if (!message.address) throw new Error("No address provided");
                const headers = await getAuthHeaders();
                const res = await fetch(`${API_BASE}/v1/ext/mailbox/${message.address}`, { headers, method: "GET" });
                
                if (!res.ok) throw new Error(`API Error: ${res.status}`);
                
                const responseData = await res.json();
                const apiMessages = responseData.data || [];
                
                const { savedMessages = {} } = await browser.storage.local.get("savedMessages");
                const existingMailboxData = savedMessages[message.address]?.data || [];
                const existingIds = new Set(existingMailboxData.map(msg => msg.id));
                
                const newMessages = apiMessages.filter(msg => !existingIds.has(msg.id)).map(e => ({
                    ...e,
                    folder: ["Inbox", "Unread"]
                }));
                
                const combinedData = [...existingMailboxData, ...newMessages];
                
                await browser.storage.local.set({
                    savedMessages: {
                        ...savedMessages,
                        [message.address]: {
                            data: combinedData,
                            timestamp: Date.now()
                        }
                    }
                });

                const reqData = combinedData.filter((m) => (m?.folder || []).includes(message.folder));
                sendResponse({ success: true, data: reqData });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }

    if (message.type === "FETCH_MESSAGE") {
        (async () => {
            try {
                if (!message.address || !message.id) throw new Error("Missing params");
                
                const { savedMessages = {} } = await browser.storage.local.get("savedMessages");
                const mailboxData = savedMessages?.[message.address]?.data || [];
                const cached = mailboxData.find((msg) => msg.id === message.id);
                
                if (cached?.html || cached?.text) {
                    sendResponse({ success: true, data: cached });
                    return;
                }
                
                const headers = await getAuthHeaders();
                const res = await fetch(`${API_BASE}/v1/ext/mailbox/${message.address}/message/${message.id}`, { headers, method: 'GET' });
                if (!res.ok) throw new Error(`API Error: ${res.status}`);
                
                const apiResponse = await res.json();
                const fetchedData = apiResponse.data || apiResponse;
                
                const changeFn = (currentSavedMessages) => {
                    const currentMailboxData = currentSavedMessages?.[message.address]?.data || [];
                    const updatedMailbox = currentMailboxData.map((msg) =>
                        msg.id === message.id ? { ...msg, ...fetchedData } : msg
                    );
                    return {
                        ...currentSavedMessages,
                        [message.address]: {
                            ...currentSavedMessages[message.address],
                            data: updatedMailbox
                        }
                    };
                };
                await updateSavedMessages(changeFn);
                
                sendResponse({ success: true, data: fetchedData });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (message.type === "DELETE_MESSAGE") {
        (async () => {
            try {
                if (!message.address || !message.id) throw new Error("Missing params");
                const headers = await getAuthHeaders();
                const res = await fetch(`${API_BASE}/v1/ext/mailbox/${message.address}/message/${message.id}`, { headers, method: "DELETE" });
                if (!res.ok) throw new Error(`API Error: ${res.status}`);
                
                const { savedMessages = {} } = await browser.storage.local.get("savedMessages");
                const mailboxData = savedMessages[message.address]?.data || [];
                const updatedMailbox = mailboxData.filter((msg) => msg.id !== message.id);
                
                await browser.storage.local.set({
                    savedMessages: {
                        ...savedMessages,
                        [message.address]: {
                            data: updatedMailbox,
                            timestamp: Date.now(),
                        },
                    },
                });
                
                sendResponse({ success: true });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (message.type === "FOLDER_CHANGE") {
        (async () => {
            try {
                const changeFn = (currentSavedMessages) => {
                    const mailboxData = currentSavedMessages?.[message.address]?.data || [];
                    const cachedIndex = mailboxData.findIndex((msg) => msg.id === message.id);
                    if (cachedIndex === -1) return currentSavedMessages;
                    
                    const cached = mailboxData[cachedIndex];
                    let folders = [...cached.folder];
                    const moveTo = message.folder;
                    
                    // Simple folder logic
                    if (moveTo === "Read") folders = folders.filter(f => f !== "Unread");
                    else if (moveTo === "Unstarred") folders = folders.filter(f => f !== "Starred");
                    else if (moveTo === "Starred") folders.push("Starred");
                    else {
                        folders = folders.filter(f => f !== "Inbox" && f !== "Spam" && f !== "Trash");
                        folders.push(moveTo);
                    }
                    
                    const newMailboxData = [...mailboxData];
                    newMailboxData[cachedIndex] = { ...cached, folder: [...new Set(folders)] };
                    
                    return {
                        ...currentSavedMessages,
                        [message.address]: {
                            ...currentSavedMessages[message.address],
                            data: newMailboxData,
                        },
                    };
                };
                await updateSavedMessages(changeFn);
                sendResponse({ success: true });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (message.type === "SET_EXT_TOKEN") {
        browser.storage.local.set({ extToken: message.token }).then(() => {
            initWebSocket();
            sendResponse({ success: true });
        });
        return true;
    }

    if (message.type === "UPDATE_ACTIVE_MAILBOX") {
        (async () => {
            const { extToken } = await browser.storage.local.get("extToken");
            const newEmail = message.email;
            
            // If user is logged in, sync with backend inboxes
            if (extToken && newEmail) {
                const headers = await getAuthHeaders();
                try {
                    // First, fetch existing inboxes
                    const inboxesRes = await fetch(`${API_BASE}/v1/ext/inboxes`, { headers });
                    if (inboxesRes.ok) {
                        const inboxesData = await inboxesRes.json();
                        const userInboxes = inboxesData.data || [];
                        
                        // Check if this inbox already exists
                        const inboxExists = userInboxes.some(ib => 
                            (typeof ib === 'string' ? ib === newEmail : (ib.inboxName === newEmail || ib.email === newEmail))
                        );
                        
                        if (!inboxExists) {
                            // Register the new inbox
                            await fetch(`${API_BASE}/v1/ext/register-inbox`, {
                                method: "POST",
                                headers,
                                body: JSON.stringify({ inboxName: newEmail })
                            });
                            console.log("Inbox registered:", newEmail);
                        }
                    }
                } catch (e) {
                    console.error("Failed to sync inbox with backend", e);
                }
            }
            
            currentMailbox = newEmail;
            browser.storage.local.set({ tempEmail: newEmail }).then(() => {
                initWebSocket(true);
                sendResponse({ success: true });
            });
        })();
        return true;
    }
    
    if (message.type === "GET_LATEST_OTP") {
        browser.storage.local.get("latestOtp").then(res => {
            sendResponse({ otp: res.latestOtp });
        });
        return true;
    }
    
    if (message.type === "INIT_SOCKET") {
        initWebSocket();
        sendResponse({ success: true });
        return true;
    }
    
    // Polyfill for settings, email history, etc
    if (message.action === "getEmailSuggestions") {
        browser.storage.local.get(["settings", "tempEmail"]).then(res => {
            const settings = res.settings || {};
            if (settings.Additional?.suggestions !== false) {
                sendResponse({ suggestions: [res.tempEmail] });
            } else {
                sendResponse({ suggestions: [] });
            }
        });
        return true;
    }

    if (message.action === "getOtpSuggestion") {
        browser.storage.local.get(["settings", "latestOtp"]).then(res => {
            const settings = res.settings || {};
            if (settings.Additional?.codeExtraction !== false && res.latestOtp) {
                sendResponse({ otp: res.latestOtp });
            } else {
                sendResponse({});
            }
        });
        return true;
    }

    if (message.action === "genRandomEmail") {
        (async () => {
            const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
            let result = '';
            for (let i = 0; i < 10; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
            
            // Fetch domains from backend
            let domainsList = ["junkstopper.info", "areueally.info"]; // fallback
            try {
                const res = await fetch(`${API_BASE}/domains`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.data && data.data.length > 0) {
                        domainsList = data.data.map(d => d.domain);
                    }
                }
            } catch(e) {}
            
            const rndDomain = domainsList[Math.floor(Math.random() * domainsList.length)];
            const tempEmail = result + '@' + rndDomain;
            await browser.storage.local.set({ tempEmail });
            initWebSocket(true);
            sendResponse({ tempEmail });
        })();
        return true;
    }

    if (message.type === "EMAIL_COUNTS") {
        browser.storage.local.get("emailCounts").then(res => {
            const counts = res.emailCounts || {};
            const addressCounts = counts[message.address] || { Inbox: 0, Unread: 0, Starred: 0, Spam: 0, Trash: 0 };
            sendResponse({ success: true, data: addressCounts });
        });
        return true;
    }
    
    if (message.type === "EMAIL_HISTORY") {
        (async () => {
            const { extToken } = await browser.storage.local.get("extToken");
            if (extToken) {
                // If Pro, fetch from backend
                try {
                    const payload = JSON.parse(atob(extToken.split('.')[1]));
                    if (payload.plan === 'pro') {
                        const headers = await getAuthHeaders();
                        const meRes = await fetch(`${API_BASE}/v1/me`, { headers });
                        if (meRes.ok) {
                            const meData = await meRes.json();
                            const user = meData.data;
                            if (user && user.inboxes) {
                                sendResponse({ success: true, data: user.inboxes });
                                return;
                            }
                        }
                    }
                } catch (e) {
                    console.error("Failed to fetch history from backend", e);
                }
            }
            
            // Fallback to local history
            browser.storage.local.get("emailHistory").then(res => {
                sendResponse({ success: true, data: res.emailHistory || [] });
            });
        })();
        return true;
    }
    
    if (message.type === "FETCH_SETTINGS") {
        browser.storage.local.get("settings").then(res => {
            const settings = res.settings || {};
            sendResponse({ success: true, data: { [message.tab]: settings[message.tab] } });
        });
        return true;
    }
    
    if (message.type === "SAVE_SETTINGS") {
        browser.storage.local.get("settings").then(res => {
            const settings = res.settings || {};
            browser.storage.local.set({ settings: { ...settings, [message.tab]: message.settings } }).then(() => {
                sendResponse({ success: true });
            });
        });
        return true;
    }
});

browser.storage.local.get(["tempEmail", "extToken"]).then(async (res) => {
    if (res.extToken) {
        // If logged in, fetch profile to get latest inboxes
        try {
            const headers = await getAuthHeaders();
            const meRes = await fetch(`${API_BASE}/v1/me`, { headers });
            if (meRes.ok) {
                const meData = await meRes.json();
                const user = meData.data;
                if (user && user.inboxes && user.inboxes.length > 0) {
                    const lastUsed = user.inboxes[0];
                    await browser.storage.local.set({ tempEmail: lastUsed });
                    currentMailbox = lastUsed;
                }
            }
        } catch (e) {
            console.error("Failed to fetch profile on init", e);
        }
    }
    
    const data = await browser.storage.local.get("tempEmail");
    if (data.tempEmail) {
        initWebSocket();
    }
});
