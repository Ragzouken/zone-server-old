import youtube, { getTitleDirect, YoutubeVideo, timeToSeconds } from '../youtube';

const TIMES: [string, number][] = [
    ['1:32:10', 5530],
    ['01:32:10', 5530],
    ['00:51:11', 3071],
    ['0:51:11', 3071],
    ['51:11', 3071],
    ['01:0:00', 3600],
    ['01:00', 60],
    ['1', 1],
];

const VIDEOS: YoutubeVideo[] = [
    { videoId: '5dA5ynP-j-I', title: 'Tetris (CD-i) Music - Level 9', duration: 246 },
    { videoId: '2GjyNgQ4Dos', title: 'dobby pussy indulgence', duration: 20 },
];

test.each(TIMES)('timeToSeconds', async (time, seconds) => {
    expect(timeToSeconds(time)).toEqual(seconds);
});

test.each(VIDEOS)('getTitleDirect', async ({ videoId, title }) => {
    expect(await getTitleDirect(videoId)).toEqual(title);
});

test.each(VIDEOS)('youtube.details', async ({ videoId, title, duration }) => {
    const details = await youtube.details(videoId);
    details.thumbnail = undefined;
    expect(details).toEqual({ videoId, title, duration });
});
