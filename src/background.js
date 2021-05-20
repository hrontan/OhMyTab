'use strict';

{
    let defaultSetting = {
        glue: true,
        depclean: true,
        sorttab: true,
        sortkey: 'url',
        refresh: true,
        comclose: false,
        iconbadge: false,
        iconbadgescope: 'all',
        rxclose: false,
        currentonly: false,
        contextmenu1: false,
        contextmenu1scope: 'win',
        contextmenu2: false,
        contextmenu3: true,
        contextmenu4: false,
        contextmenu4scope: 'win',
    }

    var loadSettingAsync = () => {
        return new Promise((resolve, reject) => {
            try {
                chrome.storage.sync.get(defaultSetting, resolve);
            } catch (e) {
                reject(e);
            }
        });
    }

    var storeSettingAsync = (data) => {
        return new Promise((resolve, reject) => {
            try {
                chrome.storage.sync.set(data, resolve);
            } catch (e) {
                reject(e);
            }
        });
    }

    let getTabsAsync = (isCurrentOnly) => {
        return new Promise((resolve, reject) => {
            try {
                let queryOptions = { windowType: "normal", pinned: false, currentWindow: isCurrentOnly };
                chrome.tabs.query(queryOptions, resolve);
            } catch (e) {
                reject(e);
            }
        });
    }

    let moveTabsAsync = (tabIDs, winID) => {
        return new Promise((resolve, reject) => {
            if (tabIDs.length == 0) return;
            try {
                chrome.tabs.move(tabIDs, { index: -1, windowId: winID }, resolve);
            } catch (e) {
                reject(e);
            }
        });
    }

    let removeTabsAsync = (tabIDs) => {
        return new Promise((resolve, reject) => {
            try {
                chrome.tabs.remove(tabIDs, resolve);
            } catch (e) {
                reject(e);
            }
        });
    }

    let reloadTabAsync = (tabID) => {
        return new Promise((resolve, reject) => {
            try {
                chrome.tabs.reload(tabID, resolve);
            } catch (e) {
                reject(e);
            }
        });
    }

    let getActiveWinAsync = () => {
        return new Promise((resolve, reject) => {
            try {
                chrome.windows.getCurrent(resolve);
            } catch (e) {
                reject(e);
            }
        });
    }

    let createNewWinAsync = (tabID) => {
        return new Promise((resolve, reject) => {
            try {
                let queryOptions = { focused: true, tabId: tabID };
                chrome.windows.create(queryOptions, resolve);
            } catch (e) {
                reject(e);
            }
        });
    }

    const RX_SYSTEM = /^(chrome|chrome-extension|about):\/\//;
    const RX_SEARCH_ENGINE = /^(http|https):\/\/((www\.google\.com|www\.google\.ad|www\.google\.ae|www\.google\.com\.af|www\.google\.com\.ag|www\.google\.com\.ai|www\.google\.al|www\.google\.am|www\.google\.co\.ao|www\.google\.com\.ar|www\.google\.as|www\.google\.at|www\.google\.com\.au|www\.google\.az|www\.google\.ba|www\.google\.com\.bd|www\.google\.be|www\.google\.bf|www\.google\.bg|www\.google\.com\.bh|www\.google\.bi|www\.google\.bj|www\.google\.com\.bn|www\.google\.com\.bo|www\.google\.com\.br|www\.google\.bs|www\.google\.bt|www\.google\.co\.bw|www\.google\.by|www\.google\.com\.bz|www\.google\.ca|www\.google\.cd|www\.google\.cf|www\.google\.cg|www\.google\.ch|www\.google\.ci|www\.google\.co\.ck|www\.google\.cl|www\.google\.cm|www\.google\.cn|www\.google\.com\.co|www\.google\.co\.cr|www\.google\.com\.cu|www\.google\.cv|www\.google\.com\.cy|www\.google\.cz|www\.google\.de|www\.google\.dj|www\.google\.dk|www\.google\.dm|www\.google\.com\.do|www\.google\.dz|www\.google\.com\.ec|www\.google\.ee|www\.google\.com\.eg|www\.google\.es|www\.google\.com\.et|www\.google\.fi|www\.google\.com\.fj|www\.google\.fm|www\.google\.fr|www\.google\.ga|www\.google\.ge|www\.google\.gg|www\.google\.com\.gh|www\.google\.com\.gi|www\.google\.gl|www\.google\.gm|www\.google\.gp|www\.google\.gr|www\.google\.com\.gt|www\.google\.gy|www\.google\.com\.hk|www\.google\.hn|www\.google\.hr|www\.google\.ht|www\.google\.hu|www\.google\.co\.id|www\.google\.ie|www\.google\.co\.il|www\.google\.im|www\.google\.co\.in|www\.google\.iq|www\.google\.is|www\.google\.it|www\.google\.je|www\.google\.com\.jm|www\.google\.jo|www\.google\.co\.jp|www\.google\.co\.ke|www\.google\.com\.kh|www\.google\.ki|www\.google\.kg|www\.google\.co\.kr|www\.google\.com\.kw|www\.google\.kz|www\.google\.la|www\.google\.com\.lb|www\.google\.li|www\.google\.lk|www\.google\.co\.ls|www\.google\.lt|www\.google\.lu|www\.google\.lv|www\.google\.com\.ly|www\.google\.co\.ma|www\.google\.md|www\.google\.me|www\.google\.mg|www\.google\.mk|www\.google\.ml|www\.google\.com\.mm|www\.google\.mn|www\.google\.ms|www\.google\.com\.mt|www\.google\.mu|www\.google\.mv|www\.google\.mw|www\.google\.com\.mx|www\.google\.com\.my|www\.google\.co\.mz|www\.google\.com\.na|www\.google\.com\.nf|www\.google\.com\.ng|www\.google\.com\.ni|www\.google\.ne|www\.google\.nl|www\.google\.no|www\.google\.com\.np|www\.google\.nr|www\.google\.nu|www\.google\.co\.nz|www\.google\.com\.om|www\.google\.com\.pa|www\.google\.com\.pe|www\.google\.com\.pg|www\.google\.com\.ph|www\.google\.com\.pk|www\.google\.pl|www\.google\.pn|www\.google\.com\.pr|www\.google\.ps|www\.google\.pt|www\.google\.com\.py|www\.google\.com\.qa|www\.google\.ro|www\.google\.ru|www\.google\.rw|www\.google\.com\.sa|www\.google\.com\.sb|www\.google\.sc|www\.google\.se|www\.google\.com\.sg|www\.google\.sh|www\.google\.si|www\.google\.sk|www\.google\.com\.sl|www\.google\.sn|www\.google\.so|www\.google\.sm|www\.google\.sr|www\.google\.st|www\.google\.com\.sv|www\.google\.td|www\.google\.tg|www\.google\.co\.th|www\.google\.com\.tj|www\.google\.tk|www\.google\.tl|www\.google\.tm|www\.google\.tn|www\.google\.to|www\.google\.com\.tr|www\.google\.tt|www\.google\.com\.tw|www\.google\.co\.tz|www\.google\.com\.ua|www\.google\.co\.ug|www\.google\.co\.uk|www\.google\.com\.uy|www\.google\.co\.uz|www\.google\.com\.vc|www\.google\.co\.ve|www\.google\.vg|www\.google\.co\.vi|www\.google\.com\.vn|www\.google\.vu|www\.google\.ws|www\.google\.rs|www\.google\.co\.za|www\.google\.co\.zm|www\.google\.co\.zw|www\.google\.cat|www\.bing\.com|search\.yahoo\.co\.jp)\/search|www\.baidu\.com\/s)/;

    let closeTabsRxAsync = async (isCurrentOnly, rx) => {
        const tabs = await getTabsAsync(isCurrentOnly);
        let tabIDs = tabs.filter(tab => rx.test(tab.url)).map(tab => tab.id);
        await removeTabsAsync(tabIDs).catch(e => console.warn(e, this));
    }

    let closeTabsFilterAsync = async (isCurrentOnly, filterFunc) => {
        const tabs = await getTabsAsync(isCurrentOnly);
        let tabIDs = tabs.filter(tab => filterFunc(tab)).map(tab => tab.id);
        await removeTabsAsync(tabIDs).catch(e => console.warn(e, this));
    }

    let closeRepTabsAsync = async (isCurrentOnly) => {
        const tabs = await getTabsAsync(isCurrentOnly);
        let tabIDs = tabs.filter((cTab, i) => tabs.slice(i + 1)
            .reduce((prev, tab) => cTab.url === tab.url || prev, false))
            .map(tab => tab.id);
        await removeTabsAsync(tabIDs).catch(e => console.warn(e, this));
    }

    let glueTabAsync = async () => {
        const [cWin, tabs] = await Promise.all([getActiveWinAsync(), getTabsAsync(false)]);
        await moveTabsAsync(tabs.map(el => el.id), cWin.id);
    }

    let refreshTabsAsync = async (isCurrentOnly) => {
        const tabs = await getTabsAsync(isCurrentOnly);
        let ps = tabs.filter(el => el.discarded)
            .map(el => reloadTabAsync(el.id));
        await Promise.all(ps);
    }

    let updateIconBadgeAsync = async (isEnabled, scope) => {
        if (isEnabled) {
            if (scope == 'win') {
                const tabs = await getTabsAsync(true);
                tabs.map(el => chrome.browserAction.setBadgeText({ text: tabs.length.toString(), tabId: el.id }));
            } else {
                const tabs = await getTabsAsync(false);
                chrome.browserAction.setBadgeText({ text: tabs.length.toString() });
            }
        } else {
            chrome.browserAction.setBadgeText({ text: "" });
        }
    }

    const cmpURL = (a, b) => {
        const ta = a.url.toLowerCase();
        const tb = b.url.toLowerCase();
        if (ta < tb) return -1;
        else if (ta > tb) return 1;
        else return 0;
    }

    const cmpTitle = (a, b) => {
        const ta = a.title.toLowerCase();
        const tb = b.title.toLowerCase();
        if (ta < tb) return -1;
        else if (ta > tb) return 1;
        else return 0;
    }

    let sortTabAsync = async (isCurrentOnly, compareFunc) => {
        const tabs = await getTabsAsync(isCurrentOnly);
        console.log(tabs.map(el => el.id));
        let ps = tabs.sort(compareFunc)
            .map(el => moveTabsAsync(el.id));
        await Promise.all(ps);
    }

    let updateContextMenu = (prevState, nextState, id, title) => {
        if (prevState && !nextState) {
            chrome.contextMenus.remove(id)
        } else if (!prevState && nextState) {
            chrome.contextMenus.create({
                id, title,
                contexts: ['all']
            }, () => chrome.runtime.lastError);
        } else if (prevState && nextState) {
            chrome.contextMenus.update(id, { title });
        }
    }

    var updateContextMenus = (() => {
        let currentContextMenu1 = false;
        let currentContextMenu2 = false;
        let currentContextMenu3 = false;
        let currentContextMenu4 = false;
        return async () => {
            const items = await loadSettingAsync();

            const menuID1 = 'ohmytab1';
            const menuText1 = chrome.i18n.getMessage("text2") + chrome.i18n.getMessage(items.contextmenu1scope == 'win' ? "text0_0" : "text0_1");
            updateContextMenu(currentContextMenu1, items.contextmenu1, menuID1, menuText1);
            currentContextMenu1 = items.contextmenu1;

            const menuID4 = 'ohmytab2';
            const menuText4 = chrome.i18n.getMessage("text5") + chrome.i18n.getMessage(items.contextmenu4scope == 'win' ? "text0_0" : "text0_1");
            updateContextMenu(currentContextMenu4, items.contextmenu4, menuID4, menuText4);
            currentContextMenu4 = items.contextmenu4;

            const menuID2 = 'ohmytab3';
            const menuText2 = chrome.i18n.getMessage("text3");
            updateContextMenu(currentContextMenu2, items.contextmenu2, menuID2, menuText2);
            currentContextMenu2 = items.contextmenu2;

            const menuID3 = 'ohmytab4';
            const menuText3 = chrome.i18n.getMessage("text4");
            updateContextMenu(currentContextMenu3, items.contextmenu3, menuID3, menuText3);
            currentContextMenu3 = items.contextmenu3;
        }
    })();

    updateContextMenus();

    chrome.browserAction.onClicked.addListener(async () => {
        const items = await loadSettingAsync();
        const targetWindows = items.currentonly;
        if (items.glue) await glueTabAsync();
        if (items.comclose) await closeTabsRxAsync(targetWindows, RX_SYSTEM);
        if (items.rxclose) await closeTabsRxAsync(targetWindows, RX_SEARCH_ENGINE);
        if (items.depclean) await closeRepTabsAsync(targetWindows);
        if (items.refresh) await refreshTabsAsync(targetWindows);
        if (items.sorttab) {
            let f = (items.sortkey == 'url') ? cmpURL : cmpTitle;
            await sortTabAsync(targetWindows, f);
        }
        await updateIconBadgeAsync(items.iconbadge, items.iconbadgescope);
    })

    chrome.tabs.onUpdated.addListener(async () => {
        const items = await loadSettingAsync();
        await updateIconBadgeAsync(items.iconbadge, items.iconbadgescope);
    })

    chrome.tabs.onRemoved.addListener(async () => {
        const items = await loadSettingAsync();
        await updateIconBadgeAsync(items.iconbadge, items.iconbadgescope);
    })

    chrome.windows.onFocusChanged.addListener(async () => {
        const items = await loadSettingAsync();
        await updateIconBadgeAsync(items.iconbadge, items.iconbadgescope);
    })

    chrome.contextMenus.onClicked.addListener(async (info, tab) => {
        const items = await loadSettingAsync();

        if (info.menuItemId == 'ohmytab1') {
            const cTabURL = new URL(tab.url).hostname;
            await closeTabsFilterAsync(items.contextmenu1scope == 'win', (t) => new URL(t.url).hostname == cTabURL);
            await updateIconBadgeAsync(items.iconbadge, items.iconbadgescope);
        }

        if (info.menuItemId == 'ohmytab2') {
            const cTabURL = new URL(tab.url).hostname;
            const tabs = await getTabsAsync(items.contextmenu4scope == 'win');
            const tabIDs = tabs.filter((t) => new URL(t.url).hostname == cTabURL).filter((t) => t.id != tab.id).map((t) => t.id);

            const win = await createNewWinAsync(tab.id);
            await moveTabsAsync(tabIDs, win.id);
            await updateIconBadgeAsync(items.iconbadge, items.iconbadgescope);
        }

        if (info.menuItemId == 'ohmytab3') {
            await glueTabAsync();
            await updateIconBadgeAsync(items.iconbadge, items.iconbadgescope);
        }

        if (info.menuItemId == 'ohmytab4') {
            await createNewWinAsync(tab.id);
            await updateIconBadgeAsync(items.iconbadge, items.iconbadgescope);
        }
    })
}
