// 中継（worker/ を Cloudflare に公開したURL）。追加したサイトのRSSの取得に使う。空のあいだは「サイトを追加」を出さない。
export const READER_PROXY='https://tech-feed-reader.munkunosakebu.workers.dev/';
// 記事の本文を先に取ってきて、アプリの中で見せるか。
// 公開版では、配信元の記事を丸ごと写して見せないよう止めている（2026-11-06、著作権のため）。止めている間は、記事を押すと配信元のページを開く。
// 戻すときは、配信元の許可を取ったうえで、ここと worker/src/index.js の ARTICLE_RELAY の両方を true にする。
export const READER_ARTICLES=false;
