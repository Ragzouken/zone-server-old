import fetch from 'node-fetch';
import * as HTMLParser from 'node-html-parser';

export type YoutubeVideo = {
    videoId: string;
    duration: number;
    title: string;
    thumbnail?: string;
    meta?: any;
};

export class Youtube {
    private cache = new Map<string, YoutubeVideo>();

    public async search(query: string): Promise<YoutubeVideo[]> {
        const results = await search(query);
        results.forEach((video: YoutubeVideo) => this.cache.set(video.videoId, video));
        return results;
    }

    public async details(videoId: string): Promise<YoutubeVideo> {
        let details: YoutubeVideo | undefined;
        for (const strategy of SEARCH_STRATEGIES) {
            const query = await strategy(videoId);
            await this.search(query);
            details = this.cache.get(videoId);
            if (details) break;
        }

        if (!details) throw new Error(`Couldn't determine details of ${videoId}`);

        return details;
    }
}

type SearchStrategy = (videoId: string) => Promise<string>;
const SEARCH_STRATEGIES: SearchStrategy[] = [
    async (videoId) => `"${videoId}"`,
    async (videoId) => `"v=${videoId}"`,
    async (videoId) => `"${await getTitleDirect(videoId)}"`,
];

export function timeToSeconds(time: string): number {
    const parts = time.split(':');

    const seconds = parseInt(parts.pop() || '0', 10);
    const minutes = parseInt(parts.pop() || '0', 10);
    const hours = parseInt(parts.pop() || '0', 10);

    return seconds + minutes * 60 + hours * 3600;
}

export async function fetchDom(url: string): Promise<HTMLParser.HTMLElement> {
    const address = encodeURI(url);
    const response = await fetch(address);
    const html = await response.text();
    return HTMLParser.parse(html) as HTMLParser.HTMLElement;
}

export async function getTitleDirect(videoId: string) {
    const dom = await fetchDom(`https://www.youtube.com/watch?v=${videoId}`);
    const title = dom.querySelectorAll('meta').filter((element) => element.getAttribute('property') === 'og:title')[0];
    return title.getAttribute('content');
}

export async function search(query: string): Promise<YoutubeVideo[]> {
    const dom = await fetchDom(`https://www.youtube.com/results?search_query=${query}`);
    const results: YoutubeVideo[] = [];
    const videos = dom.querySelectorAll('.yt-lockup-dismissable');
    videos.forEach((video) => {
        const time = video.querySelector('.video-time');
        if (!time) return;

        const duration = timeToSeconds(time.innerHTML);
        const thumbImg = video.querySelector('img');

        let thumbnail: string | undefined;
        if (thumbImg) {
            const thumbSrc = thumbImg.getAttribute('src')!.split('?')[0];
            thumbnail = thumbSrc.includes('pixel') ? undefined : thumbSrc;
        }

        const link = video.querySelector('.yt-uix-tile-link');
        if (!link) return;

        const title = link.getAttribute('title');
        const url = link.getAttribute('href');
        if (!title || !url) return;

        const videoId = url.split('?v=')[1];
        results.push({ videoId, title, duration, thumbnail });
    });

    return results;
}

export default new Youtube();
