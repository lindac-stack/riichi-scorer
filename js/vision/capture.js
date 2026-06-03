// capture.js — 画像取得ヘルパ（依存なし・SSR セーフ）。
//
// pickImage()    : 隠し <input type="file"> でライブラリから1枚選ばせる。
// captureImage() : 同上だが capture="environment" でモバイルの背面カメラを優先。
// fileToDataUrl(): File/Blob を dataURL 文字列へ変換。

/** document が無い環境(SSR/Node)で呼ばれたら明確に失敗させる。 */
function assertDom() {
  if (typeof document === 'undefined') {
    throw new Error('画像選択はブラウザ環境でのみ利用できます（document が見つかりません）。');
  }
}

/**
 * 隠しファイル入力を生成して1枚選ばせる共通実装。
 * @param {boolean} useCamera capture="environment" を付けるか。
 * @returns {Promise<File>}
 */
function openFileDialog(useCamera) {
  assertDom();
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (useCamera) input.setAttribute('capture', 'environment'); // 背面カメラ優先(モバイル)
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.opacity = '0';

    let settled = false;
    const cleanup = () => {
      window.removeEventListener('focus', onFocus, true);
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    const onChange = () => {
      if (settled) return;
      settled = true;
      const file = input.files && input.files[0];
      cleanup();
      if (file) resolve(file);
      else reject(new Error('画像が選択されませんでした。'));
    };

    // キャンセル検知: ダイアログを閉じて window にフォーカスが戻った後、
    // change が発火しなければ「未選択」とみなす。
    const onFocus = () => {
      setTimeout(() => {
        if (settled) return;
        if (!input.files || input.files.length === 0) {
          settled = true;
          cleanup();
          reject(new Error('画像が選択されませんでした。'));
        }
      }, 500);
    };

    input.addEventListener('change', onChange, { once: true });
    window.addEventListener('focus', onFocus, true);

    document.body.appendChild(input);
    input.click();
  });
}

/** 画像ライブラリ/ファイルから1枚選ばせる。 */
export function pickImage() {
  return openFileDialog(false);
}

/** 背面カメラを優先して撮影/選択させる（モバイル）。 */
export function captureImage() {
  return openFileDialog(true);
}

/**
 * File/Blob を dataURL(base64) 文字列へ変換。
 * @param {Blob|File} file
 * @returns {Promise<string>} 例 "data:image/jpeg;base64,...."
 */
export function fileToDataUrl(file) {
  assertDom();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('ファイルの読み込みに失敗しました。'));
    reader.readAsDataURL(file);
  });
}
