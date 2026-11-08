/* Shared settings categories for the options page and extension popup. */
(() => {
  'use strict';
  globalThis.KomeMakuSettingsGroups = Object.freeze([
 {id:'general',icon:'⚙',title:['基本設定','General','基本设置','基本設定'],subtitle:['弾幕の有効化と言語','Turn on danmaku and choose language','弹幕开关与界面语言','彈幕開關與介面語言'],keys:['enabled','language']},
 {id:'selection',icon:'▤',title:['表示・優先順位','Selection','显示与优先级','顯示與優先順序'],subtitle:['大量コメントをどれから表示するか','Choose which comments win when space runs out','决定优先显示哪些评论','決定優先顯示哪些留言'],keys:['selectionOrder','density','hideReplies','hideFromLines','preserveLineBreaks','hideTimestamps']},
 {id:'featured',icon:'★',title:['人気コメント','Featured comments','热门评论','熱門留言'],subtitle:['画面下端に拡大表示するコメント','Control highlighted comments at bottom','底部高赞弹幕','底部熱門留言'],keys:['featuredPercent','featuredScrollFromLines']},
 {id:'appearance',icon:'◉',title:['見た目・動き','Appearance','外观与动画','外觀與動態'],subtitle:['文字、流れる速度、表示の重なり','Text, colors, movement and spacing','文字、颜色、速度与重叠','文字、色彩、速度與重疊'],keys:['fontSize','autoFontScale','fontFamily','outlineEnabled','outlineStrength','outlineOpacity','lineSpacing','speed','opacity','colorMode','color','speedMode','autoShrink','halfLineOverlap']},
 {id:'performance',icon:'⚡',title:['パフォーマンス','Performance','性能','效能'],subtitle:['描画エンジンとFPSの設定','Renderer and FPS settings','渲染引擎与帧率','繪製引擎與FPS'],keys:['rendererMode','fpsLimit']},
 {id:'translation',icon:'文',title:['翻訳','Translation','翻译','翻譯'],subtitle:['コメントの翻訳を有効化','Translate comments only when enabled','开启后翻译评论','啟用時翻譯留言'],keys:['translateComments','translateLanguage']}
]);
})();
