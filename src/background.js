{
	let nullPromise = function(){
		return new Promise(function(resolve, reject){});
	}

	let getTabsAsync = function(){
		return new Promise(function(resolve, reject){chrome.tabs.query({}, resolve)});
	}

	let moveTabAsync = function(tabids, winid){
		return new Promise(function(resolve, reject){chrome.tabs.move(tabids, {index:-1,windowId:winid}, resolve)});
	}

	let removeTabAsync = function(tabid){
		return new Promise(function(resolve, reject){chrome.tabs.remove(tabid, resolve)});
	}

	let reloadTabAsync = function(tabid){
		return new Promise(function(resolve, reject){chrome.tabs.reload(tabid, resolve)});
	}

	let getcWinAsync = function(){
		return new Promise(function(resolve, reject){chrome.windows.getCurrent(resolve)});
	}

	let depclean = function(flag){
		if(!flag) return nullPromise();
		else return getTabsAsync().then(tabs => {
				var ps = tabs.filter((cTab, i) => tabs.slice(i+1).reduce((prev, tab) => cTab.url === tab.url || prev, false))
				.map(el => removeTabAsync(el.id));
				return Promise.all(ps);
		});
	};

	let glue = function(flag){
		if(!flag) return nullPromise();
		else return Promise.all([getcWinAsync(), getTabsAsync()])
		.then(([cWin, tabs]) => moveTabAsync(tabs.map(el => el.id), cWin.id));
	};

	let refresh = function(flag){
		if(!flag) return nullPromise();
		else return getTabsAsync().then(tabs => {
				var ps = tabs.filter(el => el.discarded).map(el => reloadTabAsync(el.id));
				return Promise.all(ps);
		});
	};

	let urlcmp = function(a, b){
		a = a.url.toLowerCase();
		b = b.url.toLowerCase();
		if(a < b) return -1;
		else if(a > b) return 1;
		else return 0;
	};

	let titlecmp = function(a, b){
		a = a.title.toLowerCase();
		b = b.title.toLowerCase();
		if(a < b) return -1;
		else if(a > b) return 1;
		else return 0;
	};

	let strcmp = {'url': urlcmp, 'title': titlecmp}

	let sorttab = function(flag, sorttype){
		if(!flag) return nullPromise();
		else return getTabsAsync().then(tabs => {
				var ps = tabs.sort(strcmp[sorttype]).map(el => moveTabAsync(el.id));
				return Promise.all(ps);
		});
	};

	let main = function(){
		chrome.storage.sync.get({
				glue: true,
				depclean: true,
				sorttab: true,
				sortkey: 'url',
				refresh: true
			}, function(items) {
				var _ = nullPromise()
				.then(glue(items.glue))
				.then(refresh(items.refresh))
				.then(sorttab(items.sorttab, items.sortkey))
				.then(depclean(items.depclean))
				.then(_=> _);
		});
	};


	chrome.browserAction.onClicked.addListener(main);

}