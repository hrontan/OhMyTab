'use strict';

{
    let localizeHtmlPage = () => {
        var objects = document.getElementsByTagName('html');
        for (var j = 0; j < objects.length; j++) {
            var obj = objects[j];

            var valStrH = obj.innerHTML.toString();
            var valNewH = valStrH.replace(/__MSG_(\w+)__/g, (_, v1) => {
                return v1 ? chrome.i18n.getMessage(v1) : "";
            });

            if (valNewH != valStrH) {
                obj.innerHTML = valNewH;
            }
        }
    }

    let fixOption = () => {
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

    let saveOptions = async () => {
        fixOption();

        let option = {
            glue: document.getElementById('glue').checked,
            depclean: document.getElementById('depclean').checked,
            sorttab: document.getElementById('sorttab').checked,
            sortkey: document.getElementById('sortkey').value,
            refresh: document.getElementById('refresh').checked,
            comclose: document.getElementById('comclose').checked,
            iconbadge: document.getElementById('iconbadge').checked,
            iconbadgescope: document.getElementById('iconbadgescope').value,
            rxclose: document.getElementById('rxclose').checked,
            currentonly: document.getElementById('currentonly').checked,
            contextmenu1: document.getElementById('contextmenu1').checked,
            contextmenu1scope: document.getElementById('contextmenu1scope').value,
            contextmenu2: document.getElementById('contextmenu2').checked,
            contextmenu3: document.getElementById('contextmenu3').checked,
            contextmenu4: document.getElementById('contextmenu4').checked,
            contextmenu4scope: document.getElementById('contextmenu4scope').value,
        };

        const bg = chrome.extension.getBackgroundPage();
        await bg.storeSettingAsync(option);
        bg.updateContextMenus();
    }

    let restoreOptions = async () => {
        const bg = chrome.extension.getBackgroundPage();
        const items = await bg.loadSettingAsync();

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
        document.getElementById('contextmenu3').checked = items.contextmenu3;
        document.getElementById('contextmenu4').checked = items.contextmenu4;
        document.getElementById('contextmenu4scope').value = items.contextmenu4scope;

        fixOption();
    }

    document.addEventListener('DOMContentLoaded', () => {
        restoreOptions();
        localizeHtmlPage();
        document.getElementById('form').addEventListener('change', saveOptions);
    });
}