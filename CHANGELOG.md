# Changelog / 変更履歴 / 更新记录

[English](#english) / [日本語](#日本語) / [简体中文](#简体中文)

Version-specific changes are listed below. Current procedures: [English usage](docs/usage.md), [日本語の使い方](docs/usage-ja.md), [简体中文使用指南](docs/usage-zh_CN.md), [development](docs/development.ja.md).

## English

### 3.0.0

- Run saved workflows through the page context menu and target preview; improve inline help, advanced URL controls and saved-workflow loading. Clarify browser sync storage and manual execution before quitting.

- Separate workflow selection, editing, primary save and saved-item actions; collapse URL conditions and move protection settings into advanced groups. Put saved workflows alongside other operation menus; add explicit editor target inspection and confirmed closing of a single rule’s targets.
- Improve options layout and Japanese labels; show explicit saved-version or overwrite choices only for conflicts and unconfirmed saves.
- Add named saved workflows with explicit save and confirmed execution from the page context menu.
- Add session-aware tab protection, optional global preview and bounded in-memory undo for eligible closed HTTP(S) tabs.
- Add settings JSON export/import (format version 1), local URL-rule storage and recovery handling for interrupted settings writes.
- Rework tab ordering and operation planning; split Chrome/Firefox builds into four independent entries. Move development tooling to TypeScript 7 and pnpm 12.
- Separate product documentation and development procedures from internal Agent records.

### Update 2.0

- Add the function to close tabs that match patterns.
- Add the function to create tab groups.
- Support Manifest V3
- Require Chrome 123 or later, or Firefox 112 or later (desktop).
- Reduce slowdowns and freezes with many tabs, and show a red "!" on the icon when a request is not executed.
- Fix minor issues

### Update 1.11

- Add two menu into the context menu.
- Refactor the source code

### Update 1.10

- Fix minor issue.

### Update 1.9

- Fix issue that the number shown in the icon badge is not updated when the extension is triggered from the context menu.

### Update 1.8

- Fix minor issue.

### Update 1.7

- Fix the issue of asynchronous processing.
- Add the option to apply some function only for the current windows.
- Add the option to count tabs for each windows on the icon badge.
- Add the option to add "Close tabs in the same domain" to the context menu.
- Add the option to add "Merge tabs into one window" to the context menu.

### Update 1.6

- Fix the issue that this extension unexpectedly handled chrome app tabs and popups.

### Update 1.5

- Close Chrome Extension Tabs(chrome-extension://) when close system tabs option is enabled.

### Update 1.4

- Add function to close search engine result tabs. You can enable it on option page.
- Speedup extension.

### Update 1.3

- Add function to close system tabs. You can enable it on option page.

## 日本語

### 3.0.0

- 保存した手順をページの右クリックメニューから対象確認へ渡す操作を追加。設定の注釈、高度なURL設定、手順の読み込みを改善し、同期用領域と終了前の手動実行を説明

- 手順の選択・編集・保存・補助操作を整理し、URL条件を折りたたみ、保護設定を高度な機能内に集約。保存手順を他の操作と同じメニュー階層へ移し、編集画面での明示的な対象確認と、確認後に単独ルールの対象だけを閉じる操作を追加
- 設定画面の配置と日本語の操作名を改善し、競合時や保存結果を確認できない場合に、保存済みの内容へ戻すか編集内容で上書きするかを明示的に選ぶ操作を追加
- 名前付きの保存手順を追加。明示的な保存と、ページの右クリックメニューからの確認後の実行に対応
- セッション境界を守るタブ保護、任意の全体操作プレビュー、対象のHTTP(S)タブを閉じた後に使う件数・時間制限付きのメモリ内復元を追加
- 設定JSONの入出力（形式バージョン1）、URLルールのローカル保存、設定書込みが中断した場合の復旧処理を追加
- タブ順序と操作計画を再構成し、Chrome／Firefoxのビルドを4つの独立したentryに分割。開発toolingをTypeScript 7とpnpm 12へ移行
- 製品文書と開発手順を内部のAgent記録から分離

### アップデート 2.0

- パターンにマッチしたタブを閉じる機能を追加
- タブグループを作成する機能
- Manifest V3対応
- 対応ブラウザーをChrome 123以降、Firefox 112以降（デスクトップ版）に変更
- タブが多いときの動作の重さやフリーズを改善し、実行しなかった要求をアイコンの赤い「!」で表示
- 軽微な問題点を修正

### アップデート 1.11

- コンテキストメニューに新しく2つメニューを追加
- ソースコードのリファクタリング

### アップデート1.10

- 軽微な問題点を修正

### アップデート1.9

- コンテキストメニューから拡張機能を実行した際にタブの数を示すアイコンが更新されていなかった問題を修正

### アップデート1.8

- 軽微な問題点を修正

### アップデート1.7

- 非同期実行のバグの修正
- 一部機能を現在のウィンドウにのみ適用するオプションを追加
- タブの数の表記をウィンドウ毎にするオプションを追加
- コンテキストメニューに「同一ドメインのタブを閉じる」を追加するオプションを追加
- コンテキストメニューに複数のウィンドウ上のタブを一つのウィンドウに集約するオプションを追加

### アップデート1.6

- 拡張機能の動作範囲にChromeアプリやポップアップを含めてしまう問題を修正

### アップデート1.5

- システムタブを閉じるオプションが有効な時、拡張機能のタブも閉じる様に変更

### アップデート1.4

- 検索エンジンの結果のページを閉じる機能を追加（Google, Bing, Baidu, Yahoo Japan対応）
- 全体的な高速化

### アップデート1.3

- Chromeのシステムに関するタブを閉じる機能の追加

## 简体中文

### 3.0.0

- 从网页右键菜单进入已保存工作流的目标预览；改进设置注释、高级 URL 控件及工作流加载，说明同步存储区域和退出前的手动运行。

- 区分工作流选择、编辑、主要保存操作和辅助操作；折叠 URL 条件，将保护设置移入高级功能分组。已保存工作流与其他操作置于同一菜单层级，新增编辑器中的明确目标检查，以及确认后仅关闭单个规则目标的操作。
- 改进选项页面布局和日语操作名称；仅在冲突或无法确认保存结果时显示恢复保存内容或覆盖的明确选项。
- 新增命名的已保存工作流程，支持显式保存，以及从网页右键菜单预览目标后确认执行。
- 新增遵守会话边界的选项卡保护、可选的全局操作预览，以及对符合条件的已关闭HTTP(S)选项卡进行有数量和时间限制的内存内恢复。
- 新增设置JSON导入和导出（格式版本1）、URL规则的本地存储，以及设置写入中断时的恢复处理。
- 重构选项卡排序和操作计划，将Chrome／Firefox构建拆分为4个独立入口。开发工具迁移到TypeScript 7和pnpm 12。
- 将产品文档和开发步骤与内部Agent记录分离。

### 更新 2.0

- 新增关闭匹配 glob 模式的选项卡功能
- 根据域创建选项卡组
- 支持 Manifest V3
- 需要 Chrome 123 或更高版本，或 Firefox 112 或更高版本（桌面版）
- 改善选项卡较多时的卡顿和冻结，未执行的请求会在图标上显示红色“!”
- 修复一些小问题

### 更新 1.11

- 在右键菜单中新增两个功能
- 重构源代码

### 更新 1.10

- 修复一些小问题

### 更新 1.9

- 修复从右键菜单触发扩展时图标徽章未更新的问题

### 更新 1.8

- 修复一些小问题

### 更新 1.7

- 修复异步处理问题
- 新增仅对当前窗口应用部分功能的选项
- 新增在图标徽章中按窗口显示选项卡数量的选项
- 新增将"关闭同一域名的选项卡"添加到右键菜单的选项
- 新增将"将选项卡合并到一个窗口"添加到右键菜单的选项

### 更新 1.6

- 修复扩展错误处理 Chrome 应用选项卡和弹出窗口的问题

### 更新 1.5

- 当启用关闭系统选项卡选项时，也会关闭 Chrome 扩展页面 (chrome-extension://)

### 更新 1.4

- 新增关闭搜索引擎结果选项卡的功能（支持 Google、Bing、Baidu、Yahoo Japan 等）
- 提升整体性能

### 更新 1.3

- 新增关闭系统选项卡的功能
