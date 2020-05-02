import { YoutubeVideo } from "../youtube";
import { PlayableMedia } from "../playback";
import { HTTPSource } from "../archiveorg";

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

export const FAKE_YOUTUBE_VIDEO: YoutubeVideo = {
    source: { type: 'youtube', videoId: '' },
    details: { title: 'fake video', duration: 1000 },
};

export const THREADS_HTTP_MEDIA: PlayableMedia<HTTPSource> = {
    details: { title: 'Threads 1984', duration: 6749600 },
    source: { type: 'http', src: 'https://archive.org/download/threads_201712/threads.mp4' },
};

export const PRISONER_HTTP_MEDIA: PlayableMedia<HTTPSource> = {
    details: { title: 'The Prisoner 01 Arrival', duration: 2935410 },
    source: { type: 'http', src: 'https://archive.org/download/The_Prisoner/ThePrisoner01Arrival.mp4' },
};

export const ARCHIVE_PATH_TO_MEDIA = [
    { path: 'The_Prisoner/ThePrisoner01Arrival.mp4', media: PRISONER_HTTP_MEDIA },
    { path: 'threads_201712/threads.mp4', media: THREADS_HTTP_MEDIA },
    { path: 'threads_201712', media: THREADS_HTTP_MEDIA },
];