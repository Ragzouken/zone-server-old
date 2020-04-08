const fetch = require("node-fetch");
const HTMLParser = require("node-html-parser");

class Youtube {
  constructor() {
    this.cache = new Map();
  }
  
  async search(query) {
    const results = this.cache.get(query) || await search(query);
    this.cache.set(query, results);
    results.forEach(video => this.cache.set(video.videoId, video));
    return results;
  }
  
  async details(videoId) {
    if (!this.cache.has(videoId))
        await this.search(`"v=${videoId}"`);
    if (!this.cache.has(videoId))
        await this.search(await getTitleDirect(videoId));
    if (!this.cache.has(videoId))
        throw new Error(`Couldn't determine details of ${videoId}`);
    
    return this.cache.get(videoId);
  }
}

function timeToSeconds(time) {
  const parts = time.split(":");

  const seconds = parseInt(parts.pop() || 0);
  const minutes = parseInt(parts.pop() || 0);
  const hours = parseInt(parts.pop() || 0);

  return seconds + minutes * 60 + hours * 3600;
}

async function getTitleDirect(videoId) {
    const result = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
    const text = await result.text();
    const dom = HTMLParser.parse(text);

    const title = dom.querySelectorAll('meta').filter(element => element.getAttribute('property') === 'og:title')[0];
    return title.getAttribute('content');
}

async function search(query, retries=1) {
  const address = encodeURI(`https://www.youtube.com/results?search_query=${query}`);
  console.log(`new query ${address}`);
  const result = await fetch(address);
  const text = await result.text();
  const dom = HTMLParser.parse(text);

  const results = [];

  const videos = dom.querySelectorAll(".yt-lockup-dismissable");
  videos.forEach(video => {
    const time = video.querySelector(".video-time");

    if (!time) return;

    const duration = timeToSeconds(time.innerHTML);
    const thumbSrc = video
      .querySelector("img")
      .getAttribute("src")
      .split("?")[0];
    const thumbnail = thumbSrc.includes("pixel") ? "" : thumbSrc;

    const link = video.querySelector(".yt-uix-tile-link");
    const title = link.getAttribute("title");
    const url = link.getAttribute("href");
    const videoId = url.split("?v=")[1];

    results.push({ videoId, title, duration, thumbnail });
  });

  if (results.length === 0 && retries > 0)
    return await search(query, retries - 1);
  
  return results;
}

module.exports = new Youtube();
