'use strict';

{
    let localizeHtmlPage = function () {
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

    let fixoption = function () {
        if (document.getElementById('glue').checked) {
            document.getElementById('currentonly').checked = false;
            document.getElementById('currentonly').disabled = true;
        } else if (document.getElementById('currentonly').checked) {
            document.getElementById('glue').checked = false;
            document.getElementById('glue').disabled = true;
        } else {
            document.getElementById('currentonly').disabled = false;
            document.getElementById('glue').disabled = false;
        }
    }

    let save_options = function () {
        fixoption();
        var glue = document.getElementById('glue').checked;
        var depclean = document.getElementById('depclean').checked;
        var sorttab = document.getElementById('sorttab').checked;
        var sortkey = document.getElementById('sortkey').value;
        var refresh = document.getElementById('refresh').checked;
        var comclose = document.getElementById('comclose').checked;
        var iconbadge = document.getElementById('iconbadge').checked;
        var iconbadgescope = document.getElementById('iconbadgescope').value;
        var rxclose = document.getElementById('rxclose').checked;
        var currentonly = document.getElementById('currentonly').checked;
        var contextmenu1 = document.getElementById('contextmenu1').checked;
        var contextmenu1scope = document.getElementById('contextmenu1scope').value;
        var contextmenu2 = document.getElementById('contextmenu2').checked;

        chrome.storage.sync.set({
            glue: glue,
            depclean: depclean,
            sorttab: sorttab,
            sortkey: sortkey,
            refresh: refresh,
            comclose: comclose,
            iconbadge: iconbadge,
            iconbadgescope: iconbadgescope,
            rxclose: rxclose,
            currentonly: currentonly,
            contextmenu1: contextmenu1,
            contextmenu1scope: contextmenu1scope,
            contextmenu2: contextmenu2,
        });
        const bg = chrome.extension.getBackgroundPage();
        bg.updateContextMenu();
    }

    let restore_options = function () {
        chrome.storage.sync.get({
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
            contextmenu1scope: 'all',
            contextmenu2: false,
        }, function (items) {
            document.getElementById('glue').checked = items.glue;
            document.getElementById('depclean').checked = items.depclean;
            document.getElementById('sorttab').checked = items.sorttab;
            document.getElementById('sortkey').value = items.sortkey;
            document.getElementById('refresh').checked = items.refresh;
            document.getElementById('comclose').checked = items.comclose;
            document.getElementById('iconbadge').checked = items.iconbadge;
            document.getElementById('iconbadgescope').value = items.iconbadgescope;
            document.getElementById('rxclose').checked = items.rxclose;
            document.getElementById('currentonly').checked = items.currentonly;
            document.getElementById('contextmenu1').checked = items.contextmenu1;
            document.getElementById('contextmenu1scope').value = items.contextmenu1scope;
            document.getElementById('contextmenu2').checked = items.contextmenu2;
            fixoption();
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        restore_options();
        localizeHtmlPage();
        document.getElementById('form').addEventListener('change', save_options);
    });
}