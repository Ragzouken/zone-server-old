import youtube, { getTitleDirect, Youtube } from '../youtube';
import { YOUTUBE_VIDEOS, DAY_YOUTUBE_VIDEO } from './test-data';

test.each(YOUTUBE_VIDEOS)('getTitleDirect', async ({ videoId, title }) => {
    expect(await getTitleDirect(videoId)).toEqual(title);
});

test.each(YOUTUBE_VIDEOS)('youtube.details', async ({ videoId, title, duration }) => {
    const youtube = new Youtube();
    const details = await youtube.details(videoId);
    details.thumbnail = undefined;
    expect(details).toEqual({ videoId, title, duration });
});

it('throws exception for unobtainable details', async () => {
    const youtube = new Youtube();
    const check = youtube.details('really fake video id');
    await expect(check).rejects.toThrow(Error);
});

it('loads copied state', async () => {
    const youtube1 = new Youtube();
    const youtube2 = new Youtube();
    youtube1.addVideo(DAY_YOUTUBE_VIDEO);
    youtube2.loadState(youtube1.copyState());
    expect(await youtube2.details(DAY_YOUTUBE_VIDEO.videoId)).toEqual(DAY_YOUTUBE_VIDEO);
});

it('can copy empty state', async () => {
    const youtube1 = new Youtube();
    const youtube2 = new Youtube();
    youtube2.addVideo(DAY_YOUTUBE_VIDEO);
    youtube2.loadState(youtube1.copyState());
    const check = youtube2.details(DAY_YOUTUBE_VIDEO.videoId);
    await expect(check).rejects.toThrow(Error);
});

it('remembers queried videos', async () => {
    const youtube = new Youtube();
    for (const video of YOUTUBE_VIDEOS) await youtube.details(video.videoId);
    expect(youtube.copyState().videos.length).toBeGreaterThanOrEqual(YOUTUBE_VIDEOS.length);
});
