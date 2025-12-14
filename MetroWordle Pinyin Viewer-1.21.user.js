// ==UserScript==
// @name         MetroWordle Pinyin Viewer
// @namespace    http://tampermonkey.net/
// @version      1.21
// @description  在 MetroWordle 中自动显示已提交词的拼音，并支持手动查询
// @author       bilibili@lvshu
// @match        https://metrowordle.fun/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // 防重复运行
    if (document.getElementById('pinyin-viewer')) return;

    let pinyinProLoaded = false;
    let uiMounted = false;

    // === 1. 加载 pinyin-pro===
    if (!window.pinyinPro) {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/pinyin-pro';
        script.onload = () => {
            pinyinProLoaded = true;
            maybeInit();
        };
        script.onerror = () => {
            console.warn('[Pinyin Viewer] pinyin-pro 加载失败，手动查询将不可用');
            maybeInit(); // 仍允许显示 UI
        };
        document.head.appendChild(script);
    } else {
        pinyinProLoaded = true;
    }

    // === 尝试创建 UI（最多重试 10 次，每 800ms 一次）===
    let retryCount = 0;
    const maxRetries = 10;
    const tryCreateUI = () => {
        if (document.getElementById('pinyin-viewer') || uiMounted) return;

        // 确保 body 可用
        if (!document.body) {
            if (retryCount++ < maxRetries) setTimeout(tryCreateUI, 800);
            return;
        }

        // 只有当 body 存在才创建
        createUI();
        uiMounted = true;
    };

    // 初始尝试
    if (document.body) {
        tryCreateUI();
    } else {
        const observer = new MutationObserver(() => {
            if (document.body) {
                observer.disconnect();
                tryCreateUI();
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    // 如果 body 迟到，继续重试
    const retryInterval = setInterval(() => {
        if (!uiMounted && retryCount++ < maxRetries) {
            tryCreateUI();
        } else {
            clearInterval(retryInterval);
        }
    }, 800);

    // === 创建 UI 函数 ===
    function createUI() {
        const container = document.createElement('div');
        container.id = 'pinyin-viewer';
        container.innerHTML = `
            <div style="background:#6aaa64; color:white; padding:6px 12px; border-radius:8px 8px 0 0; font-weight:bold; cursor:move; text-align:center;">
                拼音表
            </div>
            <div style="background:#fff; padding:10px; border-radius:0 0 8px 8px; box-shadow:0 2px 10px rgba(0,0,0,0.2);">
                <div id="auto-pinyin" style="margin-bottom:12px; font-size:0.9em; line-height:1.4;">
                    <div><strong>玩家最新词：</strong><span id="player-pinyin">-</span></div>
                </div>
                <div style="display:flex; gap:6px; align-items:center;">
                    <input type="text" id="manual-query" placeholder="输入词查拼音" style="flex:1; padding:4px 8px; border:1px solid #ccc; border-radius:4px; font-size:0.9em;">
                    <button id="query-btn" style="padding:4px 8px; background:#6aaa64; color:white; border:none; border-radius:4px; cursor:pointer;">查</button>
                </div>
                <div id="manual-result" style="margin-top:8px; font-size:0.9em; min-height:1.2em; color:#333;"></div>
            </div>
        `;
        Object.assign(container.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: 10000,
            borderRadius: '8px',
            maxWidth: '280px',
            fontSize: '14px',
            fontFamily: 'sans-serif'
        });
        document.body.appendChild(container);

        // 拖拽（暂时没修好）
        const header = container.firstChild;
        let isDragging = false, offsetX, offsetY;
        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            offsetX = e.clientX - container.getBoundingClientRect().left;
            offsetY = e.clientY - container.getBoundingClientRect().top;
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            container.style.left = (e.clientX - offsetX) + 'px';
            container.style.top = (e.clientY - offsetY) + 'px';
            container.style.right = 'auto';
            container.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', () => isDragging = false);

        // 功能初始化
        initFunctionality();
    }

    function initFunctionality() {
        // === 拼音函数===
        function getPinyin(char) {
            if (!pinyinProLoaded || !window.pinyinPro) return char;
            try {
                return window.pinyinPro.pinyin(char, {
                    toneType: 'num',
                    v: true,
                    nonZh: 'consecutive'
                });
            } catch (e) {
                return char;
            }
        }

        function isChineseChar(char) {
            return /^[\u4e00-\u9fa5]$/.test(char);
        }

        function formatPinyin(word) {
            if (!word) return '';
            return [...word].map(char => {
                return isChineseChar(char) ? getPinyin(char) : char;
            }).join(' ');
        }

        // === 手动查询 ===
        const queryBtn = document.getElementById('query-btn');
        const input = document.getElementById('manual-query');
        const result = document.getElementById('manual-result');
        const handleQuery = () => {
            const text = input.value.trim();
            result.textContent = text ? formatPinyin(text) : '';
        };
        queryBtn?.addEventListener('click', handleQuery);
        input?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleQuery();
        });

        // === 自动提取最新词===
        function extractLatestWord(selector) {
            const board = document.querySelector(selector);
            if (!board) return null;
            const rows = board.querySelectorAll('.flex.gap-2.justify-center');
            for (let i = 0; i < rows.length; i++) {
                const boxes = Array.from(rows[i].querySelectorAll('div'));
                if (boxes.length === 0) continue;
                let word = '';
                let complete = true;
                for (const box of boxes) {
                    const txt = box.textContent.trim();
                    if (!txt || txt === '?') {
                        complete = false;
                        break;
                    }
                    word += txt;
                }
                if (!complete) continue;
                // 检查是否已反馈
                const hasFeedback = boxes.some(b =>
                    b.classList.contains('bg-success') ||
                    b.classList.contains('bg-warning') ||
                    b.classList.contains('bg-blue') ||
                    b.classList.contains('bg-neutral')
                );
                if (hasFeedback) return word;
            }
            return null;
        }

        // === 更新拼音 ===
        let lastPlayer = '';
        let lastOpponent = '';
        function updatePinyin() {
            try {
                const player = extractLatestWord('.grid.gap-3.max-w-2xl.mx-auto') || '';
                const opponent = extractLatestWord('#opponent-panel .grid.gap-3.max-w-md.mx-auto') || '';

                if (player !== lastPlayer) {
                    lastPlayer = player;
                    document.getElementById('player-pinyin').textContent = player ? formatPinyin(player) : '-';
                }
                if (opponent !== lastOpponent) {
                    lastOpponent = opponent;
                    document.getElementById('opponent-pinyin').textContent = opponent ? formatPinyin(opponent) : '-';
                }
            } catch (e) {
                console.warn('[Pinyin Viewer] 自动更新失败:', e);
            }
        }

        // 更新
        setInterval(updatePinyin, 1200);
    }

    // 初始化
    function maybeInit() {
        if (document.body && !uiMounted) {
            tryCreateUI();
        }
    }
})();