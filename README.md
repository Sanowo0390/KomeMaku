# KomeMaku — YouTube Comment Danmaku

YouTubeのコメントを動画上に流れる弾幕として表示する、Chrome / Edge 向け Manifest V3 拡張機能です。

**現在のバージョン:** v1.4.0

## 主な機能

- YouTubeの公開コメントを自動取得して動画上に重ねて表示
- [YCS - YouTube Comment Search (Continued)](https://github.com/pc035860/YCS-cont) に対応。Load all中のコメントやYCSのJSONエクスポートを取り込み
- コメント・返信のいいね数が多い順に表示優先度を決定
- レーン衝突防止、動画終了前に流し切るスケジュール制御
- 巻き戻し・シーク・倍速・一時停止・タブ復帰と同期
- 日本語、英語、簡体字・繁体字中国語の設定画面
- プレイヤー内の弾幕設定ボタン
- 色・文字サイズ・表示頻度・透明度・流速、ランダム色・速度
- YouTubeのページ内動画切り替えに追従

## インストール

1. [Actions](../../actions/workflows/build.yml) の最新の成功した **Build KomeMaku** を開きます。
2. ページ下部 **Artifacts** から **KomeMaku-v1.4.0** をダウンロードします。
3. ZIPを展開し、Chromeなら `chrome://extensions`、Edgeなら `edge://extensions` を開きます。
4. 「デベロッパーモード」をオンにし、「パッケージ化されていない拡張機能を読み込む」で、展開した `KomeMaku` フォルダーを指定します。
5. 開いているYouTubeのタブを再読み込みします。旧版の弾幕 Lite は無効化してください。

## 開発・テスト

```bash
for test in tests/*.cjs; do node "$test"; done
```

`.github/workflows/build.yml` がpush、Pull Request、手動実行で自動テストを行い、配布用ZIPをArtifactsに保存します。ビルドに外部npmパッケージは不要です。

## 注意

- YCS Continuedの公式派生ではなく、別拡張機能として動作します。
- 内蔵の初回コメント取得には上限があり、全件取得を希望する場合はYCSの **Load all** またはJSONエクスポートを利用します。
- 取得されたコメントをすべて同時に表示できるわけではありません。動画の長さ・表示頻度・レーンの空きに応じていいね数の少ない順に間引きます。
- YouTube内部APIやDOMの変更により動作しなくなる可能性があります。実際のYouTube画面での検証は未実施です。

## ライセンス

LICENSE未設定です。ソース公開のみでは再利用・改変・再配布の許諾にはなりません。ライセンスはメンテナーが別途指定してください。

YouTube、YCS Continued、Dmoojiの公式製品ではありません。
