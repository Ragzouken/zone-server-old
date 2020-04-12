import youtube, { getTitleDirect, YoutubeVideo } from '../youtube';

const VIDEOS: YoutubeVideo[] = [
    { videoId: '5dA5ynP-j-I', title: 'Tetris (CD-i) Music - Level 9', duration: 246 },
    { videoId: '2GjyNgQ4Dos', title: 'dobby pussy indulgence', duration: 20 },
];

test.each(VIDEOS)('getTitleDirect', async ({ videoId, title }) => {
    expect(await getTitleDirect(videoId)).toEqual(title);
});

test.each(VIDEOS)('youtube.details', async ({ videoId, title, duration }) => {
    const details = await youtube.details(videoId);
    details.thumbnail = undefined;
    expect(details).toEqual({ videoId, title, duration });
});
