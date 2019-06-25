function localizeHtmlPage() {
    var objects = document.getElementsByTagName('html');
    for (var j = 0; j < objects.length; j++) {
        var obj = objects[j];

        var valStrH = obj.innerHTML.toString();
        var valNewH = valStrH.replace(/__MSG_(\w+)__/g, function (match, v1) {
            return v1 ? chrome.i18n.getMessage(v1) : "";
        });

        if (valNewH != valStrH) {
            obj.innerHTML = valNewH;
        }
    }
}

function fixrefreshoption() {
    if (document.getElementById('sorttab').checked && document.getElementById('sortkey').value == 'title') {
        document.getElementById('refresh').checked = true;
        document.getElementById('refresh').disabled = true;
    } else {
        document.getElementById('refresh').disabled = false;
    }
}

function save_options() {
    fixrefreshoption();
    var glue = document.getElementById('glue').checked;
    var depclean = document.getElementById('depclean').checked;
    var sorttab = document.getElementById('sorttab').checked;
    var sortkey = document.getElementById('sortkey').value;
    var refresh = document.getElementById('refresh').checked;
    var comclose = document.getElementById('comclose').checked;
    var iconbadge = document.getElementById('iconbadge').checked;

    chrome.storage.sync.set({
        glue: glue,
        depclean: depclean,
        sorttab: sorttab,
        sortkey: sortkey,
        refresh: refresh,
        comclose: comclose,
        iconbadge: iconbadge
    });
}

function restore_options() {
    chrome.storage.sync.get({
        glue: true,
        depclean: true,
        sorttab: true,
        sortkey: 'url',
        refresh: true,
        comclose: false,
        iconbadge: false,
    }, function (items) {
        document.getElementById('glue').checked = items.glue;
        document.getElementById('depclean').checked = items.depclean;
        document.getElementById('sorttab').checked = items.sorttab;
        document.getElementById('sortkey').value = items.sortkey;
        document.getElementById('refresh').checked = items.refresh;
        document.getElementById('comclose').checked = items.comclose;
        document.getElementById('iconbadge').checked = items.iconbadge;
        fixrefreshoption();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    restore_options();
    localizeHtmlPage();
    document.getElementById('form').addEventListener('change', save_options);
});
