import { YoutubeVideo } from '../youtube';
import { HTMLVideo } from '../archiveorg';
import { PlayableMedia } from '../playback';

export const TINY_MEDIA: PlayableMedia = {
    source: { type: 'null' },
    details: { title: 'tiny', duration: 100 },
};

export const DAY_MEDIA: PlayableMedia = {
    source: { type: 'null' },
    details: { title: 'day', duration: 24 * 60 * 60 * 1000 },
};

export const YOUTUBE_VIDEOS: YoutubeVideo[] = [
    {
        source: { type: 'youtube', videoId: '5dA5ynP-j-I' },
        details: { title: 'Tetris (CD-i) Music - Level 9', duration: 246000 },
    },
    {
        source: { type: 'youtube', videoId: '2GjyNgQ4Dos' },
        details: { title: 'dobby pussy indulgence', duration: 20000 },
    },
];

export const ARCHIVEORG_VIDEOS: HTMLVideo[] = [
    {
        source: { type: 'htmlvideo', src: 'https://archive.org/download/threads_201712/threads.mp4' },
        details: { title: 'Threads 1984', duration: 0 },
    },
];
