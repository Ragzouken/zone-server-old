import { archiveOrgToPlayableHTTP, HTTPSource } from '../archiveorg';
import { PlayableMedia } from '../playback';

const THREADS_MEDIA: PlayableMedia<HTTPSource> = {
    details: { title: 'Threads 1984', duration: 6749600 },
    source: { type: 'http', src: 'https://archive.org/download/threads_201712/threads.mp4' },
};

const PRISONER_MEDIA: PlayableMedia<HTTPSource> = {
    details: { title: 'The Prisoner 01 Arrival', duration: 2935410 },
    source: { type: 'http', src: 'https://archive.org/download/The_Prisoner/ThePrisoner01Arrival.mp4' },
}

const PATH_TO_MEDIA = [
    { path: 'The_Prisoner/ThePrisoner01Arrival.mp4', media: PRISONER_MEDIA },
    { path: 'threads_201712/threads.mp4', media: THREADS_MEDIA },
    { path: 'threads_201712', media: THREADS_MEDIA },
];

test.each(PATH_TO_MEDIA)('path gives expected media', async ({ path, media }) => {
    const actual = await archiveOrgToPlayableHTTP(path);
    expect(actual).toEqual(media);
});
