{
    let nullPromise = function () {
        return new Promise(function (resolve, reject) { });
    }

    let getTabsAsync = function () {
        return new Promise(function (resolve, reject) { chrome.tabs.query({}, resolve) });
    }

    let moveTabAsync = function (tabids, winid) {
        return new Promise(function (resolve, reject) { chrome.tabs.move(tabids, { index: -1, windowId: winid }, resolve) });
    }

    let removeTabAsync = function (tabid) {
        return new Promise(function (resolve, reject) { chrome.tabs.remove(tabid, resolve) });
    }

    let reloadTabAsync = function (tabid) {
        return new Promise(function (resolve, reject) { chrome.tabs.reload(tabid, resolve) });
    }

    let getcWinAsync = function () {
        return new Promise(function (resolve, reject) { chrome.windows.getCurrent(resolve) });
    }

    var re = /^chrome:\/\//;

    let comclose = async function (flag) {
        if (!flag) return;
        const tabs = await getTabsAsync();
        let ps = tabs.filter(tab => re.test(tab.url))
            .map(el => removeTabAsync(el.id));
        return Promise.all(ps);
    }

    var re2 = /^(http|https):\/\/((www\.google\.com|www\.google\.ad|www\.google\.ae|www\.google\.com\.af|www\.google\.com\.ag|www\.google\.com\.ai|www\.google\.al|www\.google\.am|www\.google\.co\.ao|www\.google\.com\.ar|www\.google\.as|www\.google\.at|www\.google\.com\.au|www\.google\.az|www\.google\.ba|www\.google\.com\.bd|www\.google\.be|www\.google\.bf|www\.google\.bg|www\.google\.com\.bh|www\.google\.bi|www\.google\.bj|www\.google\.com\.bn|www\.google\.com\.bo|www\.google\.com\.br|www\.google\.bs|www\.google\.bt|www\.google\.co\.bw|www\.google\.by|www\.google\.com\.bz|www\.google\.ca|www\.google\.cd|www\.google\.cf|www\.google\.cg|www\.google\.ch|www\.google\.ci|www\.google\.co\.ck|www\.google\.cl|www\.google\.cm|www\.google\.cn|www\.google\.com\.co|www\.google\.co\.cr|www\.google\.com\.cu|www\.google\.cv|www\.google\.com\.cy|www\.google\.cz|www\.google\.de|www\.google\.dj|www\.google\.dk|www\.google\.dm|www\.google\.com\.do|www\.google\.dz|www\.google\.com\.ec|www\.google\.ee|www\.google\.com\.eg|www\.google\.es|www\.google\.com\.et|www\.google\.fi|www\.google\.com\.fj|www\.google\.fm|www\.google\.fr|www\.google\.ga|www\.google\.ge|www\.google\.gg|www\.google\.com\.gh|www\.google\.com\.gi|www\.google\.gl|www\.google\.gm|www\.google\.gp|www\.google\.gr|www\.google\.com\.gt|www\.google\.gy|www\.google\.com\.hk|www\.google\.hn|www\.google\.hr|www\.google\.ht|www\.google\.hu|www\.google\.co\.id|www\.google\.ie|www\.google\.co\.il|www\.google\.im|www\.google\.co\.in|www\.google\.iq|www\.google\.is|www\.google\.it|www\.google\.je|www\.google\.com\.jm|www\.google\.jo|www\.google\.co\.jp|www\.google\.co\.ke|www\.google\.com\.kh|www\.google\.ki|www\.google\.kg|www\.google\.co\.kr|www\.google\.com\.kw|www\.google\.kz|www\.google\.la|www\.google\.com\.lb|www\.google\.li|www\.google\.lk|www\.google\.co\.ls|www\.google\.lt|www\.google\.lu|www\.google\.lv|www\.google\.com\.ly|www\.google\.co\.ma|www\.google\.md|www\.google\.me|www\.google\.mg|www\.google\.mk|www\.google\.ml|www\.google\.com\.mm|www\.google\.mn|www\.google\.ms|www\.google\.com\.mt|www\.google\.mu|www\.google\.mv|www\.google\.mw|www\.google\.com\.mx|www\.google\.com\.my|www\.google\.co\.mz|www\.google\.com\.na|www\.google\.com\.nf|www\.google\.com\.ng|www\.google\.com\.ni|www\.google\.ne|www\.google\.nl|www\.google\.no|www\.google\.com\.np|www\.google\.nr|www\.google\.nu|www\.google\.co\.nz|www\.google\.com\.om|www\.google\.com\.pa|www\.google\.com\.pe|www\.google\.com\.pg|www\.google\.com\.ph|www\.google\.com\.pk|www\.google\.pl|www\.google\.pn|www\.google\.com\.pr|www\.google\.ps|www\.google\.pt|www\.google\.com\.py|www\.google\.com\.qa|www\.google\.ro|www\.google\.ru|www\.google\.rw|www\.google\.com\.sa|www\.google\.com\.sb|www\.google\.sc|www\.google\.se|www\.google\.com\.sg|www\.google\.sh|www\.google\.si|www\.google\.sk|www\.google\.com\.sl|www\.google\.sn|www\.google\.so|www\.google\.sm|www\.google\.sr|www\.google\.st|www\.google\.com\.sv|www\.google\.td|www\.google\.tg|www\.google\.co\.th|www\.google\.com\.tj|www\.google\.tk|www\.google\.tl|www\.google\.tm|www\.google\.tn|www\.google\.to|www\.google\.com\.tr|www\.google\.tt|www\.google\.com\.tw|www\.google\.co\.tz|www\.google\.com\.ua|www\.google\.co\.ug|www\.google\.co\.uk|www\.google\.com\.uy|www\.google\.co\.uz|www\.google\.com\.vc|www\.google\.co\.ve|www\.google\.vg|www\.google\.co\.vi|www\.google\.com\.vn|www\.google\.vu|www\.google\.ws|www\.google\.rs|www\.google\.co\.za|www\.google\.co\.zm|www\.google\.co\.zw|www\.google\.cat|www\.bing\.com|search\.yahoo\.co\.jp)\/search|www\.baidu\.com\/s)/;

    let rxclose = async function (flag){
        if (!flag) return;
        const tabs = await getTabsAsync();
        let ps = tabs.filter(tab => re2.test(tab.url))
            .map(el => removeTabAsync(el.id));
        return Promise.all(ps);
    }

    let depclean = async function (flag) {
        if (!flag) return;
        const tabs = await getTabsAsync();
        let ps = tabs.filter((cTab, i) => tabs.slice(i + 1)
            .reduce((prev, tab) => cTab.url === tab.url || prev, false))
            .map(el => removeTabAsync(el.id));
        return Promise.all(ps);
    }

    let glue = function (flag) {
        if (!flag) return nullPromise();
        else return Promise.all([getcWinAsync(), getTabsAsync()])
            .then(([cWin, tabs]) => moveTabAsync(tabs.map(el => el.id), cWin.id));
    }

    let refresh = async function (flag) {
        if (!flag) return;
        const tabs = await getTabsAsync();
        let ps = tabs.filter(el => el.discarded)
            .map(el => reloadTabAsync(el.id));
        return Promise.all(ps);
    }

    let iconbadge = async function (flag) {
        if (flag) {
            const tabs = await getTabsAsync();
            chrome.browserAction.setBadgeText({ text: tabs.length.toString() });
        } else {
            chrome.browserAction.setBadgeText({ text: "" });
        }
        return;
    }

    let urlcmp = function (a, b) {
        a = a.url.toLowerCase();
        b = b.url.toLowerCase();
        if (a < b) return -1;
        else if (a > b) return 1;
        else return 0;
    }

    let titlecmp = function (a, b) {
        a = a.title.toLowerCase();
        b = b.title.toLowerCase();
        if (a < b) return -1;
        else if (a > b) return 1;
        else return 0;
    }

    let strcmp = { 'url': urlcmp, 'title': titlecmp }

    let sorttab = async function (flag, sorttype) {
        if (!flag) return;
        const tabs = await getTabsAsync();
        let ps = tabs.sort(strcmp[sorttype])
            .map(el => moveTabAsync(el.id));
        return Promise.all(ps);
    }

    chrome.browserAction.onClicked.addListener(function () {
        chrome.storage.sync.get({
            glue: true,
            comclose: false,
            rxclose: false,
            depclean: true,
            sorttab: true,
            sortkey: 'url',
            refresh: true,
            iconbadge: true,
        }, function (items) {
            var _ = nullPromise()
                .then(depclean(items.depclean))
                .then(comclose(items.comclose))
                .then(rxclose(items.rxclose))
                .then(glue(items.glue))
                .then(refresh(items.refresh))
                .then(sorttab(items.sorttab, items.sortkey))
                .then(iconbadge(items.iconbadge))
                .then(_ => _);
        });
    })

    chrome.tabs.onUpdated.addListener(function () {
        chrome.storage.sync.get({
            iconbadge: true,
        }, function (items) {
            var _ = nullPromise()
                .then(iconbadge(items.iconbadge))
                .then(_ => _);
        });
    })

    chrome.tabs.onRemoved.addListener(function () {
        chrome.storage.sync.get({
            iconbadge: true,
        }, function (items) {
            var _ = nullPromise()
                .then(iconbadge(items.iconbadge))
                .then(_ => _);
        });
    })

}
