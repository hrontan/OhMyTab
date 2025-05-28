import { myBrowser } from "./api";
import { getSetting } from "./setting";

export type ContextMenuItemIdType =
  | "ohmytab_close_tabs"
  | "ohmytab_extract_tabs"
  | "ohmytab_glue_windows"
  | "ohmytab_extract_tab"
  | "ohmytab_close_l0"
  | "ohmytab_close_l1"
  | "ohmytab_close_l2"
  | "ohmytab_close_l3"
  | "ohmytab_close_l4"
  | "ohmytab_extract_l0"
  | "ohmytab_extract_l1"
  | "ohmytab_extract_l2"
  | "ohmytab_extract_l3"
  | "ohmytab_extract_l4";

type ContextMenuType =
  | {
      id: ContextMenuItemIdType;
      title: string;
      type: "normal" | "checkbox" | "radio";
      isEnable: boolean;
    }
  | {
      id: string;
      type: "separator";
    };

const createContextMenu = (contextMenus: ContextMenuType[]) => {
  contextMenus.forEach((menu) => {
    if (menu.type === "separator") {
      try {
        myBrowser.contextMenus.create({
          id: menu.id,
          type: "separator",
        });
      } catch (e) {
        console.log("createContextMenu", e);
      }
    } else {
      try {
        myBrowser.contextMenus.create({
          id: menu.id,
          title: menu.title,
          contexts: ["all"],
          visible: menu.isEnable,
        });
      } catch (e) {
        console.log("createContextMenu", e);
      }
    }
  });
};

const updateContextMenu = async (contextMenus: ContextMenuType[]) => {
  contextMenus.forEach(async (menu) => {
    if (menu.type != "separator") {
      try {
        await myBrowser.contextMenus.update(menu.id, {
          title: menu.title,
          visible: menu.isEnable,
        });
      } catch (e) {
        console.log("updateContextMenu", e);
      }
    }
  });
};

export const initializeContextMenus = async () => {
  try {
    await myBrowser.contextMenus.removeAll();

    const setting = await getSetting();

    const contextMenus: ContextMenuType[] = [
      {
        type: "normal",
        isEnable: setting.contextmenu3,
        id: "ohmytab_extract_tab",
        title: myBrowser.i18n.getMessage("text4"),
      },
      {
        type: "normal",
        isEnable: setting.contextmenu2,
        id: "ohmytab_glue_windows",
        title: myBrowser.i18n.getMessage("text3"),
      },
    ];
    createContextMenu(contextMenus);

    if (setting.contextmenu1) {
      const contextMenus2: ContextMenuType[] = [
        {
          type: "separator",
          id: "ohmytab_separator0",
        },
        {
          type: "normal",
          isEnable: true,
          id: "ohmytab_close_tabs",
          title:
            myBrowser.i18n.getMessage("text2") +
            myBrowser.i18n.getMessage(
              setting.contextmenu1scope === "win" ? "text0_0" : "text0_1",
            ),
        },
        {
          type: "normal",
          isEnable: false,
          id: "ohmytab_close_l0",
          title:
            myBrowser.i18n.getMessage("text6") +
            " [ ]" +
            myBrowser.i18n.getMessage(
              setting.contextmenu1scope === "win" ? "text0_0" : "text0_1",
            ),
        },
        {
          type: "normal",
          isEnable: false,
          id: "ohmytab_close_l1",
          title:
            myBrowser.i18n.getMessage("text6") +
            " [ ]" +
            myBrowser.i18n.getMessage(
              setting.contextmenu1scope === "win" ? "text0_0" : "text0_1",
            ),
        },
        {
          type: "normal",
          isEnable: false,
          id: "ohmytab_close_l2",
          title:
            myBrowser.i18n.getMessage("text6") +
            " [ ]" +
            myBrowser.i18n.getMessage(
              setting.contextmenu1scope === "win" ? "text0_0" : "text0_1",
            ),
        },
        {
          type: "normal",
          isEnable: false,
          id: "ohmytab_close_l3",
          title:
            myBrowser.i18n.getMessage("text6") +
            " [ ]" +
            myBrowser.i18n.getMessage(
              setting.contextmenu1scope === "win" ? "text0_0" : "text0_1",
            ),
        },
        {
          type: "normal",
          isEnable: false,
          id: "ohmytab_close_l4",
          title:
            myBrowser.i18n.getMessage("text6") +
            " [ ]" +
            myBrowser.i18n.getMessage(
              setting.contextmenu1scope === "win" ? "text0_0" : "text0_1",
            ),
        },
      ];
      createContextMenu(contextMenus2);
    }

    if (setting.contextmenu4) {
      const contextMenus3: ContextMenuType[] = [
        {
          id: "ohmytab_separator1",
          type: "separator",
        },
        {
          type: "normal",
          isEnable: true,
          id: "ohmytab_extract_tabs",
          title:
            myBrowser.i18n.getMessage("text5") +
            myBrowser.i18n.getMessage(
              setting.contextmenu4scope === "win" ? "text0_0" : "text0_1",
            ),
        },
        {
          type: "normal",
          isEnable: false,
          id: "ohmytab_extract_l0",
          title:
            myBrowser.i18n.getMessage("text6") +
            " [ ]" +
            myBrowser.i18n.getMessage(
              setting.contextmenu1scope === "win" ? "text0_0" : "text0_1",
            ),
        },
        {
          type: "normal",
          isEnable: false,
          id: "ohmytab_extract_l1",
          title:
            myBrowser.i18n.getMessage("text6") +
            " [ ]" +
            myBrowser.i18n.getMessage(
              setting.contextmenu1scope === "win" ? "text0_0" : "text0_1",
            ),
        },
        {
          type: "normal",
          isEnable: false,
          id: "ohmytab_extract_l2",
          title:
            myBrowser.i18n.getMessage("text6") +
            " [ ]" +
            myBrowser.i18n.getMessage(
              setting.contextmenu1scope === "win" ? "text0_0" : "text0_1",
            ),
        },
        {
          type: "normal",
          isEnable: false,
          id: "ohmytab_extract_l3",
          title:
            myBrowser.i18n.getMessage("text6") +
            " [ ]" +
            myBrowser.i18n.getMessage(
              setting.contextmenu1scope === "win" ? "text0_0" : "text0_1",
            ),
        },
        {
          type: "normal",
          isEnable: false,
          id: "ohmytab_extract_l4",
          title:
            myBrowser.i18n.getMessage("text6") +
            " [ ]" +
            myBrowser.i18n.getMessage(
              setting.contextmenu1scope === "win" ? "text0_0" : "text0_1",
            ),
        },
      ];
      createContextMenu(contextMenus3);
    }
  } catch (e) {
    console.log("initializeContextMenus failed", e);
  }
};

export const updateContextMenus = async (urls: string[]) => {
  try {
    const setting = await getSetting();

    const contextMenus1: ContextMenuType[] =
      setting.contextmenu1 && setting.contextmenu1advanced
        ? [
            {
              type: "normal",
              isEnable: urls[0] != null,
              id: "ohmytab_close_l0",
              title:
                myBrowser.i18n.getMessage("text6") +
                ` [(*.)${urls[0]}]` +
                myBrowser.i18n.getMessage(
                  setting.contextmenu1scope === "win" ? "text0_0" : "text0_1",
                ),
            },
            {
              type: "normal",
              isEnable: urls[1] != null,
              id: "ohmytab_close_l1",
              title:
                myBrowser.i18n.getMessage("text6") +
                ` [*.${urls[1]}]` +
                myBrowser.i18n.getMessage(
                  setting.contextmenu1scope === "win" ? "text0_0" : "text0_1",
                ),
            },
            {
              type: "normal",
              isEnable: urls[2] != null,
              id: "ohmytab_close_l2",
              title:
                myBrowser.i18n.getMessage("text6") +
                ` [*.${urls[2]}]` +
                myBrowser.i18n.getMessage(
                  setting.contextmenu1scope === "win" ? "text0_0" : "text0_1",
                ),
            },
            {
              type: "normal",
              isEnable: urls[3] != null,
              id: "ohmytab_close_l3",
              title:
                myBrowser.i18n.getMessage("text6") +
                ` [*.${urls[3]}]` +
                myBrowser.i18n.getMessage(
                  setting.contextmenu1scope === "win" ? "text0_0" : "text0_1",
                ),
            },
            {
              type: "normal",
              isEnable: urls[4] != null,
              id: "ohmytab_close_l4",
              title:
                myBrowser.i18n.getMessage("text6") +
                ` [*.${urls[4]}]` +
                myBrowser.i18n.getMessage(
                  setting.contextmenu1scope === "win" ? "text0_0" : "text0_1",
                ),
            },
          ]
        : [];

    const contextMenus2: ContextMenuType[] =
      setting.contextmenu4 && setting.contextmenu4advanced
        ? [
            {
              type: "normal",
              isEnable: urls[0] != null,
              id: "ohmytab_extract_l0",
              title:
                myBrowser.i18n.getMessage("text7") +
                ` [(*.)${urls[0]}]` +
                myBrowser.i18n.getMessage(
                  setting.contextmenu4scope === "win" ? "text0_0" : "text0_1",
                ),
            },
            {
              type: "normal",
              isEnable: urls[1] != null,
              id: "ohmytab_extract_l1",
              title:
                myBrowser.i18n.getMessage("text7") +
                ` [*.${urls[1]}]` +
                myBrowser.i18n.getMessage(
                  setting.contextmenu4scope === "win" ? "text0_0" : "text0_1",
                ),
            },
            {
              type: "normal",
              isEnable: urls[2] != null,
              id: "ohmytab_extract_l2",
              title:
                myBrowser.i18n.getMessage("text7") +
                ` [*.${urls[2]}]` +
                myBrowser.i18n.getMessage(
                  setting.contextmenu4scope === "win" ? "text0_0" : "text0_1",
                ),
            },
            {
              type: "normal",
              isEnable: urls[3] != null,
              id: "ohmytab_extract_l3",
              title:
                myBrowser.i18n.getMessage("text7") +
                ` [*.${urls[3]}]` +
                myBrowser.i18n.getMessage(
                  setting.contextmenu4scope === "win" ? "text0_0" : "text0_1",
                ),
            },
            {
              type: "normal",
              isEnable: urls[4] != null,
              id: "ohmytab_extract_l4",
              title:
                myBrowser.i18n.getMessage("text7") +
                ` [*.${urls[4]}]` +
                myBrowser.i18n.getMessage(
                  setting.contextmenu4scope === "win" ? "text0_0" : "text0_1",
                ),
            },
          ]
        : [];

    const contextMenus = [...contextMenus1, ...contextMenus2];
    await updateContextMenu(contextMenus);
  } catch (e) {
    console.log("updateContextMenus failed", e);
  }
};
