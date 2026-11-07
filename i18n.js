/* UI strings shared by the extension popup and in-player controls. */
(() => {
  'use strict';
  const strings = {
    ja: {
      hideReplies:'返信コメントを非表示', preserveLineBreaks:'コメントの改行を維持',
      hideFromLines:'この行数以上を非表示', featuredPercent:'中央に拡大表示する人気コメント',
      unlimited:'制限なし', linesOrMore:'行以上',
      lineHint:'0で制限なし。改行表示OFFでも元の行数で判定します。',
      featuredHint:'いいね数が多い上位の指定割合を中央に約1.5倍で表示（0%で無効）。',

      title:'KomeMaku', subtitle:'YouTubeコメントの弾幕表示', enabled:'弾幕を表示',
      playerButton:'弾幕設定を開く', playerButtonDisabled:'弾幕設定を開く（非表示中）', playerPanel:'弾幕の設定',
      close:'閉じる', language:'表示言語', auto:'自動（ブラウザー）',
      fontSize:'文字サイズ', speed:'流れる速さ', density:'表示頻度', opacity:'不透明度',
      colorMode:'コメントの色', color:'基本色', colorSingle:'単色', colorRandom:'ランダム',
      speedMode:'速度の変化', speedFixed:'一定', speedRandom:'ランダム',
      importTitle:'YCS Continued と連携',
      importDesc:'YCSの「Load all」で取得したコメント・返信を自動で取り込みます。過去に取得したものはJSONから読み込めます。',
      importButton:'YCSのJSONファイルを読み込む', statusTitle:'現在の動画',
      unavailable:'YouTubeの動画ページで使用できます。',
      hint:'再生位置に同期します。表示しきれない場合はいいね数の少ないコメントから除外します。',
      densityHint:'終了までに流れ切るように表示件数を調整します。',
      statusEmpty:'まだコメントを取得していません', statusLoading:'コメントを先読みしています…',
      statusFound:n=>`${n.toLocaleString()}件のコメントを取得`,
      statusCounts:(total,selected,dropped)=>`${total.toLocaleString()}件取得 / ${selected.toLocaleString()}件表示対象（除外 ${dropped.toLocaleString()}件）`,
      importParsing:'JSONを解析しています…', importMissing:'YCSのコメントデータが見つかりません',
      importNeedTab:'YouTube動画のタブを開いてください', importNeedReload:'YouTubeの動画ページを再読み込みしてください',
      importMissingId:'JSONに動画IDがありません', importOtherVideo:'別の動画のコメントです',
      importProgress:(done,total)=>`取り込み中 ${done.toLocaleString()} / ${total.toLocaleString()}件`,
      importDone:n=>`${n.toLocaleString()}件を送信しました（重複は除外）`, importFailed:e=>`読み込み失敗: ${e}`
    },
    en: {
      hideReplies:'Hide replies', preserveLineBreaks:'Keep comment line breaks',
      hideFromLines:'Hide comments with this many lines or more', featuredPercent:'Featured comments in center',
      unlimited:'Unlimited', linesOrMore:'+ lines',
      lineHint:'0 disables the filter; original line count is used even with wrapping off.',
      featuredHint:'Show top liked selected comments at 1.5× size in the center (0% off).',

      title:'KomeMaku', subtitle:'Scrolling comments on videos', enabled:'Show danmaku',
      playerButton:'Open danmaku settings', playerButtonDisabled:'Open danmaku settings (disabled)', playerPanel:'Danmaku settings',
      close:'Close', language:'Language', auto:'Auto (browser)', fontSize:'Text size', speed:'Scroll speed',
      density:'Display frequency', opacity:'Opacity', colorMode:'Comment colors', color:'Base color',
      colorSingle:'Single color', colorRandom:'Random colors', speedMode:'Speed variation',
      speedFixed:'Fixed', speedRandom:'Random speeds', importTitle:'YCS Continued integration',
      importDesc:'Comments and replies loaded via YCS “Load all” are captured automatically. You can also import previously saved YCS JSON.',
      importButton:'Import YCS JSON file', statusTitle:'Current video',
      unavailable:'Open a YouTube video to use this extension.',
      hint:'Synchronized to playback. Lowest-liked comments are skipped when the screen is full.',
      densityHint:'Adjusts count to finish scrolling before the video ends.',
      statusEmpty:'No comments loaded yet', statusLoading:'Preloading comments…',
      statusFound:n=>`${n.toLocaleString()} comments loaded`,
      statusCounts:(total,selected,dropped)=>`${total.toLocaleString()} loaded / ${selected.toLocaleString()} selected (${dropped.toLocaleString()} skipped)`,
      importParsing:'Parsing JSON…', importMissing:'YCS comment data not found',
      importNeedTab:'Open a YouTube video tab first', importNeedReload:'Reload the YouTube video page',
      importMissingId:'The JSON has no video ID', importOtherVideo:'JSON is for another video',
      importProgress:(done,total)=>`Importing ${done.toLocaleString()} / ${total.toLocaleString()}`,
      importDone:n=>`Sent ${n.toLocaleString()} comments (duplicates omitted)`, importFailed:e=>`Import failed: ${e}`
    },
    'zh-CN': {
      hideReplies:'隐藏回复', preserveLineBreaks:'保留评论换行',
      hideFromLines:'隐藏达到此行数的评论', featuredPercent:'中央高赞评论比例',
      unlimited:'不限制', linesOrMore:'行及以上',
      lineHint:'0表示不限制，关闭换行显示仍按原始行数过滤。',
      featuredHint:'将点赞数最高的指定比例评论放大1.5倍居中显示（0%关闭）。',

      title:'YouTube 弹幕 Lite', subtitle:'在视频上滚动显示评论', enabled:'显示弹幕',
      playerButton:'打开弹幕设置', playerButtonDisabled:'打开弹幕设置（已关闭）', playerPanel:'弹幕设置', close:'关闭',
      language:'界面语言', auto:'自动（浏览器）', fontSize:'字体大小', speed:'滚动速度', density:'显示频率',
      opacity:'不透明度', colorMode:'弹幕颜色', color:'基础颜色', colorSingle:'单色', colorRandom:'随机颜色',
      speedMode:'速度变化', speedFixed:'固定速度', speedRandom:'随机速度', importTitle:'YCS Continued 联动',
      importDesc:'自动接收 YCS “Load all” 获取的评论和回复，也可导入之前导出的 YCS JSON。',
      importButton:'导入 YCS JSON 文件', statusTitle:'当前视频', unavailable:'请先打开 YouTube 视频。',
      hint:'与播放进度同步；空间不足时优先跳过点赞数较少的评论。',
      densityHint:'调整显示数量，确保视频结束前滚动完毕。',
      statusEmpty:'尚未加载评论', statusLoading:'正在预加载评论…',
      statusFound:n=>`已获取 ${n.toLocaleString()} 条评论`,
      statusCounts:(total,selected,dropped)=>`已获取 ${total.toLocaleString()} / 显示 ${selected.toLocaleString()}（跳过 ${dropped.toLocaleString()}）`,
      importParsing:'正在解析 JSON…', importMissing:'未找到 YCS 评论数据',
      importNeedTab:'请先打开 YouTube 视频标签页', importNeedReload:'请刷新 YouTube 视频页面',
      importMissingId:'JSON 中没有视频 ID', importOtherVideo:'这是其他视频的评论',
      importProgress:(done,total)=>`导入中 ${done.toLocaleString()} / ${total.toLocaleString()}`,
      importDone:n=>`已发送 ${n.toLocaleString()} 条评论（已去重）`, importFailed:e=>`导入失败：${e}`
    },
    'zh-TW': {
      hideReplies:'隱藏回覆', preserveLineBreaks:'保留留言換行',
      hideFromLines:'隱藏達此行數的留言', featuredPercent:'置中熱門留言比例',
      unlimited:'不限', linesOrMore:'行以上',
      lineHint:'0代表不限，關閉換行顯示仍按原始行數過濾。',
      featuredHint:'將按讚數較高的指定比例留言放大1.5倍置中顯示（0%關閉）。',

      title:'YouTube 彈幕 Lite', subtitle:'在影片上捲動顯示留言', enabled:'顯示彈幕',
      playerButton:'開啟彈幕設定', playerButtonDisabled:'開啟彈幕設定（已關閉）', playerPanel:'彈幕設定', close:'關閉',
      language:'介面語言', auto:'自動（瀏覽器）', fontSize:'字體大小', speed:'捲動速度', density:'顯示頻率',
      opacity:'不透明度', colorMode:'彈幕顏色', color:'基本顏色', colorSingle:'單色', colorRandom:'隨機顏色',
      speedMode:'速度變化', speedFixed:'固定速度', speedRandom:'隨機速度', importTitle:'YCS Continued 整合',
      importDesc:'自動接收 YCS「Load all」取得的留言與回覆，也可匯入先前匯出的 YCS JSON。',
      importButton:'匯入 YCS JSON 檔案', statusTitle:'目前影片', unavailable:'請先開啟 YouTube 影片。',
      hint:'與播放進度同步；空間不足時優先略過讚數較少的留言。',
      densityHint:'調整顯示數量，確保影片結束前捲動完畢。',
      statusEmpty:'尚未載入留言', statusLoading:'正在預先載入留言…',
      statusFound:n=>`已取得 ${n.toLocaleString()} 則留言`,
      statusCounts:(total,selected,dropped)=>`已取得 ${total.toLocaleString()} / 顯示 ${selected.toLocaleString()}（略過 ${dropped.toLocaleString()}）`,
      importParsing:'正在解析 JSON…', importMissing:'找不到 YCS 留言資料',
      importNeedTab:'請先開啟 YouTube 影片分頁', importNeedReload:'請重新載入 YouTube 影片頁面',
      importMissingId:'JSON 中沒有影片 ID', importOtherVideo:'這是其他影片的留言',
      importProgress:(done,total)=>`匯入中 ${done.toLocaleString()} / ${total.toLocaleString()}`,
      importDone:n=>`已傳送 ${n.toLocaleString()} 則留言（已去重）`, importFailed:e=>`匯入失敗：${e}`
    }
  };
  function detect(preference='auto', browserLanguage=globalThis.navigator?.language || 'ja') {
    if (preference !== 'auto' && strings[preference]) return preference;
    const code = String(browserLanguage).toLowerCase();
    if (code.startsWith('zh')) return /tw|hk|mo|hant/.test(code) ? 'zh-TW' : 'zh-CN';
    if (code.startsWith('en')) return 'en';
    return 'ja';
  }
  function translate(locale, key, ...args) {
    const value = (strings[locale] || strings.ja)[key] ?? strings.en[key] ?? key;
    return typeof value === 'function' ? value(...args) : value;
  }
  const api = Object.freeze({detect, translate, locales:Object.freeze(['auto','ja','en','zh-CN','zh-TW'])});
  globalThis.YDLI18N = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
