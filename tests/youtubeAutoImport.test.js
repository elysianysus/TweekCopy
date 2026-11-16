import { test } from "node:test";
import assert from "node:assert/strict";
import { isYoutubeChannelFeedUrl } from "../server/youtubeAutoImport.js";

test("isYoutubeChannelFeedUrl matches valid channel feed urls", () => {
  assert.equal(
    isYoutubeChannelFeedUrl("https://www.youtube.com/feeds/videos.xml?channel_id=UCXuqSBlHAE6Xw-yeJA0Tunw"),
    true,
  );
  assert.equal(
    isYoutubeChannelFeedUrl("http://youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv"),
    true,
  );
});

test("isYoutubeChannelFeedUrl rejects non-channel YouTube urls and other feeds", () => {
  assert.equal(isYoutubeChannelFeedUrl("https://www.youtube.com/watch?v=abc"), false);
  assert.equal(isYoutubeChannelFeedUrl("https://example.com/rss.xml"), false);
  assert.equal(isYoutubeChannelFeedUrl(""), false);
  assert.equal(isYoutubeChannelFeedUrl(null), false);
  assert.equal(
    isYoutubeChannelFeedUrl("https://www.youtube.com/feeds/videos.xml?playlist_id=PLxxx"),
    false,
  );
});
