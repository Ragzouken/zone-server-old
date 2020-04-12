import youtube, { Youtube, search, fetchDom, getTitleDirect, YoutubeVideo } from '../youtube';

const VIDEOS: YoutubeVideo[] = [
    { videoId: "5dA5ynP-j-I", title: "Tetris (CD-i) Music - Level 9", duration: 245 },
];

test.each(VIDEOS)('getTitleDirect', async ({ videoId, title }) => {
    expect(await getTitleDirect(videoId)).toEqual(title);
});
